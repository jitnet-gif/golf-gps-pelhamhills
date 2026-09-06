from fastapi import APIRouter
import logging
from backend.models.domain import EmotionDetectRequest, EmotionDetectResponse
from agents.persona import build_system_prompt, UserContext, SpeechStyle, EmotionMode
from agents.emotion import detect_user_emotion_fast

logger = logging.getLogger(__name__)

# 라우터 인터페이스 초기화
router = APIRouter()

@router.post("/emotion", response_model=EmotionDetectResponse)
async def detect_emotion(request: EmotionDetectRequest):
    """
    AI를 사용하여 텍스트에서 감정을 추출하는 API (삼중 폴백 적용)
    """
    result = await detect_user_emotion_fast(request.text)
    return EmotionDetectResponse(
        emotion=result.get("emotion", "neutral"),
        confidence=result.get("confidence", 0.5),
        reasoning=result.get("reasoning", "AI 분석 결과")
    )


@router.get("/prompt")
async def get_system_prompt(name: str = "친구", style: str = "informal", emotion: str = "neutral"):
    """
    테스트용: 현재 유저 컨텍스트 기반으로 생성된 시스템 프롬프트 반환
    """
    user_context = UserContext(
        nickname=name,
        speech_style=SpeechStyle.INFORMAL if style == "informal" else SpeechStyle.FORMAL,
        emotion_mode=EmotionMode.NEUTRAL,
        occupation=None,
        recent_memories=[],
        key_relationships=[],
        active_goals=[],
        active_concerns=[],
        today_schedule=[]
    )
    prompt = build_system_prompt(user_context)
    return {"system_prompt": prompt}
