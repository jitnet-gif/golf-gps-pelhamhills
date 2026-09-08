/**
 * Next 설정은 **이 파일 하나뿐**이다.
 *
 * 예전에는 `next.config.mjs` 와 `next.config.ts` 가 함께 있었다. Next 의 해석
 * 순서는 js → mjs → ts 라서 실제로 먹은 것은 `.mjs` 였고, `.ts` 는 읽히지도 않은
 * 채 서로 다른 설정(`ignoreBuildErrors` 유무)을 담고 있었다. 어느 쪽이 적용되는지
 * 파일만 봐서는 알 수 없는 상태였으므로 `.ts` 를 지우고 여기로 합쳤다.
 */
const nextConfig = {
  // Cloudflare Pages / Vercel 정적 호스팅 배포를 위한 static export.
  // 이 모드에서는 미들웨어·rewrites·route handler·server action 이 전부 없다.
  // 공개 사이트 / 예약 사이트 / 어드민 구분이 경로(path) 기반인 이유가 이것이다.
  output: "export",

  // 빌드는 통과시키되 타입은 별도 게이트(`npx tsc --noEmit`)에서 잡는다.
  // 여기서 끄면 legacy lib 3종(bepu-prompt·gemini-client·supabase)의
  // 미설치 의존성 오류로 전체 빌드가 멈춘다.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
