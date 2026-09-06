from fastapi import APIRouter, Depends, HTTPException
from typing import List
import logging
from backend.models.domain import OnboardingRequest, OnboardingResponse
from backend.core.config import settings

# 에이전트 페르소나 엔진 임포트 (시스템 프롬프트 생성용)
from agents.persona import build_system_prompt, UserContext, EmotionMode, SpeechStyle

logger = logging.getLogger(__name__)

router = APIRouter()

@router.post("/", response_model=OnboardingResponse)
async def submit_onboarding(data: OnboardingRequest):
    """
    사용자의 초기 정보를 받아 데이터베이스에 저장하고, 
    베푸의 첫 인사를 생성하여 반환합니다.
    """
    logger.info(f"온보딩 요청 수신: {data.name} ({data.mbti})")
    
    # 1. TODO: NeonDB에 사용자 정보 저장 로직 구현
    # 유저 식별자 생성 및 저장 처리
    mock_user_id = "user_12345"
    
    # 2. 페르소나 엔진을 통해 첫 인사 컨텍스트 구성
    ctx = UserContext(
        nickname=data.name,
        mbti=data.mbti,
        interests=data.interests,
        speech_style=SpeechStyle(data.speechStyle),
        emotion_mode=EmotionMode.NEUTRAL,
        agent_id=data.preferred_agent
    )
    
    # 3. Claude Sonnet 4.6 (혹은 설정된 모델)을 통한 첫 인사 생성
    # 여기서는 페르소나 설정에 따른 환영 메시지를 모의 생성하거나 
    # 실제 에이전트를 호출할 수 있습니다.
    
    greet_style = {
        "informal": f"안녕 {data.name}! 만나서 정말 반가워. 우리 앞으로 진짜 친하게 지내자! 😊 너에 대해 알려준 {', '.join(data.interests)} 관심사들 기억할게!",
        "formal": f"안녕하세요 {data.name}님! 만나서 반갑습니다. {data.mbti} 성향이시라니 저와 잘 맞을 것 같아요. 언제든 편하게 말씀해 주세요. 😊",
        "polite": f"반갑습니다 {data.name}님. 귀한 정보를 공유해주셔서 감사합니다. 당신의 파트너로서 최선을 다해 지원하겠습니다."
    }
    
    welcome_msg = greet_style.get(data.speechStyle, greet_style["informal"])
    
    return OnboardingResponse(
        message="온보딩이 성공적으로 완료되었습니다.",
        initial_greeting=welcome_msg,
        user_id=mock_user_id
    )
