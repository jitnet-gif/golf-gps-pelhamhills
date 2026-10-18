# 푸시 알림 & 마케팅 배너

모바일 웹앱(PWA)에 붙인 두 가지 기능입니다.

- **푸시 알림** — 앱을 닫아 둔 사용자에게 할인·이벤트 소식을 보냅니다.
- **마케팅 배너** — 홈 화면과 스코어카드 화면에 홍보 배너를 노출합니다.

두 기능은 데이터가 다른 길로 다닙니다. 배너는 코스 데이터와 마찬가지로
브라우저가 Supabase에 직접 붙어 읽고, 푸시 구독은 Worker를 거칩니다.
구독 정보는 기기를 지목할 수 있는 데이터라서 `anon` 권한을 주지 않았고,
`service_role`을 쥔 Worker만 만질 수 있습니다.

```
배너 읽기 : 브라우저 ──> Supabase PostgREST (promotions, RLS로 노출 기간 필터)
푸시 구독 : 브라우저 ──> Worker /api/push/* ──> Supabase (service_role)
푸시 발송 : 운영자   ──> Worker /api/push/send ──> FCM / Mozilla / Apple ──> 기기
```

---

## 1. 준비 (한 번만)

### 1-1. 마이그레이션 적용

`backend/migrations/0003_push_and_promotions.sql`을 Supabase에 적용합니다.
방법은 `0001_init.sql` 상단 주석과 같습니다(대시보드 SQL Editor 붙여넣기 또는
`supabase db push`).

`GRANT SELECT ON public.promotions TO anon`이 함께 들어 있습니다. RLS 정책만
있고 GRANT가 없으면 정책이 아무리 맞아도 브라우저는 빈 배열만 받습니다.

### 1-2. VAPID 키 생성

```bash
node scripts/generate-vapid-keys.mjs
```

출력된 세 줄을 Worker에 넣습니다.

```bash
cd backend
wrangler secret put VAPID_PUBLIC_KEY
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put VAPID_SUBJECT        # 예: mailto:ops@pelhamhills.co.kr
wrangler secret put ADMIN_API_KEY        # 발송용. 길고 무작위인 문자열로.
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

> **키를 바꾸지 마세요.** VAPID 키를 교체하면 기존 구독이 전부 무효가 됩니다.
> 사용자는 알림이 끊긴 줄도 모른 채 조용히 안 받게 됩니다.

로컬 개발은 `backend/.dev.vars`에 같은 값을 넣으면 됩니다(gitignore 처리됨).

### 1-3. 프론트엔드가 Worker를 볼 수 있게

배너는 Worker 없이도 동작하지만, **알림 켜기는 Worker가 있어야** 합니다.
배포 환경의 `VITE_API_URL`이 실제 Worker 주소를 가리켜야 합니다.

```
VITE_API_URL=https://golf-gps-backend-prod.<계정>.workers.dev
```

---

## 2. 배너 올리기

관리 화면은 아직 없습니다. Supabase SQL Editor에서 행을 넣습니다.

```sql
INSERT INTO public.promotions (title, body, image_url, link_url, placement, priority, ends_at)
VALUES (
  '주말 그린피 30% 할인',
  '이번 주 토·일 오후 티타임 한정',
  'https://.../banner.jpg',      -- 없어도 됩니다 (글자만 나갑니다)
  'https://.../event',           -- 없으면 클릭되지 않는 공지가 됩니다
  'home',                        -- 'home' 또는 'scorecard'
  10,                            -- 높을수록 먼저
  '2026-09-30 23:59+09'          -- 지나면 자동으로 사라집니다
);
```

- `placement`는 `home`(첫 화면)과 `scorecard`(라운드 중 스코어카드) 두 곳입니다.
  **지도 화면에는 배너를 넣지 않습니다.** 플레이 중 거리와 지도를 가리는 광고는
  이 앱을 쓰는 이유를 깎아먹습니다.
- 내리고 싶으면 `active = false`로 두거나 `ends_at`을 과거로 바꾸면 됩니다.
- 사용자가 배너를 닫으면 그 기기에서는 다시 뜨지 않습니다(기기에만 기록).

배너 이미지는 서비스워커의 `image-cache`가 잡아 두고, 배너 내용은 앱이
IndexedDB에 남깁니다. 통신이 없는 코스 위에서도 마지막 배너가 보입니다.

---

## 3. 알림 보내기

```bash
export API_URL=https://golf-gps-backend-prod.<계정>.workers.dev
export ADMIN_API_KEY=<위에서 넣은 값>

# 직접 쓰기
node scripts/send-push.mjs --title "주말 그린피 30% 할인" --body "토·일 오후 티타임" --url /

# 등록해 둔 배너를 그대로
node scripts/send-push.mjs --promotion <배너 UUID>

# 내 기기에만 (브라우저 콘솔: localStorage.getItem('golf_gps_device_id'))
node scripts/send-push.mjs --title "테스트" --device <기기 ID>
```

결과는 `대상 N건 / 전달 N건 / 실패 N건`으로 나옵니다. **전달**은 푸시 서비스가
받아 줬다는 뜻이지, 사용자가 봤다는 뜻은 아닙니다.

한 번에 최대 500건까지 보냅니다. Workers는 요청 하나가 만들 수 있는 외부 요청
수에 상한이 있어서(무료 50, 유료 1000), 그 이상은 나눠 보내야 합니다.
구독자가 수천 명 규모가 되면 Cron Trigger로 큐를 돌리는 구조로 바꿔야 합니다 —
그때는 `backend/src/index.ts`의 `export default app`을
`export default { fetch: app.fetch, scheduled }` 형태로 바꿔야 `scheduled`가
동작합니다.

---

## 4. 알아 둘 것

### iOS

아이폰은 **iOS 16.4 이상 + 홈 화면에 설치된 상태**에서만 웹 푸시가 됩니다.
사파리 탭에서 연 사용자에게는 알림 켜기 버튼 대신 '홈 화면에 추가하세요'
안내가 나갑니다.

이 때문에 발송 규격도 최신 것이어야 합니다. 서버는 RFC 8291(aes128gcm) +
RFC 8292(`vapid t=..., k=...`)로 보냅니다. 구형 `aesgcm` 방식은 크롬에서는
아직 되지만 애플이 거부합니다. Node용 `web-push` 패키지는 Workers에서 돌지
않아 `@block65/webcrypto-web-push`(WebCrypto만 사용)를 씁니다.

### 권한은 한 번뿐

브라우저 알림 권한은 사용자가 거부하면 사이트 설정에 들어가지 않는 한
되돌릴 수 없습니다. 그래서 앱을 열자마자 묻지 않고, 홈 화면의 '이벤트 알림
받기' 카드를 직접 눌렀을 때만 요청합니다. 자동으로 띄우도록 바꾸지 마세요.

### 서비스워커

푸시 핸들러는 `frontend/public/push-sw.js`에 있고, Workbox가 생성한 `sw.js`가
`importScripts`로 끌어옵니다. `vite.config.ts`의 `strategies`를
`injectManifest`로 바꾸면 `workbox.runtimeCaching` 설정이 통째로 무시됩니다 —
거기에 코스에서 지도를 살려 두는 타일 캐시 규칙이 들어 있으므로,
알림을 얻자고 오프라인 지도를 잃는 셈이 됩니다.

빌드 후 확인:

```bash
cd frontend && npm run build
grep -o 'importScripts("[^"]*")' dist/sw.js     # importScripts("/push-sw.js")
```

### 죽은 구독

브라우저가 구독을 갱신하거나 사용자가 앱을 지우면 옛 endpoint는 죽습니다.
발송 중 404/410을 받은 구독은 `revoked_at`이 찍혀 다음부터 제외됩니다.
앱은 실행될 때마다 현재 구독을 서버에 다시 등록해 기록을 맞춥니다.

---

## 5. 아직 없는 것

- **배너 관리 화면.** 지금은 SQL로 넣습니다.
- **노출/클릭 집계.** 어떤 배너가 먹혔는지 알 수 없습니다.
- **예약 발송.** 보내는 시점은 사람이 정합니다.
- **토픽 고르기.** 구독은 전부 `marketing` 하나로 들어갑니다.
