import os
import httpx
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ElevenLabs API 설정
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
# 각 에이전트별 기본 보이스 ID (필요시 .env에서 관리 가능)
DEFAULT_VOICE_ID = os.getenv("ELEVENLABS_BEPU_VOICE_ID", "EXAVITQu4vr4xnSDxMaL") # 'Bella' (기본 보이스)

# 에이전트별 보이스 매핑 (David, Sarah, Liam, Chloe, Minji, Junho)
# 실제 서비스 단계에서 커스텀 보이스 ID로 대체 가능합니다.
AGENT_VOICES = {
    "david": "VR6Aewyiyih3ID3qcqCQ", # Liam (남성, 고집)
    "sarah": "EXAVITQu4vr4xnSDxMaL", # Bella (여성, 부드러움)
    "liam": "N2lVS1wzexD6fG3U4p4e",   # Josh (남성, 편안함)
    "chloe": "ThT5KcBe7VKqWn94uTgc",  # Gigi (여성, 활기)
    "minji": "jBpfuIE2acCO8z3wKNLl",  # Gigi (여성, 한국어 뉘앙스 최적화 필요시)
    "junho": "pNInz6obpgmqEhcMCt4D",  # Adam (남성, 신뢰감 있는 목소리)
}

async def generate_speech(text: str, agent_id: Optional[str] = "david") -> Optional[bytes]:
    """
    텍스트를 ElevenLabs API를 통해 음성 데이터(bytes)로 변환합니다.
    """
    # 키가 없거나 플레이스홀더인 경우 체크
    if not ELEVENLABS_API_KEY or ELEVENLABS_API_KEY == "your-elevenlabs-key":
        logger.warning(f"ElevenLabs API Key가 설정되지 않았거나 기본값입니다: {ELEVENLABS_API_KEY}")
        return None

    # 너무 긴 텍스트는 ElevenLabs API 제한 및 비용 절감을 위해 절사
    safe_text = (text[:1000] + "...") if len(text) > 1000 else text

    voice_id = AGENT_VOICES.get(agent_id, DEFAULT_VOICE_ID)
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"

    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY
    }

    data = {
        "text": safe_text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.5
        }
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=data, headers=headers, timeout=45.0)
            if response.status_code == 200:
                return response.content
            else:
                error_detail = response.text
                logger.error(f"ElevenLabs API 오류: {response.status_code} - {error_detail}")
                return None
    except Exception as e:
        logger.error(f"TTS 생성 중 예외 발생: {e}")
        return None
