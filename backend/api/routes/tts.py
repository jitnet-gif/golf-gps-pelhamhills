from fastapi import APIRouter, Response, Query, HTTPException
from backend.services.tts import generate_speech
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get("")
async def tts_endpoint(text: str = Query(...), agent_id: str = Query("david")):
    """
    텍스트를 음성으로 변환하여 오디오 스트림(MP3)을 반환합니다.
    """
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    from backend.services.tts import ELEVENLABS_API_KEY
    if not ELEVENLABS_API_KEY or ELEVENLABS_API_KEY == "your-elevenlabs-key":
        raise HTTPException(
            status_code=503, 
            detail="TTS 서비스 설정이 완료되지 않았습니다. .env 파일에 실제 ELEVENLABS_API_KEY를 입력해주세요."
        )

    audio_data = await generate_speech(text, agent_id)
    
    if not audio_data:
        raise HTTPException(status_code=500, detail="TTS 생성에 실패했습니다. ElevenLabs API 응답을 확인하세요.")

    return Response(content=audio_data, media_type="audio/mpeg")
