// 자동 생성 파일입니다. 직접 고치지 마세요.
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
  voiceId: 'TX3LPaxmHKxFdv7VOQHJ',
  voiceName: 'Liam',
  modelId: 'eleven_multilingual_v2',
  outputFormat: 'mp3_22050_32',
} as const;

/** 서비스 워커의 CacheFirst 규칙(vite.config.ts)과 맞춰 두세요. */
export const HOLE_AD_AUDIO_PREFIX = '/audio/ads/';
export const HOLE_AD_CACHE_NAME = 'hole-ad-cache';

export const HOLE_AD_AUDIO_TOTAL_BYTES = 46847;

/** 홀 번호 -> 클립. 없는 홀은 기계 음성으로 읽힙니다. */
export const HOLE_AD_CLIPS: Record<number, HoleAdClip> = {
  8: { url: '/audio/ads/hole-8.mp3', bytes: 28021, hash: '65d91c0f03b9' },
  17: { url: '/audio/ads/hole-17.mp3', bytes: 18826, hash: 'b35c62da158a' },
};

export const holeAdClip = (holeNumber: number): HoleAdClip | null =>
  HOLE_AD_CLIPS[holeNumber] ?? null;

/** 라운드 전에 미리 받아 두는 목록 (components/OfflineNarration). */
export const allHoleAdUrls = (): string[] =>
  Object.values(HOLE_AD_CLIPS).map((clip) => clip.url);
