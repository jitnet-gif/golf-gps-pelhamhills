# 위성 타일 프리페치 & R2 호스팅

코스 위성사진 타일을 미리 받아 Cloudflare R2에 올려, 라운드마다 Esri에
직접 붙지 않도록 하는 파이프라인입니다.

| 스크립트 | 하는 일 |
| --- | --- |
| `download_tiles.py` | Esri World Imagery 타일을 `./tiles/{z}/{x}/{y}.jpg` 로 저장 |
| `verify_coverage.py` | 한 줌 레벨을 모자이크로 합치고 36개 티/핀을 찍어 커버리지 눈으로 확인 |
| `upload_to_r2.py` | `./tiles` 를 R2 버킷에 업로드 |

## 타일 집합은 앱과 반드시 같아야 합니다

플레이어가 페어웨이에서 보는 타일과 여기서 받는 타일이 어긋나면 회색 배경이
나옵니다. 그래서 `download_tiles.py` 는 좌표 계산을 새로 짜지 않고 다음을
그대로 따라갑니다.

- `frontend/src/lib/tiles.ts` — URL 템플릿, z15–19, `boundsFor` 의 pad `0.0009`
- `frontend/src/hooks/useMapTiles.ts` — 양쪽 끝 모두 `floor()`
- `frontend/src/components/OfflineCourse.tsx` — 18홀 × (핀+티) = 36개 점

이 중 하나라도 바꾸면 `download_tiles.py` 의 상수도 같이 바꾸고 다시 받아야
합니다. 현재 결과는 **536장, 약 6.5 MB** 로 `vite.config.ts` 의 주석
(`~536 tiles at zoom 15-19`)과 일치합니다.

## 걸리는 것 두 가지

- **Esri는 `{z}/{y}/{x}` 순서로 서빙합니다.** 디스크에는 통상적인
  `{z}/{x}/{y}.jpg` 로 저장합니다. 이 순서를 뒤집으면 에러가 아니라 *엉뚱한
  동네의 멀쩡한 위성사진*이 나오므로, 반드시 `verify_coverage.py` 로 핀이
  그린 위에 찍히는지 확인하세요.
- **Esri는 커버리지 없는 타일에도 200을 줍니다.** 그래서 상태 코드만으로는
  부족하고, 받은 본문이 JPEG 매직 바이트로 시작하는지 검사한 뒤 저장합니다.

## 1. 다운로드

```bash
python3 download_tiles.py --dry-run   # bbox와 줌별 장수만 출력
python3 download_tiles.py             # ./tiles 로 저장
```

이미 있는 파일은 건너뛰므로, 일부 실패했으면 그냥 다시 돌리면 됩니다.

BBOX는 홀 좌표에서 자동으로 계산됩니다(권장). 일부러 더 넓게 받고 싶을 때만
`download_tiles.py` 의 `LAT_DELTA` / `LON_DELTA` 를 도(degree) 단위 반폭으로
설정하세요.

## 2. 커버리지 확인

```bash
python3 verify_coverage.py --zoom 17   # -> tiles_preview.jpg
```

빨강 = 핀(홀 번호), 청록 = 티, 노랑 박스 = BBOX. 36개 점이 전부 박스 안에
있고 주변 페어웨이까지 보이면 통과입니다. 가장자리 여유(m)도 같이 출력되며,
`<-- TIGHT` 가 뜨면 델타를 키우고 다시 받으세요.

## 3. R2 업로드

버킷 하나를 새로 만듭니다. `.env.example` 의 `CF_R2_BUCKET_NAME`
(`golf-gps-photos`)과 **분리**하세요 — 타일은 1년 immutable 캐시로 공개하지만
사용자 사진은 그러면 안 되고, 버킷 정책은 하나뿐입니다.

환경변수 4개 (`.env.local` 에 두어도 읽습니다):

| 변수 | 어디서 |
| --- | --- |
| `CF_R2_ACCOUNT_ID` | R2 개요 페이지의 계정 ID. 엔드포인트 `https://<account>.r2.cloudflarestorage.com` 를 만듭니다 |
| `CF_R2_ACCESS_KEY_ID` | R2 API 토큰 (Object Read & Write) |
| `CF_R2_SECRET_ACCESS_KEY` | 토큰 생성 시 한 번만 표시됨 |
| `CF_R2_TILES_BUCKET` | 버킷 이름, 예: `golf-gps-tiles` |

```bash
python3 upload_to_r2.py --dry-run
python3 upload_to_r2.py
```

버킷 단위 권한이 없는 토큰(단일 버킷 스코프)도 그대로 동작합니다 —
`head_bucket` / `list_objects_v2` 가 403이면 경고만 찍고 계속 올립니다.

## 4. 앱을 R2로 돌릴 때 — 서비스워커 규칙도 같이 고쳐야 합니다

`VITE_TILE_URL` 을 `<base>/{z}/{x}/{y}.jpg` 로 바꾸는 것만으로는 부족합니다.
`frontend/vite.config.ts` 의 타일 런타임 캐시 규칙이

```
/^https?:\/\/[^/]+\/.*\/MapServer\/tile\/\d+\/\d+\/\d+(?:\?.*)?$/
```

즉 Esri의 `/MapServer/tile/...` 경로에만 걸려 있어서, R2 URL에는 **매치되지
않습니다.** 그대로 두면 오프라인 캐싱이 조용히 멈춥니다(에러도 안 납니다).
`VITE_TILE_URL` 변경과 같은 커밋에서 `urlPattern` 도 새 URL 모양에 맞게
바꾸세요.

## 라이선스

Esri World Imagery를 자체 R2에 올려 서빙하는 것은 앱이 런타임에 하는
서비스워커 캐싱과 달리 **재배포**에 해당합니다. Esri 이용약관에서 이 사용이
허용되는지 확인이 필요합니다.
