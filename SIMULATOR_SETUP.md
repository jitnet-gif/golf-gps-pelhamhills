# 스크린 골프 예약 시스템 설정 가이드

이 문서는 Pelham Hills 스크린 골프 예약 시스템을 설정하고 실행하는 방법을 설명합니다.

## 시스템 구조

### 백엔드 (FastAPI + PostgreSQL)
- **파일**: `backend/api/routes/simulator.py`, `backend/database.py`, `backend/main.py`
- **모델**: `SimulatorBay`, `SimulatorReservation`
- **엔드포인트**:
  - `GET /api/v1/simulator/bays` - 베이 목록 조회
  - `GET /api/v1/simulator/availability` - 가용 시간대 조회
  - `POST /api/v1/simulator/reservations` - 예약 생성
  - `GET /api/v1/simulator/reservations/{confirmation_code}` - 예약 조회
  - `POST /api/v1/simulator/admin/init-bays` - 베이 초기화 (관리자용)

### 프론트엔드 (Next.js + React)
- **파일**: `frontend/app/simulator/page.tsx`
- **라우트**: `/simulator` - 4단계 예약 흐름
- **환경변수**: `NEXT_PUBLIC_API_URL`

## 설정 단계

### 1. 백엔드 환경 설정

#### 데이터베이스 설정
PostgreSQL이 실행 중인지 확인하고, 다음 환경변수를 설정합니다:

```bash
# Windows (PowerShell)
$env:DATABASE_URL = "postgresql+asyncpg://user:password@localhost/pelhamhills"
```

```bash
# Linux/Mac
export DATABASE_URL="postgresql+asyncpg://user:password@localhost/pelhamhills"
```

#### 이메일 설정 (선택사항)
예약 확인 이메일을 발송하려면, 다음 환경변수를 설정합니다:

```bash
# Windows (PowerShell)
$env:SMTP_HOST = "smtp.gmail.com"
$env:SMTP_PORT = "587"
$env:SENDER_EMAIL = "your-email@gmail.com"
$env:SENDER_PASSWORD = "your-app-password"  # Gmail 앱 비밀번호 사용
```

Gmail 앱 비밀번호는 다음 링크에서 생성할 수 있습니다:
https://myaccount.google.com/apppasswords

### 2. 데이터베이스 초기화

백엔드를 실행한 후, 다음 명령으로 테이블을 생성합니다:

```bash
python backend/main.py
```

그 다음, 관리자 초기화 엔드포인트를 호출하여 기본 베이를 생성합니다:

```bash
curl -X POST http://localhost:8000/api/v1/simulator/admin/init-bays
```

또는 Python에서:

```python
import asyncio
from backend.database import engine, Base, get_db, SimulatorBay, async_session

async def init_db():
    # Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Create default bays
    async with async_session() as session:
        default_bays = [
            SimulatorBay(bay_number=1, bay_type="right_handed", hourly_rate=20.0),
            SimulatorBay(bay_number=2, bay_type="right_handed", hourly_rate=20.0),
            SimulatorBay(bay_number=3, bay_type="right_handed", hourly_rate=20.0),
            SimulatorBay(bay_number=4, bay_type="left_right", hourly_rate=20.0),
            SimulatorBay(bay_number=5, bay_type="vip", hourly_rate=25.0),
        ]
        for bay in default_bays:
            session.add(bay)
        await session.commit()

asyncio.run(init_db())
```

### 3. 프론트엔드 환경 설정

`.env.local` 파일을 생성하고 백엔드 API URL을 설정합니다:

```bash
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
```

배포 환경에서는 실제 프로덕션 URL을 사용합니다:

```bash
NEXT_PUBLIC_API_URL=https://api.pelhamhills.com
```

### 4. 시스템 실행

#### 백엔드 실행 (포트 8000)
```bash
cd backend
python main.py
```

#### 프론트엔드 실행 (포트 3000)
```bash
cd frontend
npm install
npm run dev
```

브라우저에서 http://localhost:3000/simulator 접속

## 기본 데이터

초기화 시 다음 베이가 생성됩니다:

| Bay # | Type | Rate |
|-------|------|------|
| 1 | Right-Handed | $20/h |
| 2 | Right-Handed | $20/h |
| 3 | Right-Handed | $20/h |
| 4 | Left & Right | $20/h |
| 5 | VIP | $25/h |

## API 사용 예제

### 1. 가용 시간대 조회
```bash
curl "http://localhost:8000/api/v1/simulator/availability?date=2026-09-09&bay_type=right_handed&duration_hours=1"
```

**응답**:
```json
{
  "date": "2026-09-09",
  "bay_type": "right_handed",
  "duration_hours": 1,
  "is_closed": false,
  "available_slots": [
    {
      "time": "14:00",
      "available_bays": 3,
      "total_bays": 3
    },
    {
      "time": "14:15",
      "available_bays": 3,
      "total_bays": 3
    }
    // ...
  ]
}
```

### 2. 예약 생성
```bash
curl -X POST http://localhost:8000/api/v1/simulator/reservations \
  -H "Content-Type: application/json" \
  -d '{
    "bay_id": 1,
    "date": "2026-09-09",
    "start_time": "14:00",
    "duration_hours": 1,
    "player_count": 1,
    "customer_name": "John Doe",
    "customer_email": "john@example.com",
    "phone": "+1 (905) 123-4567",
    "notes": ""
  }'
```

**응답**:
```json
{
  "id": 1,
  "confirmation_code": "A1B2C3D4E5",
  "bay_type": "Right Handed",
  "date": "2026-09-09",
  "start_time": "14:00",
  "duration_hours": 1,
  "player_count": 1,
  "total_price": 20.0
}
```

### 3. 예약 조회
```bash
curl "http://localhost:8000/api/v1/simulator/reservations/A1B2C3D4E5"
```

## 운영 시간

- **평일**: 수요일 - 일요일, 오후 2시 - 밤 10시
- **휴무**: 월요일 - 화요일

## 정책

- **취소**: 예약 시작 12시간 전까지 무료 취소
- **부분 취소**: 12시간 이후 취소 시 예약 금액의 50% 청구
- **노쇼**: 100% 청구

## 트러블슈팅

### "No active bays found" 에러
**원인**: 베이가 초기화되지 않음
**해결**: `POST /api/v1/simulator/admin/init-bays` 엔드포인트 호출

### 예약 이메일 수신 안 됨
**원인**: SMTP 설정 누락
**해결**: 이메일 환경변수 설정 후 백엔드 재시작

### CORS 에러
**원인**: 프론트엔드 URL이 백엔드의 CORS 허용 목록에 없음
**해결**: `backend/core/config.py`의 `BACKEND_CORS_ORIGINS` 설정 확인

## 다음 단계 (v2)

- [ ] Google OAuth 통합
- [ ] SMS 인증
- [ ] 결제 처리 (Stripe)
- [ ] 예약 취소 기능
- [ ] 관리자 대시보드
- [ ] 예약 수정 기능
- [ ] 다중 베이 예약 (동일 시간)
