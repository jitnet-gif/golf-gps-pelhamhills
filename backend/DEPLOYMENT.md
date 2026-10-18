# Cloudflare Workers 골프 GPS 백엔드 - 배포 가이드

## 구현 완료

Hono + TypeScript + Supabase PostgreSQL을 사용한 완전한 백엔드 API가 구현되었습니다.

### 완성된 구성요소

#### API 엔드포인트 (11개)
- ✅ `POST /api/courses` - 코스 목록 조회 (공개)
- ✅ `GET /api/courses/:id` - 코스 상세 (공개)
- ✅ `POST /api/rounds` - 라운드 시작 (인증)
- ✅ `GET /api/rounds/:id` - 라운드 조회 (인증)
- ✅ `GET /api/rounds/user/me` - 사용자 라운드 (인증)
- ✅ `POST /api/rounds/:id/complete` - 라운드 완료 (인증)
- ✅ `POST /api/rounds/:id/cancel` - 라운드 취소 (인증)
- ✅ `POST /api/scores` - 배치 점수 제출 (인증, 멱등성)
- ✅ `GET /api/leaderboard/:roundId` - 리더보드 (공개)
- ✅ `GET /api/health` - 헬스체크 (공개)

#### 데이터베이스 (5개 테이블)
- ✅ `courses` - 골프 코스
- ✅ `holes` - 각 홀의 정보
- ✅ `rounds` - 라운드 기록
- ✅ `scores` - 점수 기록 (멱등성 보장)
- ✅ `tile_metadata` - 지도 타일 메타데이터

#### 보안
- ✅ JWT 기반 인증
- ✅ Row-Level Security (RLS) 정책
- ✅ 사용자 권한 검증
- ✅ 점수 배치 제출 멱등성 (오프라인 모드 지원)

#### 타입 안전성
- ✅ TypeScript 완전 타입화
- ✅ Zod 스키마 검증
- ✅ 런타임 타입 안전성

## 배포 단계

### 1단계: Supabase 프로젝트 설정

```bash
# Supabase Dashboard에서 새 프로젝트 생성
# https://supabase.com/dashboard

# 프로젝트 URL과 API 키 복사
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### 2단계: 데이터베이스 초기화

**방법 A: Supabase Dashboard (권장)**
1. SQL Editor 열기
2. `migrations/0001_init.sql` 전체 복사
3. 실행 버튼 클릭
4. 결과 확인

**방법 B: Supabase CLI**
```bash
supabase login
supabase db push
```

### 3단계: Cloudflare 계정 설정

```bash
# Wrangler 로그인
wrangler login

# 프로젝트 확인
wrangler whoami
```

### 4단계: 환경변수 설정

```bash
# 스테이징 환경
wrangler secret put SUPABASE_URL --env staging
wrangler secret put SUPABASE_ANON_KEY --env staging
wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging

# 프로덕션 환경
wrangler secret put SUPABASE_URL --env production
wrangler secret put SUPABASE_ANON_KEY --env production
wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production
```

### 5단계: 배포

```bash
# 스테이징
npm run deploy:staging

# 프로덕션
npm run deploy:prod
```

### 6단계: 검증

```bash
# 배포된 엔드포인트 테스트
curl https://golf-gps-backend-prod.workers.dev/api/health

# 응답:
# {
#   "status": "ok",
#   "timestamp": "2026-09-06T23:50:00.000Z",
#   "version": "v1",
#   "environment": "production"
# }
```

## 환경 변수 참고

### Supabase 환경변수

**SUPABASE_URL**
- Supabase Dashboard → Project Settings → API
- 형식: `https://xxxxx.supabase.co`

**SUPABASE_ANON_KEY**
- Supabase Dashboard → Project Settings → API
- Anon (공개) 역할용 키

**SUPABASE_SERVICE_ROLE_KEY**
- Supabase Dashboard → Project Settings → API
- Service Role 키 (선택사항, 크로스-유저 집계용)

### API 환경변수

**API_VERSION**
- 기본값: v1
- API 버전 관리

**LOG_LEVEL**
- 개발: debug
- 스테이징: debug
- 프로덕션: warn

**ENVIRONMENT**
- 개발: development
- 스테이징: staging
- 프로덕션: production

## 주요 기술 결정

### 인증 전략
- **JWT 토큰**: Supabase에서 발급
- **Bearer 토큰**: Authorization 헤더로 전달
- **RLS**: Supabase PostgreSQL 정책으로 최종 보안

### 배치 점수 제출 멱등성
```typescript
// (round_id, hole_id, player_id) 조합의 UNIQUE 제약
// 재시도 안전: UPSERT 사용

// 첫 제출: INSERT
// 재시도: UPDATE (CONFLICT 처리)
// 결과: 동일한 입력에 항상 같은 결과
```

### 라운드 참여자의 그룹 점수 입력
```sql
-- 한 사람이 전체 그룹의 점수를 입력할 수 있음
-- 예: 라운드에서 점수 입력을 담당하는 사람이 모두 기록

CREATE POLICY "scores_write_by_round_participant" ON scores
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM rounds
      WHERE id = scores.round_id
        AND auth.uid() = ANY(player_ids)
    )
  );
```

## 로컬 개발

### 설치 및 실행

```bash
cd golf-gps-app/backend

# 환경변수 설정
cp .env.example .env.local
# .env.local 편집

# 의존성 설치
npm install

# 로컬 개발 시작
npm run dev

# 타입 검사
npm run check
```

### 로컬 엔드포인트

```
http://localhost:8787/api/...
```

## 트러블슈팅

### "Cannot find module '@golf-gps/shared'"

```bash
# 공유 패키지가 설치되었는지 확인
ls -la shared/src/types.ts

# 루트 패키지 재설치
npm install
```

### Supabase 연결 오류

```bash
# 환경변수 확인
echo $SUPABASE_URL
echo $SUPABASE_ANON_KEY

# Supabase 프로젝트 상태 확인
# Dashboard → Settings → Project Status
```

### 타입 검사 실패

```bash
# TypeScript 다시 컴파일
npm run check

# 의존성 재설치
rm -rf node_modules package-lock.json
npm install
```

### RLS 정책 위반

```bash
# Supabase Dashboard → SQL Editor에서 정책 확인
-- 예: 코스는 누구나 읽기 가능
SELECT * FROM courses;  -- 성공

-- 라운드는 참여자만
SELECT * FROM rounds;   -- RLS 필터링됨
```

## 모니터링

### 로그 확인

```bash
# Cloudflare Dashboard → Workers → Logs
# 또는

wrangler tail --env production
```

### 성능 모니터링

```bash
# Workers Analytics Engine에서 조회
# 응답 시간, 에러율, 요청 수
```

## 스케일링 고려사항

### 데이터베이스
- **Supabase**: 자동 스케일링
- **RLS 정책**: 쿼리 성능 영향 최소화
- **인덱스**: 자동 생성됨

### Workers
- **요청 수**: 무제한
- **메모리**: 128MB (충분)
- **실행 시간**: 30초 제한
- **콜드 스타트**: ~50ms

### 캐싱 (선택사항)
```javascript
// wrangler.toml에서 활성화
[[kv_namespaces]]
binding = "CACHE"
```

## 다음 단계

### 필수
- [ ] 프론트엔드와 API 통합 테스트
- [ ] 사용자 인증 플로우 테스트
- [ ] 오프라인 모드 + 점수 동기화 테스트

### 권장
- [ ] R2 타일 저장소 설정
- [ ] Sentry 에러 추적 통합
- [ ] GraphQL API 추가 (실시간 업데이트)

### 고급
- [ ] WebSocket 실시간 점수 업데이트
- [ ] 모바일 푸시 알림
- [ ] 플레이어 통계 분석
- [ ] 소셜 기능 (친구 초대, 시합)

## 문서

- `README.md` - 개발 및 사용 설명서
- `migrations/0001_init.sql` - 데이터베이스 스키마
- `wrangler.toml` - Cloudflare Workers 설정
- `.env.example` - 환경변수 템플릿

## 지원 및 피드백

문제 발생 시:
1. 로그 확인 (`wrangler tail`)
2. 환경변수 검증
3. Supabase 상태 확인
4. 데이터베이스 정책 검토

---

**배포 준비 완료!** 🚀

위 단계를 따르면 프로덕션 환경에서 안전하고 확장 가능한 골프 GPS 백엔드를 운영할 수 있습니다.
