# 홀 나레이션 (ElevenLabs)

18홀 각각을 사람 목소리로 읽어 주는 기능입니다. mp3는 미리 구워서 저장소에 함께
커밋하고, 앱은 그 파일을 재생합니다. 파일이 없거나 아직 받지 못했으면 브라우저의
Web Speech 엔진이 같은 대본을 대신 읽습니다 — 코스에서 신호가 끊겨도 홀 설명이
사라지지는 않습니다.

## 무엇이 어디에 있나

| 파일 | 역할 |
| --- | --- |
| `frontend/src/lib/narrationScript.ts` | 대본을 만드는 단 하나의 자리. 화면에 인쇄되는 글이자 녹음된 문장 |
| `scripts/generate-narration.mjs` | ElevenLabs를 호출해 mp3를 굽고 매니페스트를 씀 |
| `frontend/public/audio/holes/*.mp3` | 결과물 126개. 커밋합니다 |
| `frontend/src/data/narrationAudio.ts` | 자동 생성 매니페스트. 손으로 고치지 마세요 |
| `frontend/src/hooks/useHoleNarration.ts` | 재생 + 브라우저 TTS 폴백 |
| `frontend/src/components/HoleNarration.tsx` | 재생 버튼과 대본 표시 |
| `frontend/src/components/OfflineNarration.tsx` | 라운드 전에 클립을 미리 받아 두는 버튼 |

## 클립이 두 종류인 이유

한 홀의 나레이션은 파일 두 개를 이어 붙인 것입니다.

```
hole-7-white-card.mp3   "Hole 7. Par 3, stroke index 15. 168 yards from the White tee. The green is 27 yards deep."
hole-7-desc.mp3         "A downhill par three ..." (클럽 야디지북 해설)
```

앞의 카드 문장만 티마다 다르고, 뒤의 해설은 여섯 티가 모두 같은 글입니다. 통짜로
`18 × 6 = 108`개를 구우면 해설을 여섯 번씩 중복해서 굽는 셈이라 **37,002자**가
나갑니다. 나눠서 카드 108개 + 해설 18개로 구우면 같은 내용이 **14,309자**입니다.
ElevenLabs는 글자 수로 과금하므로 61% 차이입니다.

플레이어가 듣는 말은 통짜와 똑같습니다. 같은 음성·같은 설정으로 구워서 순서대로
이어 재생하고, 화면의 두 문단 사이 여백이 그 이음매와 같은 자리입니다.

## 다시 굽기

키는 저장소 루트의 `.env.local`(gitignore 대상)에서 읽습니다.

```bash
# ELEVENLABS_API_KEY=sk_...  ← .env.local
node scripts/generate-narration.mjs --dry-run     # 글자 수만 계산, 호출 안 함
node scripts/generate-narration.mjs --holes 1     # 한 홀만 시험 삼아 (809자)
node scripts/generate-narration.mjs               # 빠지거나 낡은 것만
node scripts/generate-narration.mjs --force       # 전부 다시 (14,309자)
```

**돈이 나가기 전에 항상 `--dry-run` 을 먼저 돌리세요.** 대상 클립 수와 글자 수를
그대로 찍어 줍니다.

### 무엇이 "낡은" 클립인가

매니페스트는 클립마다 해시를 들고 있습니다 — 그 클립이 실제로 읽는 문장 + 음성 ID
+ 모델 + 출력 포맷의 지문입니다. `pelhamHillsBook.ts` 에서 7번 홀 해설을 고치면
`hole-7-desc` 의 해시만 달라지고, 7번 홀 카드 클립 여섯 개는 손대지 않습니다.
야디지를 고치면 반대로 그 카드 클립만 대상이 됩니다.

그래서 평소 실행은 `--force` 없이 그냥 돌리면 됩니다. 바뀐 것만 다시 굽습니다.

### 음성 바꾸기

```bash
node scripts/generate-narration.mjs --voice <voice_id> --force
```

지금 값은 매니페스트의 `NARRATION_VOICE` 에 적혀 있습니다.

| 항목 | 값 |
| --- | --- |
| voice | `JBFqnCBsd6RMkjVDRZzb` (George — 차분한 영국식 내레이션) |
| model | `eleven_multilingual_v2` |
| format | `mp3_22050_32` |
| speed | `0.95` |

`mp3_22050_32` 는 모든 요금제에서 쓸 수 있고 126개를 합쳐 5MB 남짓입니다. 128kbps로
올리면 용량이 네 배가 되어 라운드 전에 미리 받아 두기가 부담스러워집니다.

음성 ID를 바꾸면 해시가 전부 달라지므로 `--force` 없이도 126개가 모두 대상이
됩니다. 위 명령의 `--force` 는 보험입니다.

### API 키 권한

`text_to_speech` 권한만 있으면 됩니다. `/v1/voices` 로 음성 목록을 보려면
`voices_read` 도 필요하지만, 굽는 데는 없어도 됩니다.

## 오프라인

mp3는 **precache 하지 않습니다.** 5MB를 첫 방문에서 무조건 받게 하는 대신,
`vite.config.ts` 의 `narration-cache` 런타임 규칙(CacheFirst)이 한 번 재생한 클립을
남겨 두고, 사이드 메뉴의 **Download hole narration** 버튼이 126개를 한꺼번에
받아 둡니다. 지도 타일과 같은 방식입니다 — 쓸 만한 순간은 7번 홀이 아니라 주차장
입니다.

클립이 없으면 `useHoleNarration` 이 그 자리에서 브라우저 음성으로 넘어갑니다.
카드까지 들려주고 해설에서 끊기는 일이 없도록, 첫 클립이 실패하면 대본 전체를,
두 번째가 실패하면 남은 문단부터 읽습니다.

### iOS Safari

클립 두 개를 `<audio>` 엘리먼트 **하나**의 `src` 를 바꿔 가며 재생합니다. iOS는
사용자 제스처 안에서 재생된 그 엘리먼트만 잠금을 풀어 주기 때문에, 두 번째
엘리먼트가 `ended` 핸들러에서 `play()` 를 부르면 거부당합니다. 첫 클립이 재생되는
동안 두 번째를 `fetch()` 로 미리 받아 두므로 `src` 를 바꿀 때 네트워크를 기다리지
않습니다.

재생은 언제나 탭에서 시작해야 합니다. 자동 재생하지 마세요.

## 대본을 고칠 때

`narrationScript.ts` 의 `buildHoleScriptParts()` 하나만 고치면 화면 글과 녹음
대상이 함께 움직입니다. 대본을 생성기 쪽에 다시 적지 마세요 — 인쇄된 글과 들리는
말이 갈라지는 순간 이 기능의 의미가 없어집니다.

고친 뒤에는 `node scripts/generate-narration.mjs` 를 한 번 돌리고, 바뀐 mp3와
매니페스트를 함께 커밋하면 됩니다.
