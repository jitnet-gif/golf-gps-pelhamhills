# AI 전화 예약 · ElevenLabs + Twilio 연결 가이드

설계안: https://claude.ai/artifact/9mFKg3gz4gytLuj7ezqn18

## 구성

```
고객 전화 → Twilio 번호 → ElevenLabs 에이전트 ─(도구 호출)→ FastAPI /api/v1/voice/* → 티시트
                                   └ 통화 종료 → /api/v1/voice/post-call
고객 문자 → Twilio → /api/v1/sms/inbound ("C" 취소, STOP/START)
FastAPI → Twilio Messages API (확정·취소·리마인더·대기자 문자)
```

| 파일 | 역할 |
|---|---|
| `backend/services/voice_booking.py` | 가용 조회, 5분 hold, 확정, 조회·취소, 대기자, 리마인더 (규칙은 여기에만) |
| `backend/services/twilio_sms.py` | SMS 발송, 전화번호 E.164 정규화, Twilio 서명 검증 |
| `backend/api/routes/voice.py` | ElevenLabs 개인화 웹훅, 도구 6종, post-call 웹훅, 통화 조회 |
| `backend/api/routes/sms.py` | Twilio 인바운드·상태 콜백, 문자함 조회 |
| `backend/scripts/setup_voice_agent.py` | ElevenLabs 도구·에이전트 생성, Twilio 번호 연결 |

## 설정 순서

1. `pip install fastapi uvicorn httpx pydantic-settings python-dotenv tzdata`
2. `.env.example` 을 `.env` 로 복사하고 키 입력. `VOICE_TOOL_SECRET` 은 임의의 긴 문자열.
3. 서버 실행: `uvicorn backend.main:app --port 8000`
4. 외부 https 주소 확보 (로컬은 `ngrok http 8000`) → `PUBLIC_BASE_URL` 에 입력 후 서버 재시작
5. `python -m backend.scripts.setup_voice_agent --dry-run` 으로 요청 확인 → `--dry-run` 없이 실행
6. 출력된 `ELEVENLABS_AGENT_ID` 를 `.env` 에 저장
7. 스크립트가 마지막에 출력하는 대시보드 수동 설정 4가지 완료
   (개인화 웹훅, post-call 웹훅 → `ELEVENLABS_WEBHOOK_SECRET`, 프로샵 연결, Security 토글)
8. Twilio 번호로 전화해 테스트. 결과 확인: `GET /api/v1/voice/calls`, `GET /api/v1/sms/messages`

## 영업시간 외만 AI로 받기 (설계안 Q1 권장안)

기존 프로샵 번호의 착신전환을 영업시간 외에만 Twilio 번호로 걸어두면 됩니다.
Twilio 번호 자체는 항상 AI가 받습니다.

## 알아둘 점

- 티시트가 아직 인메모리이므로 서버 재시작 시 AI 예약·통화·문자 기록도 사라집니다. Supabase 이전 시 `voice_booking.py` 의 잠금·저장만 교체하면 됩니다.
- 요금은 `GREEN_FEES` (18홀 평일 $47.79, 주말 $58.41, 세전)만 있습니다. 9홀 요금이 없으면 AI가 프로샵으로 넘깁니다. 카트 요금은 현장 결제로 안내합니다.
- Stripe 결제 링크는 아직 연결하지 않았습니다. 확정 문자에는 "체크인 시 결제"로 안내합니다.
- 비밀값(`VOICE_TOOL_SECRET`, `ELEVENLABS_WEBHOOK_SECRET`, `TWILIO_AUTH_TOKEN`)이 비어 있으면 로컬 개발용으로 검증을 건너뜁니다. 운영에서는 반드시 채우세요.
- Twilio 표준 수신거부 키워드에 `CANCEL` 이 포함되므로 취소는 `C` 로 받습니다.
