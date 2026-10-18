/**
 * 8번·17번 홀 제안 음성 굽기 (ElevenLabs)
 * scripts/generate-hole-ads.mjs
 *
 * 왜 이걸 굽는가
 * -------------------------------------------------------------------------
 * 지금까지 이 두 줄은 브라우저의 speechSynthesis 로 읽었습니다. 야디지 콜아웃과
 * 홀 해설은 구워 둔 mp3 인데 이것만 기계 음성이었고, 그래서 **소리가 아예 안
 * 나는 일이 생깁니다**. 엔진이 다르기 때문입니다:
 *
 *   - 라운드 시작 카드가 사 두는 것은 오디오 엘리먼트의 재생권입니다.
 *     speechSynthesis 는 같은 문서라도 따로 놉니다 - 특히 아이폰에서, 그리고
 *     en-US 목소리가 아예 설치돼 있지 않은 폰에서 조용히 아무 일도 안 합니다.
 *   - 콜아웃이 나온다는 것은 오디오 엘리먼트 쪽은 멀쩡하다는 뜻입니다.
 *
 * 그래서 이 두 줄도 같은 목소리(Liam)로 구워, 콜아웃과 같은 길로 내보냅니다.
 * 굽지 못했거나 mp3 를 못 트는 폰에서는 예전처럼 기계 음성으로 읽습니다 -
 * 화면의 글은 어느 쪽이든 그대로 있습니다.
 *
 * 나오는 것:
 *   frontend/public/audio/ads/hole-8.mp3, hole-17.mp3
 *   frontend/src/data/holeAdAudio.ts          자동 생성 매니페스트
 *
 * 사용법 (키는 .env.local 의 ELEVENLABS_API_KEY 를 읽습니다):
 *   node scripts/generate-hole-ads.mjs --dry-run     # 글자 수만
 *   node scripts/generate-hole-ads.mjs               # 빠진 것만
 *   node scripts/generate-hole-ads.mjs --force       # 전부 다시
 *
 * 문구를 고치면(data/holeAds.ts) 다시 돌리세요. 해시가 달라져 그 홀만 다시
 * 구워집니다.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_DIR = path.join(ROOT, 'frontend', 'public', 'audio', 'ads');
const MANIFEST = path.join(ROOT, 'frontend', 'src', 'data', 'holeAdAudio.ts');
const ADS_SOURCE = path.join(ROOT, 'frontend', 'src', 'data', 'holeAds.ts');
const URL_PREFIX = '/audio/ads/';

const MODEL_ID = 'eleven_multilingual_v2';
const OUTPUT_FORMAT = 'mp3_22050_32';

/** 콜아웃과 같은 Liam. 두 소리가 한 사람이어야 캐디 한 명으로 들립니다. */
const VOICE = {
  name: 'Liam',
  voiceId: 'TX3LPaxmHKxFdv7VOQHJ',
  settings: { stability: 0.4, similarityBoost: 0.75, style: 0.4, speed: 1.0 },
};

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');

const loadEnvLocal = () => {
  const file = path.join(ROOT, '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
};

/**
 * 문구는 data/holeAds.ts 가 원본입니다. 여기에 베껴 두면 클럽이 한쪽만 고쳤을
 * 때 화면의 글과 들리는 말이 갈라집니다 - 그래서 읽어서 뽑아냅니다.
 */
const readAds = () => {
  const source = fs.readFileSync(ADS_SOURCE, 'utf8');
  const ads = [];
  const entry = /holeNumber:\s*(\d+)[\s\S]*?body:\s*'((?:[^'\\]|\\.)*)'/g;
  for (let m = entry.exec(source); m; m = entry.exec(source)) {
    ads.push({ holeNumber: Number(m[1]), body: m[2].replace(/\\'/g, "'") });
  }
  if (ads.length === 0) {
    throw new Error(`data/holeAds.ts 에서 문구를 찾지 못했습니다. 형식이 바뀌었는지 보세요.`);
  }
  return ads;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const synthesize = async (text, apiKey, attempt = 0) => {
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE.voiceId}` +
    `?output_format=${encodeURIComponent(OUTPUT_FORMAT)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: {
        stability: VOICE.settings.stability,
        similarity_boost: VOICE.settings.similarityBoost,
        style: VOICE.settings.style,
        use_speaker_boost: true,
        speed: VOICE.settings.speed,
      },
    }),
  });
  if (response.ok) return Buffer.from(await response.arrayBuffer());
  const detail = await response.text().catch(() => '');
  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    await sleep(1000 * 2 ** attempt);
    return synthesize(text, apiKey, attempt + 1);
  }
  throw new Error(`ElevenLabs ${response.status}: ${detail.slice(0, 200)}`);
};

const writeManifest = (clips) => {
  const total = Object.values(clips).reduce((sum, clip) => sum + clip.bytes, 0);
  const rows = Object.entries(clips)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(
      ([hole, clip]) =>
        `  ${hole}: { url: '${clip.url}', bytes: ${clip.bytes}, hash: '${clip.hash}' },`
    )
    .join('\n');

  fs.writeFileSync(
    MANIFEST,
    `// 자동 생성 파일입니다. 직접 고치지 마세요.
// 다시 만들기: node scripts/generate-hole-ads.mjs
//
// 8번·17번 홀에서 프로 샵 제안을 읽어 주는 클립입니다. 콜아웃과 같은 목소리로
// 구워, 같은 오디오 엘리먼트로 내보냅니다 - 라운드 시작 카드가 재생권을 사
// 두는 쪽이 그 엘리먼트이기 때문입니다. 없거나 못 틀면 components/HoleAd 가
// 기계 음성으로 같은 문장을 읽습니다.

export interface HoleAdClip {
  url: string;
  bytes: number;
  hash: string;
}

/** 무엇으로 구웠는지. 목소리를 바꾸면 전부 다시 구워야 합니다. */
export const HOLE_AD_RECORDING = {
  voiceId: '${VOICE.voiceId}',
  voiceName: '${VOICE.name}',
  modelId: '${MODEL_ID}',
  outputFormat: '${OUTPUT_FORMAT}',
} as const;

/** 서비스 워커의 CacheFirst 규칙(vite.config.ts)과 맞춰 두세요. */
export const HOLE_AD_AUDIO_PREFIX = '${URL_PREFIX}';
export const HOLE_AD_CACHE_NAME = 'hole-ad-cache';

export const HOLE_AD_AUDIO_TOTAL_BYTES = ${total};

/** 홀 번호 -> 클립. 없는 홀은 기계 음성으로 읽힙니다. */
export const HOLE_AD_CLIPS: Record<number, HoleAdClip> = {
${rows}
};

export const holeAdClip = (holeNumber: number): HoleAdClip | null =>
  HOLE_AD_CLIPS[holeNumber] ?? null;

/** 라운드 전에 미리 받아 두는 목록 (components/OfflineNarration). */
export const allHoleAdUrls = (): string[] =>
  Object.values(HOLE_AD_CLIPS).map((clip) => clip.url);
`,
    'utf8'
  );
};

const main = async () => {
  loadEnvLocal();
  const ads = readAds();

  const clips = {};
  const todo = [];
  for (const ad of ads) {
    const id = `hole-${ad.holeNumber}`;
    const file = path.join(AUDIO_DIR, `${id}.mp3`);
    const hash = createHash('sha1')
      .update(`${VOICE.voiceId}|${MODEL_ID}|${OUTPUT_FORMAT}|${ad.body}`)
      .digest('hex')
      .slice(0, 12);

    if (!FORCE && fs.existsSync(file)) {
      clips[ad.holeNumber] = {
        url: `${URL_PREFIX}${id}.mp3`,
        bytes: fs.statSync(file).size,
        hash,
      };
      continue;
    }
    todo.push({ id, file, hash, holeNumber: ad.holeNumber, text: ad.body });
  }

  const characters = todo.reduce((sum, item) => sum + item.text.length, 0);
  console.log(`목소리: ${VOICE.name} (${VOICE.voiceId})`);
  console.log(`구울 클립: ${todo.length}개, ${characters}자`);
  for (const item of todo) console.log(`  ${item.id}  "${item.text.slice(0, 70)}..."`);

  if (DRY_RUN) {
    console.log('\n--dry-run 이라 호출하지 않았습니다.');
    return;
  }
  if (todo.length === 0) {
    console.log('새로 구울 클립이 없습니다.');
    if (Object.keys(clips).length) writeManifest(clips);
    return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('ELEVENLABS_API_KEY 가 필요합니다 (.env.local 또는 환경변수).');
    process.exit(1);
  }
  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  const failures = [];
  for (const item of todo) {
    try {
      const audio = await synthesize(item.text, apiKey);
      fs.writeFileSync(item.file, audio);
      clips[item.holeNumber] = {
        url: `${URL_PREFIX}${item.id}.mp3`,
        bytes: audio.length,
        hash: item.hash,
      };
      console.log(`  ✓ ${item.id}  ${(audio.length / 1024).toFixed(0)} KB`);
    } catch (error) {
      failures.push(`${item.id}: ${error.message}`);
      console.error(`  ✗ ${item.id}: ${error.message}`);
    }
  }

  writeManifest(clips);
  const total = Object.values(clips).reduce((sum, clip) => sum + clip.bytes, 0);
  console.log(`\n합계 ${(total / 1024).toFixed(0)} KB`);
  if (failures.length) {
    console.error(`\n실패 ${failures.length}개:`);
    for (const line of failures) console.error(`  ${line}`);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
