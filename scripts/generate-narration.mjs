/**
 * 홀 나레이션 오디오 생성 (ElevenLabs)
 * scripts/generate-narration.mjs
 *
 * frontend/src/lib/narrationScript.ts 의 buildHoleScriptParts() 가 만드는 문장을
 * 그대로 읽어서 mp3로 굽습니다. 화면에 인쇄되는 글과 귀에 들리는 소리가 갈라지지
 * 않도록, 대본을 여기서 다시 조립하지 않고 앱과 같은 모듈을 불러 씁니다.
 *
 * 목소리는 홀마다 다릅니다. frontend/src/data/narrationCast.ts 가 홀별 캐릭터(음성
 * ID와 음성 설정)를 정하고, 한 홀의 클립은 모두 그 홀 캐릭터 목소리로 굽습니다 -
 * 카드와 해설이 이어 재생되므로 한 홀 안에서는 한 사람이 쭉 읽어야 합니다.
 *
 * 클립은 두 종류입니다. 홀 해설은 여섯 티가 모두 같은 문장이라 홀당 한 번만
 * 굽고, 티마다 다른 것은 앞의 카드 문장뿐입니다. 통짜로 108개를 구우면 37,002자,
 * 이렇게 나누면 같은 내용이 14,309자입니다. 재생할 때 카드 → 해설 순서로 이어
 * 붙이므로 플레이어가 듣는 말은 통짜와 똑같습니다.
 *
 *   frontend/public/audio/holes/hole-{홀}-{티}-card.mp3   108개
 *   frontend/public/audio/holes/hole-{홀}-desc.mp3         18개
 *   frontend/src/data/narrationAudio.ts                    자동 생성 매니페스트
 *
 * 사용법 (키는 .env.local 의 ELEVENLABS_API_KEY 를 읽습니다):
 *   node scripts/generate-narration.mjs --dry-run     # 글자 수만 계산
 *   node scripts/generate-narration.mjs --holes 1     # 한 홀만 시험 삼아
 *   node scripts/generate-narration.mjs               # 빠지거나 바뀐 것만 생성
 *   node scripts/generate-narration.mjs --force       # 전부 다시 생성
 *
 * 옵션:
 *   --dry-run            호출하지 않고 대상·글자 수만 출력
 *   --force              대본이 그대로여도 다시 굽기
 *   --holes 1-18|1,5,9   대상 홀 (기본: 전체)
 *   --tees white,blue    대상 티 - 카드 클립에만 적용 (기본: 전체 6종)
 *   --cards-only         카드 클립만
 *   --desc-only          해설 클립만
 *   --voice <id>         캐스트 대신 모든 홀을 이 음성 하나로 (시험용)
 *   --model <id>         모델 (기본 eleven_multilingual_v2)
 *   --format <fmt>       출력 포맷 (기본 mp3_22050_32)
 *   --concurrency <n>    동시 호출 수 (기본 2 - 요금제별 동시 실행 한도 주의)
 *
 * 바뀐 클립만 다시 굽습니다: 매니페스트에 문장 + 음성 + 음성 설정 + 모델 + 포맷의
 * 해시를 저장해 두고, 해설을 고치면 그 홀의 해설 클립 하나만, 캐릭터를 바꾸면 그
 * 홀의 클립 일곱 개만 대상이 됩니다.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'frontend', 'src');
const AUDIO_DIR = path.join(ROOT, 'frontend', 'public', 'audio', 'holes');
const MANIFEST = path.join(SRC, 'data', 'narrationAudio.ts');
const URL_PREFIX = '/audio/holes/';

// ── 인자 ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

const DRY_RUN = has('dry-run');
const FORCE = has('force');
const CARDS_ONLY = has('cards-only');
const DESC_ONLY = has('desc-only');
// 환경변수로는 받지 않습니다. .env.local 에 남은 값 하나가 캐스트 전체를 조용히
// 한 목소리로 덮어쓰면, 왜 모든 홀이 같은 사람인지 아무도 모릅니다.
const VOICE_OVERRIDE = flag('voice', null);
const MODEL_ID = flag('model', process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2');
// mp3_22050_32 는 모든 요금제에서 쓸 수 있습니다. 128kbps로 올리면 용량이 네 배가
// 되어, 라운드 전에 미리 받아 두기가 부담스러워집니다.
const OUTPUT_FORMAT = flag('format', 'mp3_22050_32');
const CONCURRENCY = Math.max(1, Number(flag('concurrency', '2')));

/** "1-18", "1,5,9", "7" 을 홀 번호 배열로. */
const parseRange = (spec, all) => {
  if (!spec) return all;
  const wanted = new Set();
  for (const part of spec.split(',')) {
    const dash = /^(\d+)-(\d+)$/.exec(part.trim());
    if (dash) {
      for (let n = Number(dash[1]); n <= Number(dash[2]); n++) wanted.add(n);
    } else if (part.trim()) {
      wanted.add(Number(part.trim()));
    }
  }
  const picked = all.filter((n) => wanted.has(n));
  if (picked.length === 0) throw new Error(`--holes ${spec} 에 해당하는 홀이 없습니다.`);
  return picked;
};

// ── 앱과 같은 대본 모듈 불러오기 ─────────────────────────────────────────

/**
 * narrationScript.ts 는 TypeScript이고 '@/' 별칭을 씁니다. Node로는 그대로
 * 불러올 수 없으니, vite가 이미 들고 있는 esbuild로 한 번 묶어서 읽습니다.
 * 별칭은 tsconfig와 같은 곳(frontend/src)을 가리킵니다.
 */
const bundleModule = async (relativeEntry) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narration-'));
  const outfile = path.join(dir, 'bundle.mjs');
  await build({
    entryPoints: [path.join(SRC, relativeEntry)],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    alias: { '@': SRC },
    logLevel: 'warning',
  });
  return import(pathToFileURL(outfile).href);
};

// ── ElevenLabs ──────────────────────────────────────────────────────────

/** .env.local 을 읽어 process.env 를 채웁니다 (없으면 조용히 넘어갑니다). */
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

/**
 * 한 클립을 그 홀 캐릭터의 목소리로 굽습니다. 429(동시 실행/한도)와 5xx는 잠깐
 * 쉬었다 다시 걸고, 401·422처럼 다시 걸어도 같은 답이 올 오류는 바로 던집니다 -
 * 126번 반복해서 같은 실패를 쌓아 봐야 로그만 길어집니다.
 */
const synthesize = async (text, voice, apiKey, attempt = 0) => {
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
    return synthesize(text, voice, apiKey, attempt + 1);
  }
  throw new Error(`ElevenLabs ${response.status}: ${detail}`);
};

// ── 매니페스트 ───────────────────────────────────────────────────────────

/**
 * 디스크에 있는 매니페스트에서 클립별 해시와 음성을 꺼냅니다.
 *
 * 캐스트가 생기기 전 매니페스트는 클립마다 음성을 적지 않고, 맨 위
 * NARRATION_VOICE 에 음성 하나만 적었습니다. 그런 클립은 그 음성으로 구운 것입니다.
 */
const readExisting = () => {
  if (!fs.existsSync(MANIFEST)) return {};
  const source = fs.readFileSync(MANIFEST, 'utf8');
  const legacyVoice =
    /NARRATION_VOICE\s*=\s*\{\s*voiceId:\s*'([A-Za-z0-9]+)'/.exec(source)?.[1] ?? 'unknown';
  const clips = {};
  for (const line of source.split(/\r?\n/)) {
    const id = /^\s*'([a-zA-Z0-9-]+)':\s*\{/.exec(line)?.[1];
    const hash = /hash:\s*'([0-9a-f]+)'/.exec(line)?.[1];
    if (!id || !hash) continue;
    clips[id] = { hash, voiceId: /voiceId:\s*'([A-Za-z0-9]+)'/.exec(line)?.[1] ?? legacyVoice };
  }
  return clips;
};

const quoted = (value) => `'${String(value).replace(/'/g, "\\'")}'`;

const writeManifest = (cards, descriptions, teeOrder) => {
  const cardLines = Object.keys(cards)
    .sort((a, b) => {
      const [, ha, ta] = /^hole-(\d+)-(\w+)-card$/.exec(a);
      const [, hb, tb] = /^hole-(\d+)-(\w+)-card$/.exec(b);
      return Number(ha) - Number(hb) || teeOrder.indexOf(ta) - teeOrder.indexOf(tb);
    })
    .map((id) => {
      const clip = cards[id];
      return (
        `  ${quoted(id)}: { hole: ${clip.hole}, tee: ${quoted(clip.tee)}, ` +
        `url: ${quoted(clip.url)}, bytes: ${clip.bytes}, hash: ${quoted(clip.hash)}, ` +
        `voiceId: ${quoted(clip.voiceId)} },`
      );
    });

  const descLines = Object.keys(descriptions)
    .sort((a, b) => Number(/(\d+)/.exec(a)[1]) - Number(/(\d+)/.exec(b)[1]))
    .map((id) => {
      const clip = descriptions[id];
      return (
        `  ${quoted(id)}: { hole: ${clip.hole}, url: ${quoted(clip.url)}, ` +
        `bytes: ${clip.bytes}, hash: ${quoted(clip.hash)}, voiceId: ${quoted(clip.voiceId)} },`
      );
    });

  const totalBytes = [...Object.values(cards), ...Object.values(descriptions)].reduce(
    (sum, clip) => sum + clip.bytes,
    0
  );

  fs.writeFileSync(
    MANIFEST,
    `// 자동 생성 파일입니다. 직접 고치지 마세요.
// 다시 만들기: node scripts/generate-narration.mjs
//
// scripts/generate-narration.mjs 가 ElevenLabs로 구운 홀 나레이션 목록입니다.
// mp3는 frontend/public/audio/holes/ 에 있고, 서비스 워커가 여기 적힌 url을
// 캐시합니다.
//
// 한 홀의 나레이션은 클립 두 개입니다. 앞은 티마다 다른 카드 문장(108개),
// 뒤는 여섯 티가 공유하는 클럽 해설(18개)입니다. 홀마다 그 홀 캐릭터의
// 목소리(data/narrationCast.ts)로, 두 클립을 같은 목소리·같은 설정으로 구워
// 이어 붙이므로 한 홀 안에서는 한 사람이 쭉 읽는 것처럼 들립니다.
//
// hash는 그 클립이 실제로 읽는 문장 + 음성 + 음성 설정 + 모델 + 포맷의 지문입니다.
// voiceId는 그 파일을 실제로 구운 음성입니다 - 캐스트를 바꾼 뒤 아직 다시 굽지
// 않은 홀을 앱이 알아보고, 다른 사람 목소리 위에 캐릭터 이름을 붙이지 않게 합니다.

import type { TeeSet } from '@/data/pelhamHillsBook';

export interface NarrationClip {
  hole: number;
  /** 앱 루트 기준 절대 경로. 서비스 워커 규칙이 이 접두사로 매칭합니다. */
  url: string;
  bytes: number;
  hash: string;
  /** 이 파일을 구운 ElevenLabs 음성. */
  voiceId: string;
}

export interface NarrationCardClip extends NarrationClip {
  tee: TeeSet;
}

/** 무엇으로 구웠는지 남겨 둡니다. 음성은 홀마다 다릅니다 - data/narrationCast.ts. */
export const NARRATION_RECORDING = {
  modelId: ${quoted(MODEL_ID)},
  outputFormat: ${quoted(OUTPUT_FORMAT)},
} as const;

/** 서비스 워커의 CacheFirst 규칙(vite.config.ts)과 맞춰 두세요. */
export const NARRATION_AUDIO_PREFIX = ${quoted(URL_PREFIX)};

/** 나레이션 전용 런타임 캐시 이름. vite.config.ts의 cacheName과 같아야 합니다. */
export const NARRATION_CACHE_NAME = 'narration-cache';

/** 티마다 다른 카드 문장. */
export const NARRATION_CARDS: Record<string, NarrationCardClip> = {
${cardLines.join('\n')}
};

/** 여섯 티가 공유하는 클럽 해설. */
export const NARRATION_DESCRIPTIONS: Record<string, NarrationClip> = {
${descLines.join('\n')}
};

/** 미리 받기 화면이 "약 N MB"를 계산할 때 씁니다. */
export const NARRATION_AUDIO_TOTAL_BYTES = ${totalBytes};

/** 코스 전체를 받으려면 이 목록을 전부 가져오면 됩니다. */
export const allNarrationUrls = (): string[] => [
  ...Object.values(NARRATION_CARDS).map((clip) => clip.url),
  ...Object.values(NARRATION_DESCRIPTIONS).map((clip) => clip.url),
];

/**
 * 이 홀·티를 읽을 클립을 재생 순서대로.
 *
 * 둘 중 하나라도 없으면 빈 배열입니다 - 카드만 들려주고 해설에서 끊기는 것보다,
 * 통째로 브라우저 TTS에 넘겨 대본 전체를 듣게 하는 편이 낫습니다.
 */
export const narrationClips = (
  holeNumber: number,
  teeSet: TeeSet
): NarrationClip[] => {
  const card = NARRATION_CARDS[\`hole-\${holeNumber}-\${teeSet}-card\`];
  const description = NARRATION_DESCRIPTIONS[\`hole-\${holeNumber}-desc\`];
  return card && description ? [card, description] : [];
};
`,
    'utf8'
  );
};

// ── 본체 ────────────────────────────────────────────────────────────────

const main = async () => {
  loadEnvLocal();

  const { buildHoleScriptParts, narrationCardId, narrationDescriptionId } =
    await bundleModule(path.join('lib', 'narrationScript.ts'));
  const { PELHAM_HILLS_BOOK, PELHAM_HILLS_TEES } = await bundleModule(
    path.join('data', 'pelhamHillsBook.ts')
  );
  const { NARRATION_CAST, CHEERFUL } = await bundleModule(path.join('data', 'narrationCast.ts'));

  const allTees = PELHAM_HILLS_TEES.map((tee) => tee.id);
  const allHoles = PELHAM_HILLS_BOOK.map((hole) => hole.holeNumber);

  /** 이 홀을 읽을 목소리. 캐스트에 빠진 홀은 조용히 넘기지 않고 멈춥니다. */
  const voiceFor = (hole) => {
    if (VOICE_OVERRIDE) return { name: 'override', voiceId: VOICE_OVERRIDE, settings: CHEERFUL };
    const character = NARRATION_CAST[hole];
    if (!character) throw new Error(`data/narrationCast.ts 에 ${hole}번 홀 캐릭터가 없습니다.`);
    return character;
  };

  const holes = parseRange(flag('holes'), allHoles);
  const teeSpec = flag('tees');
  const tees = teeSpec
    ? teeSpec.split(',').map((t) => t.trim()).filter((t) => allTees.includes(t))
    : allTees;
  if (tees.length === 0) throw new Error(`--tees ${teeSpec} 에 해당하는 티가 없습니다.`);

  const existing = readExisting();

  const fingerprint = (text, voice) =>
    createHash('sha256')
      .update([text, voice.voiceId, JSON.stringify(voice.settings), MODEL_ID, OUTPUT_FORMAT].join('|'))
      .digest('hex')
      .slice(0, 12);

  // 매니페스트는 늘 전체를 다시 씁니다. 이번에 굽지 않는 클립도 목록에서 사라지면
  // 안 되므로, 파일이 남아 있는 것은 기존 해시·음성과 함께 그대로 실어 둡니다.
  const cards = {};
  const descriptions = {};
  const todo = [];

  const consider = ({ id, kind, text, targeted, meta, voice }) => {
    const hash = fingerprint(text, voice);
    const file = path.join(AUDIO_DIR, `${id}.mp3`);
    const onDisk = fs.existsSync(file);
    const stale = !onDisk || existing[id]?.hash !== hash;
    const bucket = kind === 'card' ? cards : descriptions;

    if (targeted && (FORCE || stale)) {
      todo.push({ id, kind, text, hash, file, meta, voice });
    } else if (onDisk) {
      bucket[id] = {
        ...meta,
        url: `${URL_PREFIX}${id}.mp3`,
        bytes: fs.statSync(file).size,
        hash: existing[id]?.hash ?? hash,
        voiceId: existing[id]?.voiceId ?? 'unknown',
      };
    }
  };

  for (const hole of allHoles) {
    const voice = voiceFor(hole);

    for (const tee of allTees) {
      const parts = buildHoleScriptParts(hole, tee);
      if (!parts) continue;
      consider({
        id: narrationCardId(hole, tee),
        kind: 'card',
        text: parts.card,
        targeted: !DESC_ONLY && holes.includes(hole) && tees.includes(tee),
        meta: { hole, tee },
        voice,
      });
    }

    // 해설은 티와 무관합니다. 아무 티로나 한 번만 꺼내 씁니다.
    const parts = buildHoleScriptParts(hole, allTees[0]);
    if (!parts) continue;
    consider({
      id: narrationDescriptionId(hole),
      kind: 'description',
      text: parts.description,
      targeted: !CARDS_ONLY && holes.includes(hole),
      meta: { hole },
      voice,
    });
  }

  const chars = todo.reduce((sum, item) => sum + item.text.length, 0);
  const cardCount = todo.filter((item) => item.kind === 'card').length;

  console.log(
    `모델 ${MODEL_ID} / 포맷 ${OUTPUT_FORMAT} / 음성 ` +
      (VOICE_OVERRIDE ? `${VOICE_OVERRIDE} (--voice, 전 홀 공통)` : '홀별 캐릭터 (data/narrationCast.ts)')
  );
  console.log(
    `대상 ${todo.length}개 (카드 ${cardCount}, 해설 ${todo.length - cardCount}), ` +
      `${chars.toLocaleString()}자`
  );
  console.log(
    `그대로라 건너뛰는 클립 ${Object.keys(cards).length + Object.keys(descriptions).length}개.`
  );

  if (DRY_RUN) {
    for (const item of todo.slice(0, 5)) {
      console.log(
        `  ${item.id} [${item.voice.name}] (${item.text.length}자) "${item.text.slice(0, 60)}..."`
      );
    }
    if (todo.length > 5) console.log(`  ... 외 ${todo.length - 5}개`);
    console.log('\n--dry-run 이라 호출하지 않았습니다.');
    return;
  }

  if (todo.length === 0) {
    console.log('새로 구울 클립이 없습니다.');
    if (Object.keys(cards).length + Object.keys(descriptions).length > 0) {
      writeManifest(cards, descriptions, allTees);
    }
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

  // 클립 하나가 실패해도 나머지는 계속 굽고, 성공한 것만 매니페스트에 실어
  // 둡니다. 중간에 끊겨도 다시 실행하면 남은 것부터 이어서 갑니다.
  const worker = async () => {
    for (let item = todo.shift(); item; item = todo.shift()) {
      try {
        const audio = await synthesize(item.text, item.voice, apiKey);
        fs.writeFileSync(item.file, audio);
        (item.kind === 'card' ? cards : descriptions)[item.id] = {
          ...item.meta,
          url: `${URL_PREFIX}${item.id}.mp3`,
          bytes: audio.length,
          hash: item.hash,
          voiceId: item.voice.voiceId,
        };
        done += 1;
        console.log(`  [${done}] ${item.id} (${item.voice.name})  ${(audio.length / 1024).toFixed(1)}KB`);
      } catch (error) {
        failures.push(`${item.id}: ${error.message}`);
        console.error(`  ✗ ${item.id}: ${error.message}`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  writeManifest(cards, descriptions, allTees);

  const clips = [...Object.values(cards), ...Object.values(descriptions)];
  const totalBytes = clips.reduce((sum, clip) => sum + clip.bytes, 0);
  console.log(`\n완료 ${done}개, 실패 ${failures.length}개.`);
  console.log(
    `전체 ${clips.length}개 클립 (카드 ${Object.keys(cards).length}, ` +
      `해설 ${Object.keys(descriptions).length}) / ${(totalBytes / 1024 / 1024).toFixed(1)}MB`
  );
  console.log(`매니페스트: ${path.relative(ROOT, MANIFEST)}`);

  if (failures.length > 0) {
    console.error('\n실패한 클립은 다시 실행하면 이어서 굽습니다:');
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
