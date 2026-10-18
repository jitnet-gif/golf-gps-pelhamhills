// 자동 생성 파일입니다. 직접 고치지 마세요.
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
  modelId: 'eleven_multilingual_v2',
  outputFormat: 'mp3_22050_32',
} as const;

/** 서비스 워커의 CacheFirst 규칙(vite.config.ts)과 맞춰 두세요. */
export const NARRATION_AUDIO_PREFIX = '/audio/holes/';

/** 나레이션 전용 런타임 캐시 이름. vite.config.ts의 cacheName과 같아야 합니다. */
export const NARRATION_CACHE_NAME = 'narration-cache';

/** 티마다 다른 카드 문장. */
export const NARRATION_CARDS: Record<string, NarrationCardClip> = {
  'hole-1-blue-card': { hole: 1, tee: 'blue', url: '/audio/holes/hole-1-blue-card.mp3', bytes: 36380, hash: '434331659b67', voiceId: 'cgSgspJ2msm6clMCkdW9' },
  'hole-1-white-card': { hole: 1, tee: 'white', url: '/audio/holes/hole-1-white-card.mp3', bytes: 39515, hash: '2334f711ee4f', voiceId: 'cgSgspJ2msm6clMCkdW9' },
  'hole-1-whiteYellow-card': { hole: 1, tee: 'whiteYellow', url: '/audio/holes/hole-1-whiteYellow-card.mp3', bytes: 45471, hash: '5efadef0dd11', voiceId: 'cgSgspJ2msm6clMCkdW9' },
  'hole-1-yellow-card': { hole: 1, tee: 'yellow', url: '/audio/holes/hole-1-yellow-card.mp3', bytes: 38575, hash: '7f6a526fa6fe', voiceId: 'cgSgspJ2msm6clMCkdW9' },
  'hole-1-yellowRed-card': { hole: 1, tee: 'yellowRed', url: '/audio/holes/hole-1-yellowRed-card.mp3', bytes: 40560, hash: '402798773ab3', voiceId: 'cgSgspJ2msm6clMCkdW9' },
  'hole-1-red-card': { hole: 1, tee: 'red', url: '/audio/holes/hole-1-red-card.mp3', bytes: 38784, hash: 'feeef8f5166b', voiceId: 'cgSgspJ2msm6clMCkdW9' },
  'hole-2-blue-card': { hole: 2, tee: 'blue', url: '/audio/holes/hole-2-blue-card.mp3', bytes: 32201, hash: '88d142e7a592', voiceId: 'TX3LPaxmHKxFdv7VOQHJ' },
  'hole-2-white-card': { hole: 2, tee: 'white', url: '/audio/holes/hole-2-white-card.mp3', bytes: 27812, hash: '38595100cbd7', voiceId: 'TX3LPaxmHKxFdv7VOQHJ' },
  'hole-2-whiteYellow-card': { hole: 2, tee: 'whiteYellow', url: '/audio/holes/hole-2-whiteYellow-card.mp3', bytes: 37634, hash: '6675f1e49096', voiceId: 'TX3LPaxmHKxFdv7VOQHJ' },
  'hole-2-yellow-card': { hole: 2, tee: 'yellow', url: '/audio/holes/hole-2-yellow-card.mp3', bytes: 33768, hash: 'f9daf88a82ae', voiceId: 'TX3LPaxmHKxFdv7VOQHJ' },
  'hole-2-yellowRed-card': { hole: 2, tee: 'yellowRed', url: '/audio/holes/hole-2-yellowRed-card.mp3', bytes: 33350, hash: 'b8c8efaa866a', voiceId: 'TX3LPaxmHKxFdv7VOQHJ' },
  'hole-2-red-card': { hole: 2, tee: 'red', url: '/audio/holes/hole-2-red-card.mp3', bytes: 30738, hash: 'f712f5f386e9', voiceId: 'TX3LPaxmHKxFdv7VOQHJ' },
  'hole-3-blue-card': { hole: 3, tee: 'blue', url: '/audio/holes/hole-3-blue-card.mp3', bytes: 28544, hash: '58f84d267043', voiceId: 'FGY2WhTYpPnrIDTdsKH5' },
  'hole-3-white-card': { hole: 3, tee: 'white', url: '/audio/holes/hole-3-white-card.mp3', bytes: 29066, hash: 'b1825f3cbe74', voiceId: 'FGY2WhTYpPnrIDTdsKH5' },
  'hole-3-whiteYellow-card': { hole: 3, tee: 'whiteYellow', url: '/audio/holes/hole-3-whiteYellow-card.mp3', bytes: 32619, hash: 'ee9d205b924e', voiceId: 'FGY2WhTYpPnrIDTdsKH5' },
  'hole-3-yellow-card': { hole: 3, tee: 'yellow', url: '/audio/holes/hole-3-yellow-card.mp3', bytes: 28753, hash: '409082fd05a3', voiceId: 'FGY2WhTYpPnrIDTdsKH5' },
  'hole-3-yellowRed-card': { hole: 3, tee: 'yellowRed', url: '/audio/holes/hole-3-yellowRed-card.mp3', bytes: 38888, hash: '52fa66e1f6f9', voiceId: 'FGY2WhTYpPnrIDTdsKH5' },
  'hole-3-red-card': { hole: 3, tee: 'red', url: '/audio/holes/hole-3-red-card.mp3', bytes: 28126, hash: 'e3d2129b01f7', voiceId: 'FGY2WhTYpPnrIDTdsKH5' },
  'hole-4-blue-card': { hole: 4, tee: 'blue', url: '/audio/holes/hole-4-blue-card.mp3', bytes: 33559, hash: '34912d5f85d2', voiceId: 'IKne3meq5aSn9XLyUdCD' },
  'hole-4-white-card': { hole: 4, tee: 'white', url: '/audio/holes/hole-4-white-card.mp3', bytes: 34813, hash: '824d592ba0df', voiceId: 'IKne3meq5aSn9XLyUdCD' },
  'hole-4-whiteYellow-card': { hole: 4, tee: 'whiteYellow', url: '/audio/holes/hole-4-whiteYellow-card.mp3', bytes: 37425, hash: '0a572992d72d', voiceId: 'IKne3meq5aSn9XLyUdCD' },
  'hole-4-yellow-card': { hole: 4, tee: 'yellow', url: '/audio/holes/hole-4-yellow-card.mp3', bytes: 35545, hash: 'd4d5c8c333f4', voiceId: 'IKne3meq5aSn9XLyUdCD' },
  'hole-4-yellowRed-card': { hole: 4, tee: 'yellowRed', url: '/audio/holes/hole-4-yellowRed-card.mp3', bytes: 36694, hash: 'fa4402c30b45', voiceId: 'IKne3meq5aSn9XLyUdCD' },
  'hole-4-red-card': { hole: 4, tee: 'red', url: '/audio/holes/hole-4-red-card.mp3', bytes: 33559, hash: '28cfebd92288', voiceId: 'IKne3meq5aSn9XLyUdCD' },
  'hole-5-blue-card': { hole: 5, tee: 'blue', url: '/audio/holes/hole-5-blue-card.mp3', bytes: 34291, hash: '89e1bc9178a2', voiceId: 'XrExE9yKIg1WjnnlVkGX' },
  'hole-5-white-card': { hole: 5, tee: 'white', url: '/audio/holes/hole-5-white-card.mp3', bytes: 36380, hash: '6eb88867394c', voiceId: 'XrExE9yKIg1WjnnlVkGX' },
  'hole-5-whiteYellow-card': { hole: 5, tee: 'whiteYellow', url: '/audio/holes/hole-5-whiteYellow-card.mp3', bytes: 36171, hash: 'faa86df078e3', voiceId: 'XrExE9yKIg1WjnnlVkGX' },
  'hole-5-yellow-card': { hole: 5, tee: 'yellow', url: '/audio/holes/hole-5-yellow-card.mp3', bytes: 34813, hash: 'f236aed5e999', voiceId: 'XrExE9yKIg1WjnnlVkGX' },
  'hole-5-yellowRed-card': { hole: 5, tee: 'yellowRed', url: '/audio/holes/hole-5-yellowRed-card.mp3', bytes: 40769, hash: '2831b40f373b', voiceId: 'XrExE9yKIg1WjnnlVkGX' },
  'hole-5-red-card': { hole: 5, tee: 'red', url: '/audio/holes/hole-5-red-card.mp3', bytes: 33037, hash: '539740211c67', voiceId: 'XrExE9yKIg1WjnnlVkGX' },
  'hole-6-blue-card': { hole: 6, tee: 'blue', url: '/audio/holes/hole-6-blue-card.mp3', bytes: 33350, hash: '084ee3eafb3e', voiceId: 'bIHbv24MWmeRgasZH58o' },
  'hole-6-white-card': { hole: 6, tee: 'white', url: '/audio/holes/hole-6-white-card.mp3', bytes: 32619, hash: '481d27d67ab0', voiceId: 'bIHbv24MWmeRgasZH58o' },
  'hole-6-whiteYellow-card': { hole: 6, tee: 'whiteYellow', url: '/audio/holes/hole-6-whiteYellow-card.mp3', bytes: 40038, hash: 'f70d03ace681', voiceId: 'bIHbv24MWmeRgasZH58o' },
  'hole-6-yellow-card': { hole: 6, tee: 'yellow', url: '/audio/holes/hole-6-yellow-card.mp3', bytes: 35440, hash: '95d4922fcd9f', voiceId: 'bIHbv24MWmeRgasZH58o' },
  'hole-6-yellowRed-card': { hole: 6, tee: 'yellowRed', url: '/audio/holes/hole-6-yellowRed-card.mp3', bytes: 43590, hash: '45089d546cdb', voiceId: 'bIHbv24MWmeRgasZH58o' },
  'hole-6-red-card': { hole: 6, tee: 'red', url: '/audio/holes/hole-6-red-card.mp3', bytes: 33873, hash: 'a81a5187bce9', voiceId: 'bIHbv24MWmeRgasZH58o' },
  'hole-7-blue-card': { hole: 7, tee: 'blue', url: '/audio/holes/hole-7-blue-card.mp3', bytes: 37216, hash: 'c1f958666189', voiceId: 'pFZP5JQG7iQjIQuC4Bku' },
  'hole-7-white-card': { hole: 7, tee: 'white', url: '/audio/holes/hole-7-white-card.mp3', bytes: 37634, hash: '698ec4560684', voiceId: 'pFZP5JQG7iQjIQuC4Bku' },
  'hole-7-whiteYellow-card': { hole: 7, tee: 'whiteYellow', url: '/audio/holes/hole-7-whiteYellow-card.mp3', bytes: 40769, hash: '5d502c73ab5d', voiceId: 'pFZP5JQG7iQjIQuC4Bku' },
  'hole-7-yellow-card': { hole: 7, tee: 'yellow', url: '/audio/holes/hole-7-yellow-card.mp3', bytes: 38366, hash: 'aa80366594bc', voiceId: 'pFZP5JQG7iQjIQuC4Bku' },
  'hole-7-yellowRed-card': { hole: 7, tee: 'yellowRed', url: '/audio/holes/hole-7-yellowRed-card.mp3', bytes: 40038, hash: 'e671f69ec623', voiceId: 'pFZP5JQG7iQjIQuC4Bku' },
  'hole-7-red-card': { hole: 7, tee: 'red', url: '/audio/holes/hole-7-red-card.mp3', bytes: 33873, hash: '22c8254d2cbf', voiceId: 'pFZP5JQG7iQjIQuC4Bku' },
  'hole-8-blue-card': { hole: 8, tee: 'blue', url: '/audio/holes/hole-8-blue-card.mp3', bytes: 26349, hash: '80dd6ef7151e', voiceId: 'iP95p4xoKVk53GoZ742B' },
  'hole-8-white-card': { hole: 8, tee: 'white', url: '/audio/holes/hole-8-white-card.mp3', bytes: 24991, hash: 'bbed7fe789ea', voiceId: 'iP95p4xoKVk53GoZ742B' },
  'hole-8-whiteYellow-card': { hole: 8, tee: 'whiteYellow', url: '/audio/holes/hole-8-whiteYellow-card.mp3', bytes: 28753, hash: '67e3085929e4', voiceId: 'iP95p4xoKVk53GoZ742B' },
  'hole-8-yellow-card': { hole: 8, tee: 'yellow', url: '/audio/holes/hole-8-yellow-card.mp3', bytes: 27081, hash: 'a6814f5af978', voiceId: 'iP95p4xoKVk53GoZ742B' },
  'hole-8-yellowRed-card': { hole: 8, tee: 'yellowRed', url: '/audio/holes/hole-8-yellowRed-card.mp3', bytes: 32201, hash: 'da14f50515dc', voiceId: 'iP95p4xoKVk53GoZ742B' },
  'hole-8-red-card': { hole: 8, tee: 'red', url: '/audio/holes/hole-8-red-card.mp3', bytes: 26872, hash: '24ad9c1797a9', voiceId: 'iP95p4xoKVk53GoZ742B' },
  'hole-9-blue-card': { hole: 9, tee: 'blue', url: '/audio/holes/hole-9-blue-card.mp3', bytes: 25723, hash: 'bbdba0e73700', voiceId: '9BWtsMINqrJLrRacOk9x' },
  'hole-9-white-card': { hole: 9, tee: 'white', url: '/audio/holes/hole-9-white-card.mp3', bytes: 25409, hash: '18798ecbc364', voiceId: '9BWtsMINqrJLrRacOk9x' },
  'hole-9-whiteYellow-card': { hole: 9, tee: 'whiteYellow', url: '/audio/holes/hole-9-whiteYellow-card.mp3', bytes: 35545, hash: '798c19319133', voiceId: '9BWtsMINqrJLrRacOk9x' },
  'hole-9-yellow-card': { hole: 9, tee: 'yellow', url: '/audio/holes/hole-9-yellow-card.mp3', bytes: 26454, hash: 'ce3fda3f73b2', voiceId: '9BWtsMINqrJLrRacOk9x' },
  'hole-9-yellowRed-card': { hole: 9, tee: 'yellowRed', url: '/audio/holes/hole-9-yellowRed-card.mp3', bytes: 29275, hash: 'c4033147a3cd', voiceId: '9BWtsMINqrJLrRacOk9x' },
  'hole-9-red-card': { hole: 9, tee: 'red', url: '/audio/holes/hole-9-red-card.mp3', bytes: 27603, hash: '052551a11015', voiceId: '9BWtsMINqrJLrRacOk9x' },
  'hole-10-blue-card': { hole: 10, tee: 'blue', url: '/audio/holes/hole-10-blue-card.mp3', bytes: 38157, hash: '7fe21ebd7814', voiceId: 'N2lVS1w4EtoT3dr4eOWO' },
  'hole-10-white-card': { hole: 10, tee: 'white', url: '/audio/holes/hole-10-white-card.mp3', bytes: 37634, hash: 'eb0bb6ac6995', voiceId: 'N2lVS1w4EtoT3dr4eOWO' },
  'hole-10-whiteYellow-card': { hole: 10, tee: 'whiteYellow', url: '/audio/holes/hole-10-whiteYellow-card.mp3', bytes: 40456, hash: '7d8ef8b182f4', voiceId: 'N2lVS1w4EtoT3dr4eOWO' },
  'hole-10-yellow-card': { hole: 10, tee: 'yellow', url: '/audio/holes/hole-10-yellow-card.mp3', bytes: 34709, hash: '6964d532ff91', voiceId: 'N2lVS1w4EtoT3dr4eOWO' },
  'hole-10-yellowRed-card': { hole: 10, tee: 'yellowRed', url: '/audio/holes/hole-10-yellowRed-card.mp3', bytes: 39306, hash: 'ff92a0f47a29', voiceId: 'N2lVS1w4EtoT3dr4eOWO' },
  'hole-10-red-card': { hole: 10, tee: 'red', url: '/audio/holes/hole-10-red-card.mp3', bytes: 36380, hash: '56ee58b60f01', voiceId: 'N2lVS1w4EtoT3dr4eOWO' },
  'hole-11-blue-card': { hole: 11, tee: 'blue', url: '/audio/holes/hole-11-blue-card.mp3', bytes: 33141, hash: '0b361aa5e882', voiceId: 'Xb7hH8MSUJpSbSDYk0k2' },
  'hole-11-white-card': { hole: 11, tee: 'white', url: '/audio/holes/hole-11-white-card.mp3', bytes: 33768, hash: 'adf41ccf7610', voiceId: 'Xb7hH8MSUJpSbSDYk0k2' },
  'hole-11-whiteYellow-card': { hole: 11, tee: 'whiteYellow', url: '/audio/holes/hole-11-whiteYellow-card.mp3', bytes: 36380, hash: 'e8de92e7c5b1', voiceId: 'Xb7hH8MSUJpSbSDYk0k2' },
  'hole-11-yellow-card': { hole: 11, tee: 'yellow', url: '/audio/holes/hole-11-yellow-card.mp3', bytes: 34709, hash: '7f819b2038fe', voiceId: 'Xb7hH8MSUJpSbSDYk0k2' },
  'hole-11-yellowRed-card': { hole: 11, tee: 'yellowRed', url: '/audio/holes/hole-11-yellowRed-card.mp3', bytes: 35440, hash: '78a14470df29', voiceId: 'Xb7hH8MSUJpSbSDYk0k2' },
  'hole-11-red-card': { hole: 11, tee: 'red', url: '/audio/holes/hole-11-red-card.mp3', bytes: 30529, hash: '350be1f5e613', voiceId: 'Xb7hH8MSUJpSbSDYk0k2' },
  'hole-12-blue-card': { hole: 12, tee: 'blue', url: '/audio/holes/hole-12-blue-card.mp3', bytes: 29484, hash: 'a5d782558912', voiceId: 'CwhRBWXzGAHq8TQ4Fs17' },
  'hole-12-white-card': { hole: 12, tee: 'white', url: '/audio/holes/hole-12-white-card.mp3', bytes: 30216, hash: '2b996407ecfb', voiceId: 'CwhRBWXzGAHq8TQ4Fs17' },
  'hole-12-whiteYellow-card': { hole: 12, tee: 'whiteYellow', url: '/audio/holes/hole-12-whiteYellow-card.mp3', bytes: 31156, hash: '160eb7561141', voiceId: 'CwhRBWXzGAHq8TQ4Fs17' },
  'hole-12-yellow-card': { hole: 12, tee: 'yellow', url: '/audio/holes/hole-12-yellow-card.mp3', bytes: 36171, hash: '48d1124a6ac9', voiceId: 'CwhRBWXzGAHq8TQ4Fs17' },
  'hole-12-yellowRed-card': { hole: 12, tee: 'yellowRed', url: '/audio/holes/hole-12-yellowRed-card.mp3', bytes: 37112, hash: 'bf8026d66ecf', voiceId: 'CwhRBWXzGAHq8TQ4Fs17' },
  'hole-12-red-card': { hole: 12, tee: 'red', url: '/audio/holes/hole-12-red-card.mp3', bytes: 30947, hash: '04e90f15d0ab', voiceId: 'CwhRBWXzGAHq8TQ4Fs17' },
  'hole-13-blue-card': { hole: 13, tee: 'blue', url: '/audio/holes/hole-13-blue-card.mp3', bytes: 33141, hash: '47cbf768df7f', voiceId: 'EXAVITQu4vr4xnSDxMaL' },
  'hole-13-white-card': { hole: 13, tee: 'white', url: '/audio/holes/hole-13-white-card.mp3', bytes: 32410, hash: 'b5b893e9f2f9', voiceId: 'EXAVITQu4vr4xnSDxMaL' },
  'hole-13-whiteYellow-card': { hole: 13, tee: 'whiteYellow', url: '/audio/holes/hole-13-whiteYellow-card.mp3', bytes: 33768, hash: 'bd0902dd8ded', voiceId: 'EXAVITQu4vr4xnSDxMaL' },
  'hole-13-yellow-card': { hole: 13, tee: 'yellow', url: '/audio/holes/hole-13-yellow-card.mp3', bytes: 31887, hash: '59018d2b52c6', voiceId: 'EXAVITQu4vr4xnSDxMaL' },
  'hole-13-yellowRed-card': { hole: 13, tee: 'yellowRed', url: '/audio/holes/hole-13-yellowRed-card.mp3', bytes: 35440, hash: '4b2f863eced0', voiceId: 'EXAVITQu4vr4xnSDxMaL' },
  'hole-13-red-card': { hole: 13, tee: 'red', url: '/audio/holes/hole-13-red-card.mp3', bytes: 31469, hash: 'bccd7f3ced6b', voiceId: 'EXAVITQu4vr4xnSDxMaL' },
  'hole-14-blue-card': { hole: 14, tee: 'blue', url: '/audio/holes/hole-14-blue-card.mp3', bytes: 25200, hash: '39638791647a', voiceId: 'cjVigY5qzO86Huf0OWal' },
  'hole-14-white-card': { hole: 14, tee: 'white', url: '/audio/holes/hole-14-white-card.mp3', bytes: 25723, hash: '84baf54624a9', voiceId: 'cjVigY5qzO86Huf0OWal' },
  'hole-14-whiteYellow-card': { hole: 14, tee: 'whiteYellow', url: '/audio/holes/hole-14-whiteYellow-card.mp3', bytes: 27603, hash: '38b83242d2ed', voiceId: 'cjVigY5qzO86Huf0OWal' },
  'hole-14-yellow-card': { hole: 14, tee: 'yellow', url: '/audio/holes/hole-14-yellow-card.mp3', bytes: 26140, hash: 'f87f9e41840a', voiceId: 'cjVigY5qzO86Huf0OWal' },
  'hole-14-yellowRed-card': { hole: 14, tee: 'yellowRed', url: '/audio/holes/hole-14-yellowRed-card.mp3', bytes: 27081, hash: '9007a8e7d08d', voiceId: 'cjVigY5qzO86Huf0OWal' },
  'hole-14-red-card': { hole: 14, tee: 'red', url: '/audio/holes/hole-14-red-card.mp3', bytes: 24678, hash: '72372d76cf6d', voiceId: 'cjVigY5qzO86Huf0OWal' },
  'hole-15-blue-card': { hole: 15, tee: 'blue', url: '/audio/holes/hole-15-blue-card.mp3', bytes: 32619, hash: '8616de5a3b3d', voiceId: 'XB0fDUnXU5powFXDhCwa' },
  'hole-15-white-card': { hole: 15, tee: 'white', url: '/audio/holes/hole-15-white-card.mp3', bytes: 32201, hash: '9c5c8f53d211', voiceId: 'XB0fDUnXU5powFXDhCwa' },
  'hole-15-whiteYellow-card': { hole: 15, tee: 'whiteYellow', url: '/audio/holes/hole-15-whiteYellow-card.mp3', bytes: 39097, hash: '31cb39efb23a', voiceId: 'XB0fDUnXU5powFXDhCwa' },
  'hole-15-yellow-card': { hole: 15, tee: 'yellow', url: '/audio/holes/hole-15-yellow-card.mp3', bytes: 33350, hash: 'd011e41df41e', voiceId: 'XB0fDUnXU5powFXDhCwa' },
  'hole-15-yellowRed-card': { hole: 15, tee: 'yellowRed', url: '/audio/holes/hole-15-yellowRed-card.mp3', bytes: 36171, hash: 'c003c0bf30fe', voiceId: 'XB0fDUnXU5powFXDhCwa' },
  'hole-15-red-card': { hole: 15, tee: 'red', url: '/audio/holes/hole-15-red-card.mp3', bytes: 40769, hash: '1e24bc6f3527', voiceId: 'XB0fDUnXU5powFXDhCwa' },
  'hole-16-blue-card': { hole: 16, tee: 'blue', url: '/audio/holes/hole-16-blue-card.mp3', bytes: 28544, hash: 'de6d73dd0197', voiceId: 'SAz9YHcvj6GT2YYXdXww' },
  'hole-16-white-card': { hole: 16, tee: 'white', url: '/audio/holes/hole-16-white-card.mp3', bytes: 29693, hash: '74be47323fe0', voiceId: 'SAz9YHcvj6GT2YYXdXww' },
  'hole-16-whiteYellow-card': { hole: 16, tee: 'whiteYellow', url: '/audio/holes/hole-16-whiteYellow-card.mp3', bytes: 32828, hash: 'f330bbb6ff2d', voiceId: 'SAz9YHcvj6GT2YYXdXww' },
  'hole-16-yellow-card': { hole: 16, tee: 'yellow', url: '/audio/holes/hole-16-yellow-card.mp3', bytes: 31156, hash: '31b204240b44', voiceId: 'SAz9YHcvj6GT2YYXdXww' },
  'hole-16-yellowRed-card': { hole: 16, tee: 'yellowRed', url: '/audio/holes/hole-16-yellowRed-card.mp3', bytes: 30216, hash: '03cc4ba18ed6', voiceId: 'SAz9YHcvj6GT2YYXdXww' },
  'hole-16-red-card': { hole: 16, tee: 'red', url: '/audio/holes/hole-16-red-card.mp3', bytes: 27394, hash: 'ff4892636683', voiceId: 'SAz9YHcvj6GT2YYXdXww' },
  'hole-17-blue-card': { hole: 17, tee: 'blue', url: '/audio/holes/hole-17-blue-card.mp3', bytes: 43172, hash: '1f686e02a282', voiceId: 'onwK4e9ZLuTAKqWW03F9' },
  'hole-17-white-card': { hole: 17, tee: 'white', url: '/audio/holes/hole-17-white-card.mp3', bytes: 42859, hash: 'a781c010bb26', voiceId: 'onwK4e9ZLuTAKqWW03F9' },
  'hole-17-whiteYellow-card': { hole: 17, tee: 'whiteYellow', url: '/audio/holes/hole-17-whiteYellow-card.mp3', bytes: 47143, hash: '4456fbb46089', voiceId: 'onwK4e9ZLuTAKqWW03F9' },
  'hole-17-yellow-card': { hole: 17, tee: 'yellow', url: '/audio/holes/hole-17-yellow-card.mp3', bytes: 44322, hash: '39d4dd866988', voiceId: 'onwK4e9ZLuTAKqWW03F9' },
  'hole-17-yellowRed-card': { hole: 17, tee: 'yellowRed', url: '/audio/holes/hole-17-yellowRed-card.mp3', bytes: 43068, hash: '0cc29e497095', voiceId: 'onwK4e9ZLuTAKqWW03F9' },
  'hole-17-red-card': { hole: 17, tee: 'red', url: '/audio/holes/hole-17-red-card.mp3', bytes: 43068, hash: 'a6cf10a177db', voiceId: 'onwK4e9ZLuTAKqWW03F9' },
  'hole-18-blue-card': { hole: 18, tee: 'blue', url: '/audio/holes/hole-18-blue-card.mp3', bytes: 32096, hash: '082cffd1661a', voiceId: 'JBFqnCBsd6RMkjVDRZzb' },
  'hole-18-white-card': { hole: 18, tee: 'white', url: '/audio/holes/hole-18-white-card.mp3', bytes: 34291, hash: 'fee3db56a7d2', voiceId: 'JBFqnCBsd6RMkjVDRZzb' },
  'hole-18-whiteYellow-card': { hole: 18, tee: 'whiteYellow', url: '/audio/holes/hole-18-whiteYellow-card.mp3', bytes: 35754, hash: '5705eb4d1cdc', voiceId: 'JBFqnCBsd6RMkjVDRZzb' },
  'hole-18-yellow-card': { hole: 18, tee: 'yellow', url: '/audio/holes/hole-18-yellow-card.mp3', bytes: 33350, hash: '348197e9a12f', voiceId: 'JBFqnCBsd6RMkjVDRZzb' },
  'hole-18-yellowRed-card': { hole: 18, tee: 'yellowRed', url: '/audio/holes/hole-18-yellowRed-card.mp3', bytes: 35754, hash: '9315dc91e24d', voiceId: 'JBFqnCBsd6RMkjVDRZzb' },
  'hole-18-red-card': { hole: 18, tee: 'red', url: '/audio/holes/hole-18-red-card.mp3', bytes: 31678, hash: '220e9c7185dc', voiceId: 'JBFqnCBsd6RMkjVDRZzb' },
};

/** 여섯 티가 공유하는 클럽 해설. */
export const NARRATION_DESCRIPTIONS: Record<string, NarrationClip> = {
  'hole-1-desc': { hole: 1, url: '/audio/holes/hole-1-desc.mp3', bytes: 66787, hash: '5b8f55212c23', voiceId: 'cgSgspJ2msm6clMCkdW9' },
  'hole-2-desc': { hole: 2, url: '/audio/holes/hole-2-desc.mp3', bytes: 19035, hash: 'ea9ee7c1c44a', voiceId: 'TX3LPaxmHKxFdv7VOQHJ' },
  'hole-3-desc': { hole: 3, url: '/audio/holes/hole-3-desc.mp3', bytes: 60309, hash: 'b385086caaed', voiceId: 'FGY2WhTYpPnrIDTdsKH5' },
  'hole-4-desc': { hole: 4, url: '/audio/holes/hole-4-desc.mp3', bytes: 60309, hash: 'ed19d9f6a2b9', voiceId: 'IKne3meq5aSn9XLyUdCD' },
  'hole-5-desc': { hole: 5, url: '/audio/holes/hole-5-desc.mp3', bytes: 77758, hash: 'e6c968586681', voiceId: 'XrExE9yKIg1WjnnlVkGX' },
  'hole-6-desc': { hole: 6, url: '/audio/holes/hole-6-desc.mp3', bytes: 57696, hash: '7846c161d67b', voiceId: 'bIHbv24MWmeRgasZH58o' },
  'hole-7-desc': { hole: 7, url: '/audio/holes/hole-7-desc.mp3', bytes: 53935, hash: '8dc7878552f5', voiceId: 'pFZP5JQG7iQjIQuC4Bku' },
  'hole-8-desc': { hole: 8, url: '/audio/holes/hole-8-desc.mp3', bytes: 45785, hash: '826581bbbdec', voiceId: 'iP95p4xoKVk53GoZ742B' },
  'hole-9-desc': { hole: 9, url: '/audio/holes/hole-9-desc.mp3', bytes: 54353, hash: '82ec0ba16064', voiceId: '9BWtsMINqrJLrRacOk9x' },
  'hole-10-desc': { hole: 10, url: '/audio/holes/hole-10-desc.mp3', bytes: 67309, hash: '593b505daefc', voiceId: 'N2lVS1w4EtoT3dr4eOWO' },
  'hole-11-desc': { hole: 11, url: '/audio/holes/hole-11-desc.mp3', bytes: 66265, hash: 'f2f775076761', voiceId: 'Xb7hH8MSUJpSbSDYk0k2' },
  'hole-12-desc': { hole: 12, url: '/audio/holes/hole-12-desc.mp3', bytes: 65638, hash: '7c729d4f9484', voiceId: 'CwhRBWXzGAHq8TQ4Fs17' },
  'hole-13-desc': { hole: 13, url: '/audio/holes/hole-13-desc.mp3', bytes: 57905, hash: 'f4aa175a15a4', voiceId: 'EXAVITQu4vr4xnSDxMaL' },
  'hole-14-desc': { hole: 14, url: '/audio/holes/hole-14-desc.mp3', bytes: 72952, hash: '364c408c375d', voiceId: 'cjVigY5qzO86Huf0OWal' },
  'hole-15-desc': { hole: 15, url: '/audio/holes/hole-15-desc.mp3', bytes: 67727, hash: 'c94cc883a353', voiceId: 'XB0fDUnXU5powFXDhCwa' },
  'hole-16-desc': { hole: 16, url: '/audio/holes/hole-16-desc.mp3', bytes: 47874, hash: 'deb7d5a8d378', voiceId: 'SAz9YHcvj6GT2YYXdXww' },
  'hole-17-desc': { hole: 17, url: '/audio/holes/hole-17-desc.mp3', bytes: 105762, hash: 'da952c0507dc', voiceId: 'onwK4e9ZLuTAKqWW03F9' },
  'hole-18-desc': { hole: 18, url: '/audio/holes/hole-18-desc.mp3', bytes: 73683, hash: '2a27cb17acea', voiceId: 'JBFqnCBsd6RMkjVDRZzb' },
};

/** 미리 받기 화면이 "약 N MB"를 계산할 때 씁니다. */
export const NARRATION_AUDIO_TOTAL_BYTES = 4792812;

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
  const card = NARRATION_CARDS[`hole-${holeNumber}-${teeSet}-card`];
  const description = NARRATION_DESCRIPTIONS[`hole-${holeNumber}-desc`];
  return card && description ? [card, description] : [];
};
