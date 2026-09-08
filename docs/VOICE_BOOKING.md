# 음성 예약 (ElevenLabs Agents Platform)

손님이 **말로** 티타임을 예약하고 취소한다. 입구는 둘이고 뒤는 하나다.

```
 전화 (Twilio)  ─┐
                 ├─→  ElevenLabs 에이전트  ─→  /api/v1/voice/tools/*  ─→  티 시트
 웹 (/book/tee-time) ─┘                                                    (tee_sheet.json)
```

에이전트는 티 시트를 직접 만지지 않는다. 도구 여섯 개만 부를 수 있고, 정원·슬롯·
상태 전이의 규칙은 전부 `backend/api/routes/tee_sheet.py` 한 곳에 있다. 그래서
전화로 들어온 예약과 웹으로 들어온 예약이 같은 자리를 두 번 팔 수 없다.

## 파일 지도

| 파일 | 역할 |
|---|---|
| `backend/api/routes/voice.py` | 도구 6개 + 웹 세션 발급 + post-call 웹훅 |
| `backend/services/voice_agent.py` | ElevenLabs HTTP 클라이언트 |
| `backend/api/routes/tee_sheet.py` | 홀드 개념(`BookingSource`, `holdExpiresAt`)이 사는 곳 |
| `ops/elevenlabs/agent.json` | 에이전트 프롬프트와 도구 스키마의 **원본** |
| `scripts/elevenlabs_sync_agent.py` | 위 JSON 을 계정에 밀어 넣는다 |
| `frontend/components/booking/VoiceBooking.tsx` | 웹 위젯 |
| `frontend/lib/voice/session.ts` | signed URL 을 백엔드에서 받아온다 |
| `backend/tests/test_voice_booking.py` | 29개 테스트 |

## 도구 여섯 개

| 도구 | 하는 일 |
|---|---|
| `find_tee_times` | 날짜·인원·시간대 → 실제로 팔 수 있는 티타임 |
| `hold_tee_time` | 3분짜리 소프트 홀드. 이름을 받는 동안 자리를 잠근다 |
| `release_hold` | 손님이 마음을 바꾸면 즉시 반납 |
| `confirm_booking` | 홀드 → 실제 예약 |
| `lookup_booking` | 전화번호 **+** 성으로 조회 |
| `cancel_booking` | 취소 (`status=cancelled`, 삭제 아님) |

## 왜 홀드가 필요한가

손님이 "3시요" 라고 말하고 이름을 부르는 20초 사이에, 웹 손님이 같은 3시를 살 수
있다. 에이전트는 "예약됐습니다" 라고 말한 뒤 서버는 409 를 낸다.

그래서 홀드를 **진짜 예약 레코드**로 만든다 — `status=reserved`,
`source=voice_hold`, `holdExpiresAt=지금+3분`, 인원수만큼의 Guest 플레이어.
이러면 `tee_time_players()` 가 자동으로 그 자리를 찬 것으로 세므로 웹 손님에게
보이지 않는다. 만료되면 정원 계산에서 **즉시** 빠지고(`occupies_seat`), 레코드는
다음 정리 패스(`purge_expired_holds`)가 지운다.

## 취소를 막는 문 세 개

취소는 되돌리기 어렵다. 잘못 취소하면 남의 라운드가 날아간다.

1. **조회 없이는 취소 불가.** `cancel_booking` 은 같은 통화의 `lookup_booking` 이
   확인해 준 booking_id 만 받는다 (`_Session.revealed`). 에이전트가 id 를 지어내
   남의 예약을 취소할 수 없다. `conversation_id` 가 없으면 통화를 특정할 수 없으므로
   **그것만으로 거절한다** — "세션이 있으면 검사" 로 두면 그 필드를 빼는 것으로
   이 문을 통과할 수 있다.
2. **성이 일치해야 한다.** 조회에 이미 전화번호+성을 요구했고, 취소에서 한 번 더 본다.
3. **티오프 2시간 이내는 프로 샵.** `CANCEL_CUTOFF_MINUTES`. 카트 배정과 환불이
   걸려 있어 사람이 판단할 구간이다.

그리고 레코드를 지우지 않는다. `status=cancelled` 로만 바꾸므로 프로 샵이 티
시트에서 되돌릴 수 있다. 감사 로그에 누가 왜 취소했는지 남는다.

## 필요한 API 키 권한 ⚠️

`backend/services/tts.py` 가 쓰던 TTS 전용 키로는 **동작하지 않는다.** Agents
Platform 은 별도 권한이 필요하다. ElevenLabs 대시보드에서 키를 만들 때 다음을 켤 것:

- `convai_read` — 에이전트/도구 조회, signed URL 발급
- `convai_write` — 에이전트/도구 생성·수정
- `text_to_speech` — 기존 `tts.py` 가 계속 쓴다면

권한이 빠진 키는 401 에 `missing the permission convai_read` 가 찍힌다.

## 설정 (.env, 저장소 루트)

```
ELEVENLABS_API_KEY=sk_...            # 위 권한이 켜진 키
ELEVENLABS_AGENT_ID=                 # 최초 동기화가 찍어 준다
VOICE_TOOL_SECRET=                   # 배포에서는 반드시 채울 것
ELEVENLABS_WEBHOOK_SECRET=           # post-call 웹훅 HMAC
PUBLIC_API_BASE_URL=                 # 에이전트가 우리를 부를 **공개** 주소
CLUB_TIMEZONE=America/Toronto        # 선택. 기본값이 이것이다
```

`VOICE_TOOL_SECRET` 이 비면 도구 엔드포인트는 **인증 없이 열린다.** 로컬에서 curl
로 두드려 보라고 그렇게 뒀다. 배포에서 비워 두면 누구나 예약을 만들고 취소할 수 있다.

셸 환경변수로 덮어쓰려 하지 말 것. `backend/core/config.py` 가 `load_dotenv(...,
override=True)` 로 `.env` 를 읽으므로 **`.env` 가 항상 이긴다.** 값을 바꾸려면
`.env` 를 고쳐야 한다.

`/voice/tools/*` 만 이 시크릿으로 막힌다. `/voice/session` 은 브라우저가 부르고
`/voice/post-call` 은 ElevenLabs 가 자기 HMAC 서명으로 부르므로 둘 다 시크릿을
가질 수 없다 — 같은 라우터에 두면 시크릿을 켠 순간 웹 위젯이 조용히 죽는다.
`/voice/session` 은 대신 IP 당 분당 10회로 제한한다.

## 세우는 순서

1. **권한이 켜진 키**를 `.env` 에 넣는다.
2. 공개 주소를 만든다. 로컬이면 터널을 띄운다:
   ```
   ngrok http 8000
   # PUBLIC_API_BASE_URL=https://<주소>.ngrok-free.app/api/v1
   ```
   ElevenLabs 서버는 localhost 에 닿지 못한다. 이 값이 localhost 면 도구 호출이
   전부 실패한다 (스크립트가 경고한다).
3. 에이전트를 만든다:
   ```
   python scripts/elevenlabs_sync_agent.py --dry-run   # 페이로드 확인
   python scripts/elevenlabs_sync_agent.py             # 실제 생성
   ```
   찍힌 `ELEVENLABS_AGENT_ID` 를 `.env` 에 넣는다. 안 넣으면 다음 실행이 또 만든다.
4. 웹 위젯을 확인한다. 백엔드와 프론트를 띄우고 `/book/tee-time` 의
   "Book by voice" 를 누른다.
5. 전화선 (선택):
   ```
   python scripts/elevenlabs_sync_agent.py --phones
   python scripts/elevenlabs_sync_agent.py --assign-phone <phone_number_id>
   ```
   번호 자체는 **Twilio 에서 사서 ElevenLabs 대시보드에 등록**해야 한다. 이
   저장소 밖의 계정 작업이라 스크립트가 대신할 수 없다.
6. post-call 웹훅을 `{PUBLIC_API_BASE_URL}/voice/post-call` 로 등록하고, 발급된
   시크릿을 `ELEVENLABS_WEBHOOK_SECRET` 에 넣는다.

프롬프트나 도구를 고칠 때는 `ops/elevenlabs/agent.json` 을 고치고 스크립트를 다시
돌린다. 대시보드에서 직접 고치면 다음 동기화에 덮어써진다.

## 테스트

```
python -m pytest backend/tests/test_voice_booking.py -q
```

시간을 2026-09-08 06:00 으로 고정한다. "지나간 티타임은 팔지 않는다", "티오프
2시간 전 이후에는 취소하지 않는다" 는 지금 몇 시인지에 따라 답이 달라지므로,
실제 시계로 돌리면 밤과 아침의 결과가 달라진다.

## 알아 둘 것

- **통화 세션은 프로세스 메모리에 있다.** 백엔드를 여러 인스턴스로 띄우면 취소
  권한 검사(`_Session.revealed`)가 인스턴스마다 따로 논다. 지금은 단일
  프로세스 전제다. 수평 확장하려면 이 상태를 Redis 같은 공유 저장소로 옮겨야 한다.
- **전화번호와 통화 기록이 `tee_sheet.json` 에 평문으로 쌓인다.** 보관 기간
  정책이 아직 없다.
- `backend/api/routes/tts.py` 는 `main.py` 에 **등록돼 있지 않다** (이 작업 전부터
  그랬다). Agents Platform 이 그 역할을 대신하므로 지울지 살릴지 결정이 필요하다.
