from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID

# 감정 상태 타입
EmotionState = Literal['neutral', 'happy', 'stressed', 'sad', 'angry', 'overwhelmed', 'anxious', 'excited']

# 말투 타입
SpeechStyle = Literal['informal', 'formal', 'polite']

# ===== 기본 응답 모델 =====
class UserContext(BaseModel):
    """채팅 요청 시 넘어오는 사용자 기본 문맥 정보"""
    name: str = "사용자"
    speechStyle: SpeechStyle = "informal"
    emotionState: EmotionState = "neutral"
    agent_id: str = "david"  # 기본 캐릭터
    language: str = "ko"     # 기본 언어 (ko, en, ja, zh, vi)

class Attachment(BaseModel):
    type: Literal['image', 'file']
    url: str
    name: str
    size: int

# ===== 데이터베이스 모델 (Pydantic) =====

class MessageBase(BaseModel):
    role: Literal['user', 'assistant', 'system']
    content: str
    attachments: Optional[List[Attachment]] = []

class MessageCreate(MessageBase):
    conversation_id: str
    user_id: str
    detected_emotion: Optional[EmotionState] = "neutral"
    emotion_confidence: Optional[float] = 1.0

class MessageResponse(MessageBase):
    id: UUID
    conversation_id: UUID
    user_id: UUID
    detected_emotion: Optional[EmotionState]
    emotion_confidence: Optional[float]
    created_at: datetime
    
# ===== API 요청 모델 =====

class ChatRequest(BaseModel):
    """/api/v1/chat 요청 스키마"""
    messages: List[MessageBase]
    user: UserContext
    # 사용자 정의 API 키 (모델별 리스트)
    user_keys: Optional[Dict[str, List[str]]] = None
    # 페르소나 출석 상태 (liam: attend, chloe: absent 등)
    presence: Optional[Dict[str, str]] = None
    # 향후 대화 ID나 세션 ID를 넘길 수 있습니다
    conversation_id: Optional[str] = None
    language: Optional[str] = "ko" # 루트 레벨에서도 언어 수신 가능하도록 보완

class EmotionDetectRequest(BaseModel):
    """/api/v1/agents/emotion 요청 스키마"""
    text: str
    recent_history: Optional[List[str]] = []

class EmotionDetectResponse(BaseModel):
    """/api/v1/agents/emotion 응답 스키마"""
    emotion: EmotionState
    confidence: float
    reasoning: str

# ===== 온보딩 관련 모델 =====

class OnboardingRequest(BaseModel):
    """/api/v1/onboarding 요청 스키마"""
    name: str = Field(..., description="사용자 닉네임")
    mbti: Optional[str] = Field(None, description="사용자 MBTI")
    interests: List[str] = Field(default_factory=list, description="사용자 관심사 리스트")
    speechStyle: SpeechStyle = Field("informal", description="선호하는 말투")
    preferred_agent: str = Field("david", description="선택한 첫 번째 에이전트 ID")

class OnboardingResponse(BaseModel):
    """온보딩 완료 후 응답"""
    status: str = "success"
    message: str
    initial_greeting: str
    user_id: Optional[str] = None
