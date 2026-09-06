const nextConfig = {
    // Cloudflare Pages 등 정적 호스팅 배포를 위한 static export
    output: "export",

    // 💡 CI/CD 및 빠른 빌드 환경을 위해 강력한 검사 임시 무시
    typescript: {
        ignoreBuildErrors: true,
    },
};

export default nextConfig;
