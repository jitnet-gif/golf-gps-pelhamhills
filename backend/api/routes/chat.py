import asyncio
import json
import logging
import os
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from backend.models.domain import ChatRequest, MessageResponse, EmotionState
from agents.persona import build_system_prompt, UserContext, SpeechStyle, EmotionMode

logger = logging.getLogger(__name__)
router = APIRouter()

async def generate_chat_response(request: ChatRequest):
    """
    모의 SSE 스트리밍 제너레이터 
    실제 환경에서는 Anthropic SDK (claude-sonnet)의 스트리밍 응답을 여기서 처리합니다.
    """
    try:
        # 1. 초기 연산 (DB 저장, 컨텍스트 로딩 등 대기 시간 모의 약 0.5초)
        await asyncio.sleep(0.5)

        # 2. 고도화 기능 및 접두사 감지
        last_msg_content = request.messages[-1].content if request.messages else ""
        active_feature = None
        
        # 접두사 패턴 [ID] 감지
        import re
        match = re.search(r"^\[([A-Z_]+)\]\s*", last_msg_content)
        if match:
            prefix = match.group(1).lower().replace("_", "-")
            active_feature = prefix
            # 프롬프트에는 접두사가 제거된 순수 내용 전달을 위해 마지막 메시지 내용 보정
            # (실제 API 전송 시에는 보정된 내용을 쓰거나, persona 가 알아서 하게 둠)

        # 3. 시스템 프롬프트 확인 (로그용)
        # 매개변수를 UserContext 객체 형식에 맞게 전달
        # 2. 페르소나 시스템 프롬프트 조립
        from agents.persona import UserContext as UserContextDataclass, EmotionMode, SpeechStyle as SpeechStyleEnum
        
        try:
            user_ctx_data = request.user
            # Pydantic 모델과 Dataclass 간의 필드명 매핑 (name -> nickname 등)
            ctx = UserContextDataclass(
                nickname=user_ctx_data.name,
                speech_style=SpeechStyleEnum(user_ctx_data.speechStyle),
                emotion_mode=EmotionMode(user_ctx_data.emotionState),
                occupation=None,
                recent_memories=[],
                key_relationships=[],
                active_goals=[],
                active_concerns=[],
                today_schedule=[],
                agent_id=user_ctx_data.agent_id,
                active_feature=active_feature
            )
            sys_prompt = build_system_prompt(ctx)
            logger.info(f"시스템 프롬프트를 성공적으로 조립했습니다. (에이전트: {user_ctx_data.agent_id}, 기능: {active_feature})")
        except Exception as e:
            logger.error(f"시스템 프롬프트 조립 실패: {e}")
            sys_prompt = "너는 친절한 AI 파트너 베푸야. 평소대로 대답해줘."
        logger.debug(f"시스템 프롬프트 생성 완료 (길이: {len(sys_prompt)})")

        # 연결 성공 알림 (Heartbeat) - 최우선 전송
        yield f"data: {json.dumps({'event': 'info', 'data': {'message': 'Connection established, waiting for AI...'}}, ensure_ascii=False)}\n\n"

        # ----- 1. 유저 메시지 DB 저장 (비동기 타스크로 분리하여 차단 방지) -----
        from backend.services.db import get_supabase_admin
        async def save_user_msg():
            try:
                db = get_supabase_admin()
                if request.messages:
                    last_user_msg = request.messages[-1]
                    if last_user_msg.role == "user" and request.conversation_id:
                        user_data = {
                            "conversation_id": request.conversation_id,
                            "user_id": "00000000-0000-0000-0000-000000000000", 
                            "role": "user",
                            "content": last_user_msg.content,
                        }
                        if db:
                            logger.info(f"유저 메시지 DB 저장 시작 (Background)...")
                            await db.insert("messages", user_data)
            except Exception as e:
                logger.error(f"유저 메시지 백그라운드 저장 실패: {e}")

        asyncio.create_task(save_user_msg())

        from agents.emotion import stream_bepu_response

        # 클라이언트 메시지 포맷을 Claude API 포맷으로 변환
        messages_for_claude = []
        for msg in request.messages:
            if msg.role in ["user", "assistant"]:
                messages_for_claude.append({"role": msg.role, "content": msg.content})

        message_id = "msg_" + os.urandom(4).hex()
        
        # Claude 스트리밍 응답 제너레이터 호출 및 텍스트 누적
        full_assistant_reply = ""
        last_model_used = "unknown"
        logger.info(f"AI 엔진 스트리밍 시작 시도: {message_id}")

        async for text_chunk, model_name in stream_bepu_response(
            messages_history=messages_for_claude,
            system_prompt=sys_prompt,
            language=request.user.language,
            user_keys=request.user_keys
        ):
            full_assistant_reply += text_chunk
            last_model_used = model_name
            # SSE 형식 'data: {...}\n\n'
            token_event = {
                "event": "token",
                "data": {
                    "token": text_chunk,
                    "message_id": message_id,
                    "model_name": model_name
                }
            }
            yield f"data: {json.dumps(token_event, ensure_ascii=False)}\n\n"

        # ----- 2. 생성된 어시스턴트 메시지 DB 저장 (비동기) -----
        # 대화 내용에 따라 감정 분석을 수행하여 저장
        from agents.emotion import detect_user_emotion_fast
        emotion_result = await detect_user_emotion_fast(full_assistant_reply)
        detected_emotion = emotion_result.get("emotion", "neutral")

        if request.conversation_id and full_assistant_reply:
            try:
                assistant_data = {
                    "conversation_id": request.conversation_id,
                    "user_id": "00000000-0000-0000-0000-000000000000",
                    "role": "assistant",
                    "content": full_assistant_reply,
                    "detected_emotion": detected_emotion,
                }
                if db:
                    await db.insert("messages", assistant_data)
            except Exception as e:
                logger.error(f"어시스턴트 메시지 DB 저장 실패: {e}")

        # 4. 전체 생성 종료 시 'done' 이벤트 발생
        done_event = {
            "event": "done",
            "data": {
                "message_id": message_id,
                "detected_emotion": detected_emotion,
                "model_name": last_model_used,
                "life_graph_updated": False,
                "proactive_triggered": False
            }
        }

        yield f"data: {json.dumps(done_event, ensure_ascii=False)}\n\n"

    except asyncio.CancelledError:
        logger.warning("스트리밍이 클라이언트에 의해 중단되었습니다.")
    except Exception as e:
        logger.error(f"채팅 스트리밍 중 오류 발생: {e}")
        error_event = {"event": "error", "data": {"code": "500", "message": str(e)}}
        yield f"data: {json.dumps(error_event, ensure_ascii=False)}\n\n"


@router.post("")
async def chat_endpoint(request: ChatRequest, req: Request):
    """
    베푸 채팅 진입점 - Server-Sent Events(SSE) 방식으로 스트리밍 응답을 내보냅니다.
    """
    # StreamingResponse를 사용해 media_type="text/event-stream" 설정
    return StreamingResponse(
        generate_chat_response(request),
        media_type="text/event-stream"
    )

@router.get("/{conversation_id}")
async def get_chat_history(conversation_id: str):
    """
    특정 대화(conversation_id)의 이전 메시지 내역을 불러옵니다.
    """
    from backend.services.db import get_supabase_admin
    db = get_supabase_admin()
    
    if not db:
        return {"messages": []}
        
    try:
        # messages 테이블에서 conversation_id가 일치하는 레코드를 시간 역순(과거->현재 순)으로 가져옵니다.
        records = await db.select_eq("messages", "conversation_id", conversation_id, order_by="created_at", ascending=True)
        
        # 프론트엔드가 기대하는 포맷으로 변환
        formatted_messages = []
        for r in records:
            formatted_messages.append({
                "id": r.get("id", ""),
                "role": r.get("role", "user"),
                "content": r.get("content", ""),
                "detected_emotion": r.get("detected_emotion")
            })
            
        return {"messages": formatted_messages}
    except Exception as e:
        logger.error(f"채팅 내역 불러오기 실패: {e}")
        return {"messages": []}
