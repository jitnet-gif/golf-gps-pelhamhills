# Pelham Hills 프로젝트 전체 구조 설명서

작성일: 2026-09-16 · 기준 커밋: `2146bb5`

Pelham Hills Golf Club(온타리오)의 **공개 홈페이지 + 고객 예약 사이트 + 프로 샵 어드민(티 시트·상점·리포트)** 과 그 뒤의 **예약 API** 를 담은 저장소다. 코스 위에서 쓰는 GPS 앱은 원래 이 저장소의 `golf-gps-app/` 에 있었지만 `2146bb5` 커밋에서 빠져 `E:\golf-gps-app` 로 분리됐다(아래 7장).

---

## 1. 한눈에 보기

```
            방문자 / 고객 / 프로 샵 직원 (브라우저)
                          │
                          ▼
 ┌─────────────────────────────────────────────┐
 │ frontend/  Next.js 16 정적 export           │   Vercel  (pelhamhills.vercel.app)
 │   /        공개 사이트                       │
 │   /book/*  예약 사이트 (티타임·실내·조회)    │
 │   /admin/* 어드민 (티 시트·상점·리포트 …)    │
 └──────────────────────┬──────────────────────┘
                        │ fetch  (NEXT_PUBLIC_API_URL)
                        ▼
 ┌─────────────────────────────────────────────┐        ┌──────────────────────┐
 │ backend/  FastAPI (Python 3.12)             │◀──────│ ElevenLabs 음성 에이전트│
 │   /api/v1/tee-sheet/*   티 시트·예약        │ 웹훅   │ (전화 Twilio / 웹 위젯)│
 │   /api/v1/retail/*      프로 샵 판매·재고   │        └──────────────────────┘
 │   /api/v1/simulator/*   실내 시뮬레이터     │
 │   /api/v1/voice/*       음성 예약 도구      │   Fly.io  (앱 pelhamhills-api, 토론토 yyz)
 └───────┬─────────────────────────┬───────────┘
         │ PostgREST(HTTPS)        │ 파일
         ▼                         ▼
 ┌──────────────────────┐   ┌──────────────────────┐
 │ Supabase (Postgres)  │   │ Fly 볼륨  /data      │
 │ pelham_tee_bookings  │   │ retail.json          │
 │ pelham_customers     │   │ simulator.json       │
 └──────────────────────┘   └──────────────────────┘
```

| 구분 | 사용 기술 | 위치 |
|---|---|---|
| 프론트엔드 | TypeScript, Next.js 16.1 (App Router), React 19.2, Tailwind CSS 4 | `frontend/` |
| 백엔드 | Python 3.12, FastAPI 0.109, Pydantic 2.6, Uvicorn, httpx | `backend/` |
| 데이터베이스 | Supabase(PostgreSQL) + JSON 파일 저장소 | `supabase/`, Fly 볼륨 |
| 코드 저장 | Git / GitHub `jitnet-gif/golf-gps-pelhamhills`, 브랜치 `main` | — |
| 프론트 배포 | Vercel (정적 파일 호스팅) | `frontend/vercel.json` |
| 백엔드 배포 | Fly.io (Docker 컨테이너, 머신 1대 + 볼륨) | `fly.toml`, `backend/Dockerfile` |
| 외부 연동 | ElevenLabs(음성 예약), Chronogolf/Lightspeed(이관 원본) | `ops/`, `scripts/` |

---

## 2. 디렉터리 구조

```
PELHAMHILLS/
├── frontend/                 Next.js 웹앱 (공개 사이트·예약·어드민)
│   ├── app/                  App Router 페이지 (아래 3장)
│   ├── components/           admin · booking · teesheet · retail · site · chat · bepu
│   ├── hooks/useTeeSheet.ts  티 시트 상태·API 호출·오프라인 폴백
│   ├── lib/                  apiHost.ts(API 주소 결정) · nav.ts(경로 지도)
│   │   ├── teeSheet/         티 시트 API 클라이언트·영수증·날짜
│   │   ├── retail/           상점 API·바코드·영수증 인쇄
│   │   └── voice/            음성 세션(signed URL) 발급
│   ├── public/data/teesheet-public.json   개인정보를 뺀 티 시트 스냅샷
│   ├── scripts/verify-*.mjs  Playwright 화면 확인 스크립트
│   ├── next.config.mjs       output: "export" (정적 export)
│   └── vercel.json           Vercel 빌드 설정
│
├── backend/                  FastAPI 예약 API
│   ├── main.py               앱 진입점, 라우터 등록, 헬스 체크(GET /)
│   ├── core/config.py        환경변수(.env) 로딩, CORS 허용 출처
│   ├── api/routes/           tee_sheet · retail · simulator · voice (+ 미사용 chat/agents/onboarding/tts)
│   ├── services/             저장 계층
│   │   ├── tee_sheet_store.py      티 시트 저장소 입구 (json | supabase 선택)
│   │   ├── tee_sheet_supabase.py   Supabase REST 구현
│   │   ├── customer_store.py       고객 명부
│   │   ├── retail_store.py         상점 JSON 저장소
│   │   ├── simulator_store.py      시뮬레이터 JSON 저장소
│   │   └── voice_agent.py          ElevenLabs HTTP 클라이언트
│   ├── tests/                pytest (약 310개 테스트)
│   ├── data/                 ⚠️ 로컬 데이터·고객 CSV·백업 (git·이미지에서 제외)
│   ├── Dockerfile            배포 이미지
│   ├── docker-entrypoint.sh  빈 티 시트 파일 보장
│   ├── requirements-api.txt  배포용 최소 의존성
│   └── requirements.txt      개발 머신용 전체 의존성
│
├── supabase/
│   ├── migrations/           0001_customers · 0002_pelham_prefix · 0002_tee_bookings
│   └── sql_editor_0001_0002.sql   SQL Editor 에 붙여 넣는 합본
│
├── scripts/                  데이터 이관·운영 스크립트 (5장)
├── ops/elevenlabs/agent.json 음성 에이전트 프롬프트·도구 정의 원본
├── docs/                     설계·운영 문서
├── fly.toml                  Fly.io 배포 설정
├── .env.example              루트 .env 템플릿
└── (레거시) wrangler.toml, .github/workflows/deploy.yml, monitoring/, shared/,
    INFRASTRUCTURE.md, DEVOPS_SETUP_SUMMARY.md, SIMULATOR_SETUP.md  → 9장
```

---

## 3. 프론트엔드 (`frontend/`)

### 3.1 기술 스택
- **Next.js 16.1.6 / React 19.2.3 / TypeScript 5**
- **Tailwind CSS 4** (`@tailwindcss/postcss`)
- `@elevenlabs/client` — 웹 음성 예약 위젯
- `@playwright/test` — 화면 확인 스크립트(`frontend/scripts/verify-*.mjs`)
- ESLint 9 (`eslint-config-next`)

### 3.2 정적 export 라는 제약
`next.config.mjs` 가 `output: "export"` 로 되어 있어 `next build` 결과는 `out/` 폴더의 **순수 HTML/JS/CSS** 다. 그래서:
- 서버 컴포넌트의 런타임 실행, 미들웨어, rewrite, Route Handler(`app/api`), Server Action 이 **없다.**
- 모든 데이터는 브라우저가 FastAPI 를 직접 호출해 가져온다.
- 공개/예약/어드민 구분은 **경로(path)** 로만 한다 (`lib/nav.ts`).
- `typescript.ignoreBuildErrors: true` — 타입 검사는 `npx tsc --noEmit` 으로 따로 돌린다.

### 3.3 세 개의 표면(surface)

| 표면 | 경로 | 사용자 | 주요 페이지 |
|---|---|---|---|
| 공개 사이트 | `/` | 방문자 | `app/page.tsx` (섹션 앵커로 구성된 홈 한 장) |
| 예약 사이트 | `/book/*` | 고객 | `/book`, `/book/tee-time`, `/book/indoor`, `/book/lookup` |
| 어드민 | `/admin/*` | 프로 샵 직원 | `/admin`, `/admin/retail`, `/admin/customers`, `/admin/reports`, `/admin/pricing`, `/admin/dynamic-pricing`, `/admin/promotions`, `/admin/events`, `/admin/tour-operators`, `/admin/business-intelligence`, `/admin/radar`, `/admin/integrations`, `/admin/settings` |

그 밖에 `/teesheet`(티 시트 격자), `/simulator`, `/booking` 과 루트 레벨의 옛 경로들(`/pricing`, `/reports` …)이 남아 있다. 새 링크는 `lib/nav.ts` 에서만 만든다.

### 3.4 API 주소 결정 (`lib/apiHost.ts`)
- `NEXT_PUBLIC_API_URL` (예: Fly 백엔드 주소) → `+ /api/v1` 이 API 베이스.
- `NEXT_PUBLIC_*` 는 **빌드 시점에 번들에 박힌다.** 로컬 `.env.local` 의 `http://localhost:8000` 이 배포 번들에 들어간 사고가 있었고, 그래서:
  - `.vercelignore` 가 `.env.local` 업로드를 막는다.
  - 배포된 페이지에서 loopback 주소가 잡히면 요청하지 않고 "온라인 예약 불가, 프로 샵에 전화" 안내로 넘어간다.

### 3.5 오프라인 폴백
`hooks/useTeeSheet.ts` 는 API 에 닿지 못하면 `public/data/teesheet-public.json` 을 읽는다. 이 스냅샷은 `scripts/build_public_snapshot.py` 가 **허용 목록 방식으로 이름·이메일·전화·우편번호를 제거**해 만든 것이다(개인정보가 남아 있으면 쓰기를 거부).

---

## 4. 백엔드 (`backend/`)

### 4.1 기술 스택
| 패키지 | 버전 | 용도 |
|---|---|---|
| Python | 3.12 (Docker) / 개발 머신 3.14 | |
| FastAPI | 0.109.2 | 웹 프레임워크 |
| Uvicorn[standard] | 0.27.0 | ASGI 서버 |
| Pydantic / pydantic-settings | 2.6.3 / 2.2.1 | 요청·응답 모델, 설정 |
| httpx | 0.25.2 | Supabase REST·ElevenLabs 호출 |
| python-dotenv | 1.0.0 | `.env` 로딩 |
| tzdata | 2024.1 | `America/Toronto` 시간대 (slim 이미지에 없음) |

배포 이미지는 `requirements-api.txt` 만 설치한다. `requirements.txt` 는 SQLAlchemy·psycopg2·pgvector·anthropic 등이 든 개발용 목록으로, 예약 API 는 이들을 쓰지 않는다.

### 4.2 앱 구성 (`main.py`)
- `include_route_module()` 로 라우터를 등록한다. 임포트가 실패하면 **로그만 남기고 계속 기동**한다.
- 실제로 뜨는 라우터: `tee_sheet`, `simulator`, `retail`, `voice`
- 뜨지 않는 라우터: `chat`, `agents`, `onboarding` — 저장소에 없는 모듈을 임포트해서 실패한다(의도된 동작, BEPU AI 어시스턴트 시절의 흔적).
- `GET /` → `{"status": "online", ...}` — Fly 헬스 체크가 이것을 본다.
- CORS: `core/config.py` 의 `ALLOWED_ORIGINS` (로컬 3000/5173/4173, `pelhamhills.vercel.app`, `golf-gps-pelhamhills*.vercel.app`, `bepu.app`). 운영에서는 `fly secrets` 로 덮어쓴다.

### 4.3 API 엔드포인트 (접두사 `/api/v1`)

**티 시트** — `api/routes/tee_sheet.py`
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/tee-sheet/slots` | 날짜별 티 타임 슬롯 |
| GET·POST | `/tee-sheet/bookings` | 예약 목록 / 생성 |
| GET·PATCH·DELETE | `/tee-sheet/bookings/{id}` | 예약 조회·수정·삭제 |
| POST | `/tee-sheet/bookings/{id}/players` | 플레이어 추가 |
| PATCH·DELETE | `/tee-sheet/bookings/{id}/players/{pid}` | 플레이어 수정(결제·카트 등)·삭제 |
| GET | `/tee-sheet/reports/daily`, `/tee-sheet/reports/week` | 일간·주간 리포트 |
| GET·POST | `/tee-sheet/orchestration/*`, `/tee-sheet/worker/run` | 배치·리마인더·정리 작업 |

규칙: 한 티 타임 최대 4명, 상태 `reserved / checked_in / paid / cancelled / no_show / blocked`, 출처 `staff / web / voice / voice_hold`.

**프로 샵** — `api/routes/retail.py`: `/retail/products`(CRUD), `/retail/sales`(판매·조회·환불), `/retail/reports/daily`, `/retail/inventory/low-stock`

**실내 시뮬레이터** — `api/routes/simulator.py`: `/simulator/bays`, `/simulator/availability`, `/simulator/reservations`, `/simulator/reservations/{code}`, `/simulator/admin/init-bays`

**음성 예약** — `api/routes/voice.py` (자세히: `docs/VOICE_BOOKING.md`)
- 에이전트 도구 6개 `/voice/tools/{find-tee-times, hold-tee-time, release-hold, confirm-booking, lookup-booking, cancel-booking}` — `VOICE_TOOL_SECRET` 공유 시크릿 헤더로 보호
- `/voice/session` — 웹 위젯용 signed URL 발급
- `/voice/post-call` — 통화 종료 웹훅 (`ELEVENLABS_WEBHOOK_SECRET` HMAC 검증)

로컬에서 `http://localhost:8000/docs` 로 Swagger UI 를 볼 수 있다.

### 4.4 동시성 주의
정원 검사와 저장을 묶는 잠금은 **프로세스 안의 `threading.RLock`** 뿐이다. 그래서 Fly 머신을 2대 이상으로 늘리면 같은 티 타임이 두 번 팔릴 수 있다. **`fly scale count 1` 을 유지할 것.**

---

## 5. 데이터베이스와 데이터 저장

### 5.1 저장소 종류
| 데이터 | 저장 위치 (운영) | 선택 방법 | 코드 |
|---|---|---|---|
| 티 시트 예약 | Supabase `public.pelham_tee_bookings` | `TEE_SHEET_BACKEND=supabase` (기본값 `json`) | `services/tee_sheet_store.py` → `tee_sheet_supabase.py` |
| 고객 명부 | Supabase `public.pelham_customers` | — | `services/customer_store.py` |
| 상점 상품·판매 | Fly 볼륨 `/data/retail.json` | `RETAIL_DATA_FILE` | `services/retail_store.py` |
| 시뮬레이터 베이·예약 | Fly 볼륨 `/data/simulator.json` | `SIMULATOR_DATA_FILE` | `services/simulator_store.py` |

로컬 개발 기본값은 전부 `backend/data/*.json` 파일이다(git 에서 제외).

### 5.2 Supabase 프로젝트
- 프로젝트 ref `yxpiwwgquyaxjubovzmi` — **SMEAG 등 다른 앱과 공유하는 DB** 다.
- 그래서 이 프로젝트가 만드는 테이블·인덱스·함수는 **전부 `pelham_` 접두사**를 단다.
- DDL(마이그레이션)은 Supabase 대시보드의 **SQL Editor 에 직접 붙여 넣어** 실행한다(`supabase/sql_editor_0001_0002.sql`). Supabase CLI 로 관리하지 않는다.
- 백엔드는 Supabase 파이썬 SDK 없이 **httpx 로 PostgREST(REST API)를 직접** 호출한다.

### 5.3 테이블

**`pelham_tee_bookings`** (`0002_tee_bookings.sql`)
- 설계: **인덱스용 컬럼 + 예약 전체를 담은 `doc jsonb`**. 읽을 때는 `doc` 만 쓰고, `booking_date / tee_time / status / source / hold_expires_at …` 은 조회·대시보드용 사본이다. 둘이 어긋나면 `doc` 이 맞다.
- 인덱스: `booking_date`, `status`, `hold_expires_at`(부분 인덱스)
- 과거 예약 약 8,400건을 Chronogolf 에서 들여왔다. API 는 `Scope` 로 필요한 날짜/id 만 읽는다.

**`pelham_customers`** (`0001_customers.sql`, `0002_pelham_prefix.sql`)
- 원본: Lightspeed/Chronogolf `Customers > Export` CSV (약 500행), 자연키 `customer_ref`
- 이름·이메일·전화·주소·생년월일, 회원 여부, 정규화 값과 원본 값을 함께 저장
- `needs_review`, `possible_duplicate_of` — 중복 의심은 표시만 하고 합치지 않는다
- `pelham_touch_updated_at()` 트리거 — 내용이 실제로 바뀐 행만 `updated_at` 갱신

### 5.4 보안 (RLS)
두 테이블 모두 **RLS 를 켜고 정책을 하나도 두지 않는다.** anon/authenticated 키로는 아무 행도 보이지 않고, 백엔드의 `SUPABASE_SERVICE_ROLE_KEY` 만 RLS 를 우회해 접근한다. 둘 다 실제 고객 개인정보(PII)이므로 레코드 내용을 로그·이슈·커밋에 붙이지 않는다.

### 5.5 데이터 이관·운영 스크립트 (`scripts/`)
| 스크립트 | 역할 |
|---|---|
| `import_chronogolf_snapshot.py` | Chronogolf 화면(DOM) 스냅샷에서 예약 가져오기 |
| `import_teesheet_csv.py` | Chronogolf 티 시트 CSV 수출본 가져오기 |
| `import_teesheet_customers.py` | 티 시트 기록에서 고객 추출 |
| `import_customers_export.py` | Lightspeed 고객 CSV → `pelham_customers` |
| `migrate_tee_sheet_to_supabase.py` | JSON 티 시트 → `pelham_tee_bookings` |
| `build_public_snapshot.py` | 개인정보 제거한 `frontend/public/data/teesheet-public.json` 생성 |
| `set_fly_supabase_secrets.py` | Supabase URL·키를 `fly secrets` 로 등록 |
| `elevenlabs_sync_agent.py` | `ops/elevenlabs/agent.json` 을 ElevenLabs 계정에 반영 |
| `check-detail-layout.mjs` | 예약 상세 패널이 한 화면에 들어가는지 확인 |
| `generate-tiles.ts`, `upload-to-r2.ts`, `upload_to_r2.py`, `seed-courses.ts` | GPS 코스 타일용 (GPS 앱 분리 후 사실상 미사용) |

---

## 6. 코드 저장과 배포

### 6.1 코드 저장 (Git / GitHub)
- 원격: `https://github.com/jitnet-gif/golf-gps-pelhamhills`
- 브랜치: `main` 하나 (현재 35 커밋)
- 커밋 메시지는 영어 명령형 제목 + "왜"를 설명하는 본문
- git 에서 제외되는 것(`.gitignore`): `.env*`(`.env.example` 제외), `backend/data/`, `node_modules/`, `.next/`, `frontend/out/`, `frontend/.vercel/`, `/tiles/`, `shots/`, `.tmp-*.mjs`

### 6.2 프론트엔드 배포 — Vercel
| 항목 | 값 |
|---|---|
| Vercel 프로젝트 | `frontend` (→ `pelhamhills.vercel.app`) |
| 빌드 | `next build` → 출력 `out/` (`frontend/vercel.json`) |
| Node | 24.x |
| 옵션 | `cleanUrls: true`, `trailingSlash: false` |
| 환경변수 | `NEXT_PUBLIC_API_URL` 등은 **Vercel 대시보드**(`vercel env add`)에만 둔다 |

배포 흐름: `frontend/` 에서 `vercel --prod` 또는 Git 연동. `.vercelignore` 가 `.env.local`·`out`·`.next` 업로드를 막으므로 Vercel 빌더가 대시보드 환경변수로 새로 빌드한다.

### 6.3 백엔드 배포 — Fly.io
| 항목 | 값 |
|---|---|
| 앱 이름 | `pelhamhills-api` (기본 주소 `https://pelhamhills-api.fly.dev`) |
| 리전 | `yyz` (토론토) |
| 이미지 | `backend/Dockerfile` — `python:3.12-slim`, 빌드 컨텍스트는 **저장소 루트** |
| 실행 | `uvicorn backend.main:app --host 0.0.0.0 --port 8080` |
| VM | `shared-cpu-1x`, 메모리 512MB, **머신 1대 고정** |
| 콜드 스타트 | 없음 (`auto_stop_machines = false`, `min_machines_running = 1`) |
| 볼륨 | `pelhamhills_data` → `/data` |
| HTTPS | `force_https = true` |
| 헬스 체크 | 30초마다 `GET /` |

배포 명령 (저장소 루트에서):
```bash
flyctl deploy --remote-only
```

- **이미지에 들어가는 것**: 루트 `.dockerignore` 가 "전부 제외, `backend/` 만 포함"으로 되어 있다. `backend/data/`(고객 CSV·백업), `backend/tests/`, 모든 `.env` 는 제외된다.
- **컨테이너 시작 시**: `docker-entrypoint.sh` 가 티 시트 JSON 파일이 없으면 **빈 목록**으로 만든다 — 운영이 가짜 시드 예약으로 시작하지 않도록.
- **비밀값** (`fly secrets set …`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGINS`, `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `VOICE_TOOL_SECRET`, `ELEVENLABS_WEBHOOK_SECRET`, `PUBLIC_API_BASE_URL`
- **평문 설정** (`fly.toml [env]`): `TEE_SHEET_BACKEND=supabase`, `TEE_SHEET_DATA_FILE`, `RETAIL_DATA_FILE`, `SIMULATOR_DATA_FILE`

### 6.4 CI
`.github/workflows/deploy.yml` 이 있지만 초기(2026-09-06)에 만든 템플릿이다. 없어진 `golf-gps-app` 경로와 개발용 `requirements.txt` 를 참조하고 테스트 실패를 `|| true` 로 무시한다. **실제 배포는 위의 수동 명령으로 한다**고 보는 것이 맞다.

---

## 7. 분리된 GPS 앱 (`E:\golf-gps-app`)

코스 위에서 쓰는 모바일 PWA. 이 저장소와 **같은 FastAPI 티 시트**를 `/book` 화면에서 호출한다(그래서 CORS 목록에 Vercel 주소가 들어 있다). 현재 로컬 폴더는 git 저장소가 아니다.

| 구분 | 기술 |
|---|---|
| 프론트 | React 18, Vite 5, `vite-plugin-pwa`, Leaflet(지도), Dexie(IndexedDB 오프라인), Zustand, wouter, Tailwind 3 |
| 백엔드 | Cloudflare Workers (Hono, `golf-gps-backend`) — 웹 푸시, 프로모션 배너, 캠페인 예약 발송(cron), 관리자 API(`X-Admin-Key`) |
| DB | Supabase (`backend/migrations/0001~0010`: 코스·홀·티 위치·스코어카드·푸시·프로모션 등) |
| 지도 타일 | Esri World Imagery / Cloudflare R2 |
| 배포 | Vercel (`golf-gps-pelhamhills.vercel.app`), Worker 는 `wrangler deploy` |
| 음성 | ElevenLabs 로 만든 홀 안내 mp3 126개 |

---

## 8. 로컬 개발

```bash
# 0) 환경변수
cp .env.example .env              # 루트 — 백엔드와 음성 스크립트가 읽는다
cp frontend/.env.example frontend/.env.local

# 1) 백엔드 (저장소 루트에서)
pip install -r backend/requirements-api.txt pytest
python -m uvicorn backend.main:app --reload --port 8000
#   → http://localhost:8000/docs

# 2) 프론트엔드
cd frontend && npm install && npm run dev
#   → http://localhost:3000

# 3) 테스트
python -m pytest backend/tests -q
cd frontend && npx tsc --noEmit && npm run lint
```

- `TEE_SHEET_BACKEND` 를 지정하지 않으면 로컬 JSON(`backend/data/tee_sheet.json`)을 쓴다. 파일이 없으면 시드 예약으로 만들어진다.
- 음성 예약을 로컬에서 시험하려면 ElevenLabs 가 닿을 수 있게 ngrok 주소를 `PUBLIC_API_BASE_URL` 에 넣는다.
- 루트 `package.json` 의 `npm run dev` 등은 없어진 `golf-gps-app/backend` 워크스페이스를 참조하므로 위처럼 각각 실행하는 편이 확실하다.

---

## 9. 레거시·미사용 파일 (혼동 주의)

| 파일 | 상태 |
|---|---|
| `wrangler.toml` (루트) | Cloudflare Workers 템플릿. `example.com`·빈 ID — 사용 안 함 |
| `frontend/wrangler.toml`, `frontend/pages.config.json`, `npm run deploy` | Cloudflare Pages(`bepu`) 배포 흔적. 실제 배포는 Vercel |
| `backend/database.py`, `models.py`, `routes.py`, `orchestration.py` | SQLAlchemy/asyncpg 기반 초기 설계. `main.py` 에 연결되지 않음 |
| `backend/api/routes/chat.py`, `agents.py`, `onboarding.py`, `tts.py` | BEPU AI 어시스턴트 흔적. 기동 시 임포트 실패(무해) |
| `frontend/lib/claude.ts`, `gemini*.ts`, `bepu-prompt.ts`, `supabase.ts`, `components/chat/` | 위와 같은 흔적 |
| `INFRASTRUCTURE.md`, `DEVOPS_SETUP_SUMMARY.md` | Redis·Workers·PostgreSQL 을 전제한 **계획** 문서. 현재 구조와 다름 |
| `SIMULATOR_SETUP.md` | 시뮬레이터가 PostgreSQL 을 쓴다고 적혀 있으나, `e5399ef` 이후 JSON 저장소 |
| `monitoring/prometheus.yml`, `shared/` | 연결된 곳 없음 |
| `.github/workflows/deploy.yml` | 6.4 참고 |

---

## 10. 결정된 방향 (2026-09-10)

- **티 시트의 원본은 이 시스템이다.** Chronogolf 는 데이터 이관 원본으로만 쓰고, GolfNow 와는 직접 연동이 필요하다.
- **결제는 Chase** 로 간다. Lightspeed Payments 를 대체해 그린피·상점·스낵바·온라인 결제를 처리할 예정이며, 아직 구현되지 않았다. 현재 티 시트·상점의 "결제"는 영수증 인쇄와 `paidAt` 기록까지다.

## 11. 관련 문서
- `docs/VOICE_BOOKING.md` — 음성 예약 구조·도구·설정
- `docs/pro-shop-receipt-printing-2026-09-12.md` — 영수증 인쇄·결제 흐름
- `docs/pelham-hills-homepage-refactor-2026-09-04.md` — 홈페이지 개편
- `docs/tee-sheet-operations-infographic/` — 티 시트 운영 인포그래픽
