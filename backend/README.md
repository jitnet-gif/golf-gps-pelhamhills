# Golf GPS Backend

Cloudflare Workers + Hono + TypeScript를 사용한 골프 GPS 애플리케이션 백엔드 API

## 기능

### 1. 코스 관리 API
- `POST /api/courses` - 코스 목록 조회 (페이지네이션, 검색)
- `GET /api/courses/:id` - 코스 상세 정보 + 홀 정보

### 2. 라운드 관리 API
- `POST /api/rounds` - 라운드 시작
- `GET /api/rounds/:id` - 라운드 상세 정보
- `GET /api/rounds/user/me` - 사용자의 라운드 목록
- `POST /api/rounds/:id/complete` - 라운드 완료
- `POST /api/rounds/:id/cancel` - 라운드 취소

### 3. 점수 제출 API
- `POST /api/scores` - 배치 점수 제출 (오프라인 모드 지원, 멱등성)

### 4. 리더보드 API
- `GET /api/leaderboard/:roundId` - 라운드 리더보드

### 5. 유틸리티
- `GET /api/health` - 헬스 체크

## 기술 스택

- **런타임**: Cloudflare Workers
- **프레임워크**: [Hono](https://hono.dev/) - 가볍고 빠른 웹 프레임워크
- **언어**: TypeScript
- **데이터베이스**: Supabase PostgreSQL
- **검증**: Zod - TypeScript-first 스키마 검증

## 개발 환경 설정

### 1. 의존성 설치

```bash
cd golf-gps-app/backend
npm install
```

### 2. Supabase 프로젝트 설정

#### 2.1 Supabase 프로젝트 생성
- [Supabase Dashboard](https://supabase.com/dashboard)에서 새 프로젝트 생성
- 프로젝트 URL과 API 키 복사

#### 2.2 데이터베이스 초기화

**방법 1: Supabase Dashboard (권장)**
1. Supabase Dashboard → SQL Editor
2. `migrations/0001_init.sql`의 내용 복사-붙여넣기
3. 실행 버튼 클릭

**방법 2: Supabase CLI**
```bash
# Supabase 로그인 (처음 한 번)
supabase login

# 로컬 개발 환경 시작 (선택사항)
supabase start

# 마이그레이션 실행
supabase migration new init_schema
# migrations/<timestamp>_init_schema.sql에 SQL 복사
supabase db push
```

### 3. 환경변수 설정

`.env.local` 파일 생성:

```bash
cp .env.example .env.local
```

`.env.local` 파일 편집:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

### 4. 로컬 개발 시작

```bash
npm run dev
```

서버가 `http://localhost:8787`에서 시작됩니다.

## 배포

### 1. Cloudflare Workers 계정 설정

```bash
# Wrangler 로그인
wrangler login
```

### 2. 환경변수 설정

```bash
# 프로덕션 환경
wrangler secret put SUPABASE_URL --env production
wrangler secret put SUPABASE_ANON_KEY --env production
wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production

# 스테이징 환경
wrangler secret put SUPABASE_URL --env staging
wrangler secret put SUPABASE_ANON_KEY --env staging
wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
```

### 3. 배포

```bash
# 스테이징
npm run deploy:staging

# 프로덕션
npm run deploy:prod
```

## API 사용 예제

### 1. 코스 목록 조회 (인증 불필요)

```bash
curl -X POST http://localhost:8787/api/courses \
  -H "Content-Type: application/json" \
  -d '{
    "limit": 20,
    "offset": 0,
    "search": "Pelham"
  }'
```

### 1-2. 코스 상세 조회 (인증 불필요)

```bash
curl http://localhost:8787/api/courses/uuid
```

### 2. 라운드 시작

```bash
curl -X POST http://localhost:8787/api/rounds \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "course_id": "uuid",
    "player_ids": ["user-id-1", "user-id-2", "user-id-3"]
  }'
```

### 3. 점수 제출

```bash
curl -X POST http://localhost:8787/api/scores \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "round_id": "uuid",
    "scores": [
      {
        "hole_id": "uuid",
        "player_id": "user-id",
        "strokes": 4
      }
    ]
  }'
```

### 4. 리더보드 조회 (인증 불필요)

```bash
curl http://localhost:8787/api/leaderboard/round-uuid
```

### 5. 헬스 체크 (인증 불필요)

```bash
curl http://localhost:8787/api/health
```

## 보안 고려사항

### 1. 인증 (JWT)
- Supabase에서 발급한 JWT 토큰 사용
- `Authorization: Bearer <token>` 헤더로 전달
- 토큰은 사용자 ID(sub)를 포함

### 2. Row-Level Security (RLS)
- Supabase PostgreSQL의 RLS 정책 활용
- 코스: 누구나 읽기 가능
- 라운드: 참여자만 읽기/수정 가능
- 점수: 자신의 점수만 수정 가능

### 3. 권한 관리

**anon 역할 (인증 없는 사용자)**
- 코스 조회 (읽기만)
- 리더보드 조회

**authenticated 역할 (로그인 사용자)**
- 라운드 생성/조회/수정
- 점수 제출
- 자신의 라운드/점수만 접근

### 4. 배치 점수 제출 - 멱등성
- `(round_id, hole_id, player_id)` 조합의 UNIQUE 제약
- 재시도: INSERT ON CONFLICT DO UPDATE (UPSERT)
- 오프라인 모드에서 안전한 동기화 지원

## 디렉토리 구조

```
backend/
├── src/
│   ├── index.ts              # 메인 진입점
│   ├── types/
│   │   └── env.ts            # 환경 바인딩 타입
│   ├── lib/
│   │   └── supabase.ts       # Supabase 클라이언트
│   ├── middleware/
│   │   ├── auth.ts           # JWT 인증
│   │   ├── cors.ts           # CORS
│   │   └── errorHandler.ts   # 에러 처리
│   ├── routes/
│   │   ├── courses.ts        # 코스 API
│   │   ├── rounds.ts         # 라운드 API
│   │   ├── scores.ts         # 점수 API
│   │   └── leaderboard.ts    # 리더보드 API
│   ├── services/
│   │   ├── courseService.ts      # 코스 로직
│   │   ├── roundService.ts       # 라운드 로직
│   │   ├── scoreService.ts       # 점수/집계 로직
│   │   └── tileService.ts        # 타일 관리
│   └── schemas/
│       ├── courses.ts
│       ├── rounds.ts
│       ├── scores.ts
│       └── leaderboard.ts
├── migrations/
│   └── 0001_init.sql         # 데이터베이스 초기 스키마
├── wrangler.toml             # Cloudflare Workers 설정
├── tsconfig.json             # TypeScript 설정
└── package.json
```

## 데이터베이스 스키마

### 테이블 구조

#### courses (코스)
- `id` (UUID, PK)
- `name` (VARCHAR)
- `location` (VARCHAR)
- `par` (INTEGER)
- `holes` (INTEGER, 9 또는 18)
- `created_at`, `updated_at` (TIMESTAMP)

#### holes (홀)
- `id` (UUID, PK)
- `course_id` (UUID, FK)
- `hole_number` (INTEGER, 1-18)
- `par` (INTEGER, 3-5)
- `handicap` (INTEGER, 1-18)
- `length` (INTEGER, 미터)
- `pin_gps_lat`, `pin_gps_lng` (NUMERIC)
- `created_at` (TIMESTAMP)

#### rounds (라운드)
- `id` (UUID, PK)
- `course_id` (UUID, FK)
- `player_ids` (UUID[], 참여자 목록)
- `start_time`, `end_time` (TIMESTAMP)
- `status` (VARCHAR, in_progress/completed/cancelled)
- `created_at`, `updated_at` (TIMESTAMP)

#### scores (점수)
- `id` (UUID, PK)
- `round_id` (UUID, FK)
- `hole_id` (UUID, FK)
- `player_id` (UUID)
- `strokes` (INTEGER, 1-13)
- `is_synced` (BOOLEAN)
- `created_at`, `updated_at` (TIMESTAMP)
- **UNIQUE(round_id, hole_id, player_id)** - 멱등성 보장

## 문제 해결

### "Cannot find module '@golf-gps/shared'"

```bash
# tsconfig.json 경로 별칭이 올바른지 확인
# shared/src가 존재하는지 확인
ls -la /path/to/shared/src
```

### Supabase 연결 오류

```bash
# .env.local 파일 확인
cat .env.local

# Supabase 프로젝트 상태 확인 (Dashboard)
# API 키가 올바른지 확인
```

### 타입 검사 실패 (npm run check)

```bash
# TypeScript 다시 컴파일
npm run check

# 의존성 재설치
rm -rf node_modules package-lock.json
npm install
```

## 환경 변수 참고

### 로컬 개발 (.env.local)
```env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Cloudflare Workers 배포
```bash
# 명령어로 설정 (권장)
wrangler secret put VARIABLE_NAME --env production
wrangler secret put VARIABLE_NAME --env staging

# 또는 wrangler.toml에서 [vars] 섹션 사용 (비밀정보 X)
```

## 라이선스

MIT
