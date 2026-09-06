import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pelham Hills Golf Club - Golf, Pub, and Indoor Simulators",
  description:
    "Pelham Hills Golf Club offers an 18-hole parkland course, clubhouse dining, and indoor golf simulators in Welland, Ontario.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="min-h-screen w-full bg-bepu-bg text-bepu-text antialiased selection:bg-bepu-mint/30 selection:text-bepu-text"
      >
        {children}
      </body>
    </html>
  );
}
