import type { Metadata, Viewport } from "next";

/**
 * 설치형 계산대 앱 "Pelham POS". 손님 예약 앱(루트 manifest, `/book` 으로 열림)과 따로
 * 설치되도록 manifest·이름·아이콘을 여기서 덮어쓴다. 범위는 `/pos` 하나다.
 */
export const metadata: Metadata = {
  title: { default: "Pelham POS", template: "%s · Pelham POS" },
  applicationName: "Pelham POS",
  manifest: "/pos.webmanifest",
  appleWebApp: { capable: true, title: "Pelham POS", statusBarStyle: "black-translucent" },
  icons: {
    icon: [
      { url: "/icons/pos-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/pos-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/pos-apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#111315",
};

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
