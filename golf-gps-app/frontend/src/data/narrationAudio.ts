// 자동 생성 파일입니다. 직접 고치지 마세요.
// 다시 만들기: node scripts/generate-narration.mjs
//
// scripts/generate-narration.mjs 가 ElevenLabs로 구운 홀 나레이션 목록입니다.
// mp3는 frontend/public/audio/holes/ 에 있고, 서비스 워커가 여기 적힌 url을
// 캐시합니다.
//
// 한 홀의 나레이션은 클립 두 개입니다. 앞은 티마다 다른 카드 문장(108개),
// 뒤는 여섯 티가 공유하는 클럽 해설(18개)입니다. 같은 음성·같은 설정으로 구워
// 이어 붙이므로 한 사람이 쭉 읽는 것처럼 들립니다.
//
// hash는 그 클립이 실제로 읽는 문장 + 음성 + 모델 + 포맷의 지문입니다. 해설을
// 고치면 해설 클립 하나만 해시가 달라지고, 카드 클립 여섯 개는 그대로 남습니다.

import type { TeeSet } from '@/data/pelhamHillsBook';

export interface NarrationClip {
  hole: number;
  /** 앱 루트 기준 절대 경로. 서비스 워커 규칙이 이 접두사로 매칭합니다. */
  url: string;
  bytes: number;
  hash: string;
}

export interface NarrationCardClip extends NarrationClip {
  tee: TeeSet;
}

/** 음성을 다시 고를 때 무엇으로 구웠는지 남겨 둡니다. */
export const NARRATION_VOICE = {
  voiceId: 'JBFqnCBsd6RMkjVDRZzb',
  modelId: 'eleven_multilingual_v2',
  outputFormat: 'mp3_22050_32',
  speed: 0.95,
} as const;

/** 서비스 워커의 CacheFirst 규칙(vite.config.ts)과 맞춰 두세요. */
export const NARRATION_AUDIO_PREFIX = '/audio/holes/';

/** 나레이션 전용 런타임 캐시 이름. vite.config.ts의 cacheName과 같아야 합니다. */
export const NARRATION_CACHE_NAME = 'narration-cache';

/** 티마다 다른 카드 문장. */
export const NARRATION_CARDS: Record<string, NarrationCardClip> = {
  'hole-1-blue-card': { hole: 1, tee: 'blue', url: '/audio/holes/hole-1-blue-card.mp3', bytes: 35754, hash: 'b248263c5c18' },
  'hole-1-white-card': { hole: 1, tee: 'white', url: '/audio/holes/hole-1-white-card.mp3', bytes: 33768, hash: '4ff3288ecfac' },
  'hole-1-whiteYellow-card': { hole: 1, tee: 'whiteYellow', url: '/audio/holes/hole-1-whiteYellow-card.mp3', bytes: 34500, hash: '27b9e3adec8b' },
  'hole-1-yellow-card': { hole: 1, tee: 'yellow', url: '/audio/holes/hole-1-yellow-card.mp3', bytes: 33350, hash: '6ce04a3dd517' },
  'hole-1-yellowRed-card': { hole: 1, tee: 'yellowRed', url: '/audio/holes/hole-1-yellowRed-card.mp3', bytes: 37112, hash: '746fce5f3c5e' },
  'hole-1-red-card': { hole: 1, tee: 'red', url: '/audio/holes/hole-1-red-card.mp3', bytes: 31887, hash: '4da7a58b3004' },
  'hole-2-blue-card': { hole: 2, tee: 'blue', url: '/audio/holes/hole-2-blue-card.mp3', bytes: 31887, hash: '1621c8367806' },
  'hole-2-white-card': { hole: 2, tee: 'white', url: '/audio/holes/hole-2-white-card.mp3', bytes: 35022, hash: '8626d606511a' },
  'hole-2-whiteYellow-card': { hole: 2, tee: 'whiteYellow', url: '/audio/holes/hole-2-whiteYellow-card.mp3', bytes: 36380, hash: '382327f9a2b4' },
  'hole-2-yellow-card': { hole: 2, tee: 'yellow', url: '/audio/holes/hole-2-yellow-card.mp3', bytes: 35022, hash: '830c402d019e' },
  'hole-2-yellowRed-card': { hole: 2, tee: 'yellowRed', url: '/audio/holes/hole-2-yellowRed-card.mp3', bytes: 37425, hash: 'b7e27f44fc45' },
  'hole-2-red-card': { hole: 2, tee: 'red', url: '/audio/holes/hole-2-red-card.mp3', bytes: 33141, hash: '9ece5377621c' },
  'hole-3-blue-card': { hole: 3, tee: 'blue', url: '/audio/holes/hole-3-blue-card.mp3', bytes: 35440, hash: '2ef989600044' },
  'hole-3-white-card': { hole: 3, tee: 'white', url: '/audio/holes/hole-3-white-card.mp3', bytes: 36694, hash: '8874ee3997b8' },
  'hole-3-whiteYellow-card': { hole: 3, tee: 'whiteYellow', url: '/audio/holes/hole-3-whiteYellow-card.mp3', bytes: 37112, hash: '38c9b04e5d39' },
  'hole-3-yellow-card': { hole: 3, tee: 'yellow', url: '/audio/holes/hole-3-yellow-card.mp3', bytes: 33559, hash: '8d55109a09a0' },
  'hole-3-yellowRed-card': { hole: 3, tee: 'yellowRed', url: '/audio/holes/hole-3-yellowRed-card.mp3', bytes: 35754, hash: 'ddc3a033ab68' },
  'hole-3-red-card': { hole: 3, tee: 'red', url: '/audio/holes/hole-3-red-card.mp3', bytes: 34709, hash: '77545a3a119c' },
  'hole-4-blue-card': { hole: 4, tee: 'blue', url: '/audio/holes/hole-4-blue-card.mp3', bytes: 34082, hash: 'e7a203707826' },
  'hole-4-white-card': { hole: 4, tee: 'white', url: '/audio/holes/hole-4-white-card.mp3', bytes: 34709, hash: 'c3986160aa95' },
  'hole-4-whiteYellow-card': { hole: 4, tee: 'whiteYellow', url: '/audio/holes/hole-4-whiteYellow-card.mp3', bytes: 37425, hash: '377992574d06' },
  'hole-4-yellow-card': { hole: 4, tee: 'yellow', url: '/audio/holes/hole-4-yellow-card.mp3', bytes: 32828, hash: '67da937224d0' },
  'hole-4-yellowRed-card': { hole: 4, tee: 'yellowRed', url: '/audio/holes/hole-4-yellowRed-card.mp3', bytes: 38575, hash: '97549c8a8bec' },
  'hole-4-red-card': { hole: 4, tee: 'red', url: '/audio/holes/hole-4-red-card.mp3', bytes: 34709, hash: 'bc4cdce1f693' },
  'hole-5-blue-card': { hole: 5, tee: 'blue', url: '/audio/holes/hole-5-blue-card.mp3', bytes: 34291, hash: 'e4870fe88333' },
  'hole-5-white-card': { hole: 5, tee: 'white', url: '/audio/holes/hole-5-white-card.mp3', bytes: 35963, hash: '85e342c53035' },
  'hole-5-whiteYellow-card': { hole: 5, tee: 'whiteYellow', url: '/audio/holes/hole-5-whiteYellow-card.mp3', bytes: 37843, hash: '995cc680b9ca' },
  'hole-5-yellow-card': { hole: 5, tee: 'yellow', url: '/audio/holes/hole-5-yellow-card.mp3', bytes: 34291, hash: 'b77cbef82f72' },
  'hole-5-yellowRed-card': { hole: 5, tee: 'yellowRed', url: '/audio/holes/hole-5-yellowRed-card.mp3', bytes: 38784, hash: 'bf2031832238' },
  'hole-5-red-card': { hole: 5, tee: 'red', url: '/audio/holes/hole-5-red-card.mp3', bytes: 35022, hash: '0b24966cf525' },
  'hole-6-blue-card': { hole: 6, tee: 'blue', url: '/audio/holes/hole-6-blue-card.mp3', bytes: 35963, hash: '2fe56f9c039b' },
  'hole-6-white-card': { hole: 6, tee: 'white', url: '/audio/holes/hole-6-white-card.mp3', bytes: 35022, hash: '55e2f0605329' },
  'hole-6-whiteYellow-card': { hole: 6, tee: 'whiteYellow', url: '/audio/holes/hole-6-whiteYellow-card.mp3', bytes: 36694, hash: '0daf57eee72b' },
  'hole-6-yellow-card': { hole: 6, tee: 'yellow', url: '/audio/holes/hole-6-yellow-card.mp3', bytes: 32619, hash: '047788e2b472' },
  'hole-6-yellowRed-card': { hole: 6, tee: 'yellowRed', url: '/audio/holes/hole-6-yellowRed-card.mp3', bytes: 37216, hash: 'dbc82cee1646' },
  'hole-6-red-card': { hole: 6, tee: 'red', url: '/audio/holes/hole-6-red-card.mp3', bytes: 32828, hash: 'e23eb3543fa0' },
  'hole-7-blue-card': { hole: 7, tee: 'blue', url: '/audio/holes/hole-7-blue-card.mp3', bytes: 36380, hash: '69d8d9aa8050' },
  'hole-7-white-card': { hole: 7, tee: 'white', url: '/audio/holes/hole-7-white-card.mp3', bytes: 32828, hash: '2b70f116bc74' },
  'hole-7-whiteYellow-card': { hole: 7, tee: 'whiteYellow', url: '/audio/holes/hole-7-whiteYellow-card.mp3', bytes: 36694, hash: '7ca96463812e' },
  'hole-7-yellow-card': { hole: 7, tee: 'yellow', url: '/audio/holes/hole-7-yellow-card.mp3', bytes: 37216, hash: 'ba6e95749686' },
  'hole-7-yellowRed-card': { hole: 7, tee: 'yellowRed', url: '/audio/holes/hole-7-yellowRed-card.mp3', bytes: 34500, hash: '2319937858a7' },
  'hole-7-red-card': { hole: 7, tee: 'red', url: '/audio/holes/hole-7-red-card.mp3', bytes: 32410, hash: 'a317b326e48c' },
  'hole-8-blue-card': { hole: 8, tee: 'blue', url: '/audio/holes/hole-8-blue-card.mp3', bytes: 33873, hash: '45c13aa70c35' },
  'hole-8-white-card': { hole: 8, tee: 'white', url: '/audio/holes/hole-8-white-card.mp3', bytes: 34813, hash: 'c12a8f88295d' },
  'hole-8-whiteYellow-card': { hole: 8, tee: 'whiteYellow', url: '/audio/holes/hole-8-whiteYellow-card.mp3', bytes: 37425, hash: '50ff1eca2e85' },
  'hole-8-yellow-card': { hole: 8, tee: 'yellow', url: '/audio/holes/hole-8-yellow-card.mp3', bytes: 33873, hash: 'e5a53723aea5' },
  'hole-8-yellowRed-card': { hole: 8, tee: 'yellowRed', url: '/audio/holes/hole-8-yellowRed-card.mp3', bytes: 39306, hash: '9660ac0d1254' },
  'hole-8-red-card': { hole: 8, tee: 'red', url: '/audio/holes/hole-8-red-card.mp3', bytes: 32619, hash: '2a5973368429' },
  'hole-9-blue-card': { hole: 9, tee: 'blue', url: '/audio/holes/hole-9-blue-card.mp3', bytes: 33141, hash: '70ed32dfcca0' },
  'hole-9-white-card': { hole: 9, tee: 'white', url: '/audio/holes/hole-9-white-card.mp3', bytes: 36485, hash: '73ef5e6dd17d' },
  'hole-9-whiteYellow-card': { hole: 9, tee: 'whiteYellow', url: '/audio/holes/hole-9-whiteYellow-card.mp3', bytes: 36485, hash: '122966580c82' },
  'hole-9-yellow-card': { hole: 9, tee: 'yellow', url: '/audio/holes/hole-9-yellow-card.mp3', bytes: 36171, hash: 'e3dd25550a99' },
  'hole-9-yellowRed-card': { hole: 9, tee: 'yellowRed', url: '/audio/holes/hole-9-yellowRed-card.mp3', bytes: 37843, hash: '7d80d252f2b9' },
  'hole-9-red-card': { hole: 9, tee: 'red', url: '/audio/holes/hole-9-red-card.mp3', bytes: 33873, hash: '785e3e2b2bf4' },
  'hole-10-blue-card': { hole: 10, tee: 'blue', url: '/audio/holes/hole-10-blue-card.mp3', bytes: 32828, hash: '0960cb95dda1' },
  'hole-10-white-card': { hole: 10, tee: 'white', url: '/audio/holes/hole-10-white-card.mp3', bytes: 32410, hash: 'd64b94c55a55' },
  'hole-10-whiteYellow-card': { hole: 10, tee: 'whiteYellow', url: '/audio/holes/hole-10-whiteYellow-card.mp3', bytes: 34082, hash: '813ab492e1d6' },
  'hole-10-yellow-card': { hole: 10, tee: 'yellow', url: '/audio/holes/hole-10-yellow-card.mp3', bytes: 35231, hash: 'd0fed020b0b1' },
  'hole-10-yellowRed-card': { hole: 10, tee: 'yellowRed', url: '/audio/holes/hole-10-yellowRed-card.mp3', bytes: 32410, hash: 'aa34e769cbe0' },
  'hole-10-red-card': { hole: 10, tee: 'red', url: '/audio/holes/hole-10-red-card.mp3', bytes: 30529, hash: '5a2b286e5938' },
  'hole-11-blue-card': { hole: 11, tee: 'blue', url: '/audio/holes/hole-11-blue-card.mp3', bytes: 33350, hash: '00c0399732a4' },
  'hole-11-white-card': { hole: 11, tee: 'white', url: '/audio/holes/hole-11-white-card.mp3', bytes: 34291, hash: '97aad7f96f5d' },
  'hole-11-whiteYellow-card': { hole: 11, tee: 'whiteYellow', url: '/audio/holes/hole-11-whiteYellow-card.mp3', bytes: 38052, hash: 'f82abae9301e' },
  'hole-11-yellow-card': { hole: 11, tee: 'yellow', url: '/audio/holes/hole-11-yellow-card.mp3', bytes: 33768, hash: '25a4f305942a' },
  'hole-11-yellowRed-card': { hole: 11, tee: 'yellowRed', url: '/audio/holes/hole-11-yellowRed-card.mp3', bytes: 35754, hash: '2790d3c5f6cf' },
  'hole-11-red-card': { hole: 11, tee: 'red', url: '/audio/holes/hole-11-red-card.mp3', bytes: 31469, hash: 'f53ff27c5ee9' },
  'hole-12-blue-card': { hole: 12, tee: 'blue', url: '/audio/holes/hole-12-blue-card.mp3', bytes: 32828, hash: '569bef8a5455' },
  'hole-12-white-card': { hole: 12, tee: 'white', url: '/audio/holes/hole-12-white-card.mp3', bytes: 35022, hash: 'fb3f4ad84e98' },
  'hole-12-whiteYellow-card': { hole: 12, tee: 'whiteYellow', url: '/audio/holes/hole-12-whiteYellow-card.mp3', bytes: 37634, hash: 'a8aea95b25dc' },
  'hole-12-yellow-card': { hole: 12, tee: 'yellow', url: '/audio/holes/hole-12-yellow-card.mp3', bytes: 33768, hash: 'fafb4461efa5' },
  'hole-12-yellowRed-card': { hole: 12, tee: 'yellowRed', url: '/audio/holes/hole-12-yellowRed-card.mp3', bytes: 37112, hash: 'e5d743e83a4a' },
  'hole-12-red-card': { hole: 12, tee: 'red', url: '/audio/holes/hole-12-red-card.mp3', bytes: 32619, hash: '23f05856a48a' },
  'hole-13-blue-card': { hole: 13, tee: 'blue', url: '/audio/holes/hole-13-blue-card.mp3', bytes: 36485, hash: '8d261b20e473' },
  'hole-13-white-card': { hole: 13, tee: 'white', url: '/audio/holes/hole-13-white-card.mp3', bytes: 35440, hash: 'ca0869802d90' },
  'hole-13-whiteYellow-card': { hole: 13, tee: 'whiteYellow', url: '/audio/holes/hole-13-whiteYellow-card.mp3', bytes: 34082, hash: 'a1f1bbe3ef81' },
  'hole-13-yellow-card': { hole: 13, tee: 'yellow', url: '/audio/holes/hole-13-yellow-card.mp3', bytes: 33350, hash: '6cb4a3d8202a' },
  'hole-13-yellowRed-card': { hole: 13, tee: 'yellowRed', url: '/audio/holes/hole-13-yellowRed-card.mp3', bytes: 38052, hash: '1e7e10b0a49a' },
  'hole-13-red-card': { hole: 13, tee: 'red', url: '/audio/holes/hole-13-red-card.mp3', bytes: 36485, hash: 'ab45daf68b1d' },
  'hole-14-blue-card': { hole: 14, tee: 'blue', url: '/audio/holes/hole-14-blue-card.mp3', bytes: 32201, hash: 'bf5a3604ed77' },
  'hole-14-white-card': { hole: 14, tee: 'white', url: '/audio/holes/hole-14-white-card.mp3', bytes: 32828, hash: '6e533f5aa3c7' },
  'hole-14-whiteYellow-card': { hole: 14, tee: 'whiteYellow', url: '/audio/holes/hole-14-whiteYellow-card.mp3', bytes: 37216, hash: '41aed61078bf' },
  'hole-14-yellow-card': { hole: 14, tee: 'yellow', url: '/audio/holes/hole-14-yellow-card.mp3', bytes: 35963, hash: '642cd7fcf4fe' },
  'hole-14-yellowRed-card': { hole: 14, tee: 'yellowRed', url: '/audio/holes/hole-14-yellowRed-card.mp3', bytes: 37843, hash: 'f614487900b9' },
  'hole-14-red-card': { hole: 14, tee: 'red', url: '/audio/holes/hole-14-red-card.mp3', bytes: 33873, hash: 'c9946fa08818' },
  'hole-15-blue-card': { hole: 15, tee: 'blue', url: '/audio/holes/hole-15-blue-card.mp3', bytes: 33141, hash: '3601e1a3ac1a' },
  'hole-15-white-card': { hole: 15, tee: 'white', url: '/audio/holes/hole-15-white-card.mp3', bytes: 34082, hash: '7cb8bf743a81' },
  'hole-15-whiteYellow-card': { hole: 15, tee: 'whiteYellow', url: '/audio/holes/hole-15-whiteYellow-card.mp3', bytes: 38052, hash: 'cc833f0a7582' },
  'hole-15-yellow-card': { hole: 15, tee: 'yellow', url: '/audio/holes/hole-15-yellow-card.mp3', bytes: 33037, hash: 'f4389ed59088' },
  'hole-15-yellowRed-card': { hole: 15, tee: 'yellowRed', url: '/audio/holes/hole-15-yellowRed-card.mp3', bytes: 38784, hash: 'f307b0ae49c2' },
  'hole-15-red-card': { hole: 15, tee: 'red', url: '/audio/holes/hole-15-red-card.mp3', bytes: 33873, hash: '373c286a76d8' },
  'hole-16-blue-card': { hole: 16, tee: 'blue', url: '/audio/holes/hole-16-blue-card.mp3', bytes: 34291, hash: '2ec3b3d5d5bf' },
  'hole-16-white-card': { hole: 16, tee: 'white', url: '/audio/holes/hole-16-white-card.mp3', bytes: 35022, hash: 'ecf7505cff1d' },
  'hole-16-whiteYellow-card': { hole: 16, tee: 'whiteYellow', url: '/audio/holes/hole-16-whiteYellow-card.mp3', bytes: 41500, hash: 'c8108c45c98f' },
  'hole-16-yellow-card': { hole: 16, tee: 'yellow', url: '/audio/holes/hole-16-yellow-card.mp3', bytes: 34813, hash: '0cecee6073cd' },
  'hole-16-yellowRed-card': { hole: 16, tee: 'yellowRed', url: '/audio/holes/hole-16-yellowRed-card.mp3', bytes: 37216, hash: '3b3c8faea0a9' },
  'hole-16-red-card': { hole: 16, tee: 'red', url: '/audio/holes/hole-16-red-card.mp3', bytes: 34813, hash: 'd9b1d9892447' },
  'hole-17-blue-card': { hole: 17, tee: 'blue', url: '/audio/holes/hole-17-blue-card.mp3', bytes: 35545, hash: 'ece87a4ffc39' },
  'hole-17-white-card': { hole: 17, tee: 'white', url: '/audio/holes/hole-17-white-card.mp3', bytes: 36380, hash: 'ee217bbab531' },
  'hole-17-whiteYellow-card': { hole: 17, tee: 'whiteYellow', url: '/audio/holes/hole-17-whiteYellow-card.mp3', bytes: 38052, hash: '3366570bda6c' },
  'hole-17-yellow-card': { hole: 17, tee: 'yellow', url: '/audio/holes/hole-17-yellow-card.mp3', bytes: 35545, hash: 'c5df914b03b1' },
  'hole-17-yellowRed-card': { hole: 17, tee: 'yellowRed', url: '/audio/holes/hole-17-yellowRed-card.mp3', bytes: 35963, hash: 'b296237ee246' },
  'hole-17-red-card': { hole: 17, tee: 'red', url: '/audio/holes/hole-17-red-card.mp3', bytes: 35545, hash: '1cea3144c5bd' },
  'hole-18-blue-card': { hole: 18, tee: 'blue', url: '/audio/holes/hole-18-blue-card.mp3', bytes: 34082, hash: '579fb43ce272' },
  'hole-18-white-card': { hole: 18, tee: 'white', url: '/audio/holes/hole-18-white-card.mp3', bytes: 34291, hash: '7933306cfeaf' },
  'hole-18-whiteYellow-card': { hole: 18, tee: 'whiteYellow', url: '/audio/holes/hole-18-whiteYellow-card.mp3', bytes: 37216, hash: '5879837bdb32' },
  'hole-18-yellow-card': { hole: 18, tee: 'yellow', url: '/audio/holes/hole-18-yellow-card.mp3', bytes: 33037, hash: 'b88970914ba4' },
  'hole-18-yellowRed-card': { hole: 18, tee: 'yellowRed', url: '/audio/holes/hole-18-yellowRed-card.mp3', bytes: 36485, hash: '39acb4d168f3' },
  'hole-18-red-card': { hole: 18, tee: 'red', url: '/audio/holes/hole-18-red-card.mp3', bytes: 33350, hash: '76c878b9cf6b' },
};

/** 여섯 티가 공유하는 클럽 해설. */
export const NARRATION_DESCRIPTIONS: Record<string, NarrationClip> = {
  'hole-1-desc': { hole: 1, url: '/audio/holes/hole-1-desc.mp3', bytes: 69399, hash: '96647484fe07' },
  'hole-2-desc': { hole: 2, url: '/audio/holes/hole-2-desc.mp3', bytes: 20498, hash: '982922e8173a' },
  'hole-3-desc': { hole: 3, url: '/audio/holes/hole-3-desc.mp3', bytes: 72534, hash: '22a1c23cebc0' },
  'hole-4-desc': { hole: 4, url: '/audio/holes/hole-4-desc.mp3', bytes: 59577, hash: '2a5e922b1216' },
  'hole-5-desc': { hole: 5, url: '/audio/holes/hole-5-desc.mp3', bytes: 77758, hash: '586f6f3728d9' },
  'hole-6-desc': { hole: 6, url: '/audio/holes/hole-6-desc.mp3', bytes: 58114, hash: '41eb75c55cbb' },
  'hole-7-desc': { hole: 7, url: '/audio/holes/hole-7-desc.mp3', bytes: 54353, hash: 'd9cf35c06204' },
  'hole-8-desc': { hole: 8, url: '/audio/holes/hole-8-desc.mp3', bytes: 48397, hash: '73f0cf19ad88' },
  'hole-9-desc': { hole: 9, url: '/audio/holes/hole-9-desc.mp3', bytes: 51949, hash: 'c2fb0abc4c47' },
  'hole-10-desc': { hole: 10, url: '/audio/holes/hole-10-desc.mp3', bytes: 57905, hash: '7045a1ba92eb' },
  'hole-11-desc': { hole: 11, url: '/audio/holes/hole-11-desc.mp3', bytes: 61040, hash: 'b5a2c7cee908' },
  'hole-12-desc': { hole: 12, url: '/audio/holes/hole-12-desc.mp3', bytes: 64802, hash: '745583f0f2c2' },
  'hole-13-desc': { hole: 13, url: '/audio/holes/hole-13-desc.mp3', bytes: 60622, hash: 'df257a3d82bf' },
  'hole-14-desc': { hole: 14, url: '/audio/holes/hole-14-desc.mp3', bytes: 71280, hash: '90fc429d2d2a' },
  'hole-15-desc': { hole: 15, url: '/audio/holes/hole-15-desc.mp3', bytes: 62921, hash: '287317ac519d' },
  'hole-16-desc': { hole: 16, url: '/audio/holes/hole-16-desc.mp3', bytes: 54875, hash: '64a9b6069e4f' },
  'hole-17-desc': { hole: 17, url: '/audio/holes/hole-17-desc.mp3', bytes: 82251, hash: '51cf960692e6' },
  'hole-18-desc': { hole: 18, url: '/audio/holes/hole-18-desc.mp3', bytes: 71280, hash: 'e688f5640970' },
};

/** 미리 받기 화면이 "약 N MB"를 계산할 때 씁니다. */
export const NARRATION_AUDIO_TOTAL_BYTES = 4893960;

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
