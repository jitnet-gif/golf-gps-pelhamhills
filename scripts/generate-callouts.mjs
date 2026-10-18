/**
 * 야디지 음성 클립 생성 (ElevenLabs)
 * scripts/generate-callouts.mjs
 *
 * 멈춰 섰을 때 들리는 "About one hundred and forty two yards to the pin" 을
 * 홀 해설과 같은 ElevenLabs 목소리로 들려주기 위한 조각들입니다. 숫자가 매번
 * 달라서 문장 하나를 통째로 구울 수 없으므로, 숫자와 문장 꼬리를 따로 구워
 * 앱이 이어 붙입니다 (frontend/src/lib/calloutVoice.ts).
 *
 *   About | one hundred and forty two | yards to the pin.
 *                                     | yards to the pin, along the fairway.
 *                                     | yards to the pin, straight line.
 *   , one hundred and ten | to the bend.
 *
 * 그래서 클립은 숫자 1~560 과 꼬리 몇 개뿐입니다 - 한 번 구워 두면 인터넷이
 * 없는 페어웨이에서도 그대로 나옵니다. 브라우저가 mp3 를 못 틀면 앱은 예전처럼
 * 기계 음성으로 같은 문장을 읽습니다.
 *
 *   frontend/public/audio/callouts/{id}.mp3
 *   frontend/src/data/calloutAudio.ts        자동 생성 매니페스트
 *
 * 사용법 (키는 .env.local 의 ELEVENLABS_API_KEY 를 읽습니다):
 *   node scripts/generate-callouts.mjs --dry-run        # 글자 수와 비용만
 *   node scripts/generate-callouts.mjs --max 200        # 200야드까지만 시험 삼아
 *   node scripts/generate-callouts.mjs                  # 빠진 것만 생성
 *   node scripts/generate-callouts.mjs --force          # 전부 다시 생성
 *
 * 옵션:
 *   --voice <id>       기본은 NARRATION_CAST 2번 홀(Liam, 힘찬 목소리)
 *   --max <n>          가장 먼 야디지 (기본 560 - 제일 긴 홀이 522야드)
 *   --concurrency <n>  동시 호출 수 (기본 3)
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_DIR = path.join(ROOT, 'frontend', 'public', 'audio', 'callouts');
const MANIFEST = path.join(ROOT, 'frontend', 'src', 'data', 'calloutAudio.ts');
const URL_PREFIX = '/audio/callouts/';

const MODEL_ID = 'eleven_multilingual_v2';
const OUTPUT_FORMAT = 'mp3_22050_32';

/** 2번 홀 해설과 같은 Liam. 캐디가 외치는 말이라 해설보다 조금 더 힘을 줍니다. */
const VOICE = {
  name: 'Liam',
  voiceId: 'TX3LPaxmHKxFdv7VOQHJ',
  settings: { stability: 0.35, similarityBoost: 0.75, style: 0.45, speed: 1.0 },
};

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const DRY_RUN = flag('--dry-run');
const FORCE = flag('--force');
const MAX_YARDS = Number(value('--max', '560'));
const CONCURRENCY = Math.max(1, Number(value('--concurrency', '3')));
const voice = { ...VOICE, voiceId: value('--voice', VOICE.voiceId) };

/**
 * 숫자를 사람이 읽는 말로. "and" 를 넣습니다 - 없는 쪽("one hundred forty two")은
 * 미국식이지만, 여기 목소리들은 영국·호주가 섞여 있어 이쪽이 자연스럽습니다.
 */
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

export const spellNumber = (n) => {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)];
    return n % 10 ? `${tens}-${ONES[n % 10]}` : tens;
  }
  const hundreds = `${ONES[Math.floor(n / 100)]} hundred`;
  const rest = n % 100;
  return rest ? `${hundreds} and ${spellNumber(rest)}` : hundreds;
};

/** 앱이 이어 붙일 조각들. id 는 파일 이름이자 매니페스트의 열쇠입니다. */
const pieces = () => {
  const list = [
    { id: 'about', text: 'About' },
    { id: 'tail-pin', text: 'yards to the pin.' },
    { id: 'tail-fairway', text: 'yards to the pin, along the fairway.' },
    { id: 'tail-straight', text: 'yards to the pin, straight line.' },
    { id: 'tail-bend', text: 'to the bend.' },
    // The same ends, left open, for when a bend or the straight figure follows:
    // a full stop there turns the rest of the callout into a fragment.
    { id: 'tail-pin-open', text: 'yards to the pin,' },
    { id: 'tail-fairway-open', text: 'yards to the pin, along the fairway,' },
    { id: 'tail-bend-open', text: 'to the bend,' },
    { id: 'tail-straight-only', text: 'straight.' },
  ];
  for (let n = 1; n <= MAX_YARDS; n += 1) list.push({ id: `n-${n}`, text: spellNumber(n) });
  return list;
};

const hashOf = (text) =>
  createHash('sha256')
    .update(JSON.stringify([text, voice.voiceId, voice.settings, MODEL_ID, OUTPUT_FORMAT]))
    .digest('hex')
    .slice(0, 16);

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const synthesize = async (text, apiKey, attempt = 0) => {
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${voice.voiceId}` +
    `?output_format=${encodeURIComponent(OUTPUT_FORMAT)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: {
        stability: voice.settings.stability,
        similarity_boost: voice.settings.similarityBoost,
        style: voice.settings.style,
        use_speaker_boost: true,
        speed: voice.settings.speed,
      },
    }),
  });
  if (response.ok) return Buffer.from(await response.arrayBuffer());
  const retryable = response.status === 429 || response.status >= 500;
  const detail = (await response.text()).slice(0, 300);
  if (retryable && attempt < 4) {
    const wait = 2000 * 2 ** attempt;
    console.warn(`   ${response.status} - ${wait / 1000}초 후 재시도 (${attempt + 1}/4)`);
    await sleep(wait);
    return synthesize(text, apiKey, attempt + 1);
  }
  throw new Error(`ElevenLabs ${response.status}: ${detail}`);
};

const readExisting = () => {
  if (!fs.existsSync(MANIFEST)) return {};
  const source = fs.readFileSync(MANIFEST, 'utf8');
  const clips = {};
  for (const match of source.matchAll(
    /'([^']+)':\s*\{\s*url:\s*'([^']+)',\s*bytes:\s*(\d+),\s*hash:\s*'([^']+)'/g
  )) {
    clips[match[1]] = { url: match[2], bytes: Number(match[3]), hash: match[4] };
  }
  return clips;
};

const writeManifest = (clips) => {
  const ids = Object.keys(clips).sort((a, b) => {
    const na = /^n-(\d+)$/.exec(a);
    const nb = /^n-(\d+)$/.exec(b);
    if (na && nb) return Number(na[1]) - Number(nb[1]);
    if (na) return 1;
    if (nb) return -1;
    return a.localeCompare(b);
  });
  const bytes = ids.reduce((sum, id) => sum + clips[id].bytes, 0);
  const lines = [
    '// 자동 생성 파일입니다. 직접 고치지 마세요.',
    '// 다시 만들기: node scripts/generate-callouts.mjs',
    '//',
    '// 멈춰 섰을 때 읽어 주는 야디지의 조각들입니다. 숫자와 문장 꼬리를 따로 구워',
    '// lib/calloutVoice.ts 가 이어 붙입니다. mp3 는 frontend/public/audio/callouts/ 에',
    '// 있고, 서비스 워커가 이 접두사로 캐시합니다.',
    '',
    'export interface CalloutClip {',
    '  url: string;',
    '  bytes: number;',
    '  hash: string;',
    '}',
    '',
    '/** 무엇으로 구웠는지. 목소리를 바꾸면 전부 다시 구워야 합니다. */',
    'export const CALLOUT_RECORDING = {',
    `  voiceId: '${voice.voiceId}',`,
    `  voiceName: '${voice.name}',`,
    `  modelId: '${MODEL_ID}',`,
    `  outputFormat: '${OUTPUT_FORMAT}',`,
    '} as const;',
    '',
    '/** 서비스 워커의 CacheFirst 규칙(vite.config.ts)과 맞춰 두세요. */',
    "export const CALLOUT_AUDIO_PREFIX = '/audio/callouts/';",
    "export const CALLOUT_CACHE_NAME = 'callout-cache';",
    '',
    '/** 라운드 전에 미리 받을 때 쓰는 합계. */',
    `export const CALLOUT_AUDIO_TOTAL_BYTES = ${bytes};`,
    '',
    `/** 가장 먼 야디지. 이보다 멀면 기계 음성으로 읽습니다. */`,
    `export const CALLOUT_MAX_YARDS = ${MAX_YARDS};`,
    '',
    `/** ${ids.length}개 조각, 합계 ${(bytes / 1024 / 1024).toFixed(1)}MB. */`,
    'export const CALLOUT_CLIPS: Readonly<Record<string, CalloutClip>> = {',
    ...ids.map(
      (id) =>
        `  '${id}': { url: '${clips[id].url}', bytes: ${clips[id].bytes}, hash: '${clips[id].hash}' },`
    ),
    '};',
    '',
    '/** 라운드 전에 전부 받으려면 이 목록을 가져오면 됩니다. */',
    'export const allCalloutUrls = (): string[] => Object.values(CALLOUT_CLIPS).map((clip) => clip.url);',
    '',
  ];
  fs.writeFileSync(MANIFEST, lines.join('\n'), 'utf8');
};

const main = async () => {
  loadEnvLocal();
  const existing = readExisting();
  const clips = { ...existing };
  const todo = [];

  for (const piece of pieces()) {
    const hash = hashOf(piece.text);
    const file = path.join(AUDIO_DIR, `${piece.id}.mp3`);
    const known = existing[piece.id];
    if (!FORCE && known && known.hash === hash && fs.existsSync(file)) continue;
    todo.push({ ...piece, hash, file });
  }

  const characters = todo.reduce((sum, item) => sum + item.text.length, 0);
  console.log(`목소리: ${voice.name} (${voice.voiceId})`);
  console.log(`구울 클립: ${todo.length}개, ${characters}자`);

  if (DRY_RUN) {
    for (const item of todo.slice(0, 5)) console.log(`  ${item.id}  "${item.text}"`);
    if (todo.length > 5) console.log(`  ... 외 ${todo.length - 5}개`);
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

  let done = 0;
  const failures = [];
  const worker = async () => {
    for (let item = todo.shift(); item; item = todo.shift()) {
      try {
        const audio = await synthesize(item.text, apiKey);
        fs.writeFileSync(item.file, audio);
        clips[item.id] = { url: `${URL_PREFIX}${item.id}.mp3`, bytes: audio.length, hash: item.hash };
        done += 1;
        if (done % 25 === 0 || done === 1) console.log(`  [${done}] ${item.id} "${item.text}"`);
      } catch (error) {
        failures.push(`${item.id}: ${error.message}`);
        console.error(`  ✗ ${item.id}: ${error.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  writeManifest(clips);
  const total = Object.values(clips).reduce((sum, clip) => sum + clip.bytes, 0);
  console.log(`\n${done}개 생성, 합계 ${(total / 1024 / 1024).toFixed(1)}MB`);
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
