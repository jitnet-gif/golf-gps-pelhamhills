This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Cloudflare Pages

1. Cloudflare 계정에서 Pages 프로젝트를 생성합니다.
2. `frontend/wrangler.toml`에서 `account_id`와 `project_name`을 채웁니다.
3. `frontend`에서 다음 명령으로 빌드/배포:

```bash
cd frontend
npm install
npm run build
npm run export
wrangler pages deploy out --project-name bepu
```

4. 배포 후, Pages 대시보드에서 `NEXT_PUBLIC_API_URL` 환경 변수를 실제 백엔드 URL로 설정합니다.

> 예: `https://api.bepu.app/api/v1`

5. 배포 확인: Cloudflare Pages URL로 접속해 앱이 정상 작동하는지 확인합니다.


## 로컬 개발

개발 중에는 기존처럼 `npm run dev`로 실행하세요.
