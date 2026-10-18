# 다음 홀 길안내

퍼팅을 끝낸 그린에서 다음 홀 티박스까지 걸어가는 동안, 방향과 남은 거리를
알려 주는 기능입니다. 화면에 카드가 뜨고, 출발할 때와 100야드·50야드 지점에서
음성으로도 한 번씩 불러 줍니다.

기존 GPS 기능이 채우지 못하던 자리입니다. `holeArrival.ts`는 **도착했다**를
판정하고 `useHoleDistances`는 **그린까지**를 재지만, 그 사이의 걷는 구간을
가리켜 주는 것은 없었습니다. Pelham Hills 기준으로 12번 그린에서 13번 티까지는
페어웨이 두 개를 가로지르는 480 m입니다.

## 턴바이턴이 아닙니다

**경로 안내(routing)가 아니라 방위 안내(bearing)입니다.** 이유는 두 가지입니다.

1. 코스 좌표의 출처인 OpenStreetMap 추출본에 카트 도로 그래프가 없습니다. 없는
   길을 그려 줄 수는 없습니다.
2. 이 앱은 비행기 모드에서 동작하는 것을 전제로 만들어졌습니다
   (`useOfflineMode`, `useMapTiles`). 안내가 필요한 순간에 Google/Mapbox
   Directions를 부를 수 없습니다.

그래서 캐디가 해 주는 말 — "북동쪽으로 120야드" — 을 그대로 합니다. 카드에도
경로가 아니라 방향이라고 적혀 있습니다.

## 무엇이 어디에 있나

| 파일 | 역할 |
| --- | --- |
| `frontend/src/lib/teeGuidance.ts` | 판단이 전부 들어 있는 순수 모듈. 기기 없이 재생 가능 |
| `frontend/src/hooks/useTeeGuidance.ts` | 스토어의 GPS 픽스를 먹이고, 음성을 붙이는 배선 |
| `frontend/src/components/TeeGuidance.tsx` | 지도 아래 카드 + 사이드 메뉴 스위치 |
| `frontend/src/lib/geo.ts` | `haversine`, `bearingDegrees`, `compassPoint` — 계산은 여기 한 곳 |
| `frontend/src/pages/Golf.tsx` | 언제 안내를 시작하고 끝낼지 결정하는 자리 |

## 정직함을 지키는 세 가지 규칙

`holeArrival.ts`의 세 규칙과 같은 성격입니다.

**1. 핀이 아니라 티를 겨냥합니다.** 티 좌표는 홀 센터라인에서 온 것이라 의미가
분명합니다. 이 코스의 핀은 대부분 실측되지 않았고, 그래서 `useHoleDistances`도
핀까지의 거리를 거절합니다.

**2. 어느 쪽을 보고 있는지 모르면 "왼쪽"이라고 말하지 않습니다.** 휴대폰을 손에
들고 걸을 때 기기는 방위(heading)를 주지 않고, 칼만 필터를 통과한 위치에서
역산한 진행 방향은 방향 전환마다 뒤늦게 따라옵니다. 그래서 상대 방향(좌/우)은
**두 픽스가 자백한 오차의 1.5배 이상을 실제로 이동한 뒤에만** 나옵니다. 그
전까지는 나침반 방위만 보여 줍니다 — 이건 어느 쪽을 보고 있든 참이니까요.

```
연속 픽스는 걷는 속도로 약 1.4 m 간격.
오차 8 m짜리 픽스 두 개는 방향을 합의할 수 없음.
→ 앵커 하나를 붙들고 (8+8)×1.5 ≈ 24 m, 약 20초를 걸어야 방향이 생김.
→ 앵커가 90초를 넘기면 그건 걸음이 아니라 퍼팅하느라 서 있던 자리. 버림.
```

**3. 안내는 도착이 시작되는 곳에서 끝납니다.** `GUIDANCE_DEFAULTS.arrivedMetres`
는 `ARRIVAL_DEFAULTS.radiusMetres`와 **똑같이 30 m**입니다. 우연이 아니라
인계(handover)입니다. 티에 서 있는 사람에게 "8야드 남았습니다"를 계속 세는 것은
소음입니다.

## 언제 켜지고 언제 꺼지나

| 시점 | 동작 |
| --- | --- |
| 현재 홀에 스코어가 입력됨 | 안내 시작 (홀아웃했다는 정직한 신호) |
| 지도 아래 "walk me to the next tee" 탭 | 안내 시작 (스코어를 안 적는 사람용) |
| 다음 티 30 m 안으로 들어옴 | `useHoleArrival`이 인계받고 카드는 "you are here" |
| 스위치를 끔 | 즉시 종료, 설정은 `localStorage`에 저장 |

기본값은 **꺼짐**입니다. 나레이션 스위치와 같은 논리입니다 — 이 앱은 아무도
요청하지 않은 소리를 낸 적이 없고, 첫 번째 안내는 요청받아서 나가야 합니다.

## 도착은 왜 소리 내지 않나

`speechSynthesis`는 페이지 전체가 공유하는 하나의 엔진이고, `speak()`는 먼저
`cancel()`을 부릅니다. 티 도착 순간에는 나레이션이 켜져 있다면 홀 해설이 같은
1초 안에 시작됩니다. 여기서 "4번 홀 티"를 읽으면 그 해설을 잘라 버립니다.

그래서 **도착 문장은 카드에만 뜨고 음성으로는 나가지 않습니다.**
`lib/teeGuidance.ts`의 `guidanceCue()`는 도착 문장을 만들어 주지만,
`useTeeGuidance`가 `status === 'ok'`일 때만 읽습니다.

주의: 이 보호는 **도착 순간에만** 걸려 있습니다. 100·50야드 안내는 그대로
나가므로, 걷는 도중에 사이드 메뉴에서 홀 해설을 브라우저 TTS로 재생 중이라면
잘릴 수 있습니다. 도착만큼 자주 겹치지 않아 지금은 감수하고 있습니다 — 여기를
고치려면 `useTTS`가 아니라 발화 큐를 공유하는 층이 하나 필요합니다.

## 경계선에서 두 번 말하지 않기

도착 판정은 30 m 안에 들어오는 즉시 나지만, `useHoleArrival`은 20 m 안에서
20초를 머물러야 홀을 넘깁니다. 그 20초 동안 안내 대상은 여전히 같은 티이고,
오차 7~8 m짜리 픽스는 30 m 경계를 들락날락합니다. `stepGuidance`의 `opening`
조건이 앵커뿐 아니라 **`spokenBandYards`가 아직 Infinity인지까지** 보는 이유가
이것입니다. 도착이 그 값을 0으로 바꿔 두기 때문에, 경계를 다시 나가도 새 걸음이
시작된 것으로 오인하지 않습니다.

## iOS에서 소리가 나게 하려면

Web Speech는 첫 발화가 사용자 탭 안에서 일어나야 이후의 자동 발화를 허용합니다.
스위치를 켜는 그 탭이 `unlock()`에 즉시 쓰입니다 — 나중을 위해 아껴 둘 수
없습니다. "나중"은 12번 페어웨이 한복판의 GPS 픽스이고, 그 근처에는 어떤
제스처도 없습니다. `AutoNarration`과 같은 처리입니다.

## 손대면 안 되는 숫자

`GUIDANCE_DEFAULTS`의 값은 전부 근거가 주석으로 붙어 있습니다. 특히:

- `arrivedMetres: 30` — `ARRIVAL_DEFAULTS.radiusMetres`와 반드시 같아야 합니다.
  한쪽만 바꾸면 두 기능이 겹치거나(양쪽이 동시에 말함) 빕니다(아무도 말 안 함).
- `maxAccuracyMetres: 25` — 도착 판정기와 같은 기준. 25 m를 자백한 픽스는
  페어웨이 좌우도 구분하지 못합니다.
- `straightOnDegrees: 20` — 60야드 거리에서 페어웨이 폭 정도입니다. 이보다 좁게
  잡으면 걸음마다 좌/우가 뒤집힙니다.

## 재생해 보기

`stepGuidance`는 시계도 I/O도 없는 fold입니다. 기록해 둔 픽스 배열을 그대로
접으면 코스에 나가지 않고도 걸음 하나하나를 검증할 수 있습니다.

```ts
import { initialGuidanceState, stepGuidance, nextTee } from '@/lib/teeGuidance';

let state = initialGuidanceState;
const tee = nextTee(holes, 12)!;

for (const fix of recordedWalk) {
  const step = stepGuidance(state, fix, tee);
  state = step.state;
  if (step.cue) console.log(Math.round(step.reading.yards ?? 0), step.cue);
}
```
