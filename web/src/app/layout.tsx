import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "anvil",
  description: "AI 서비스 기획 컨설팅 에이전트",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-white text-neutral-700">
        {children}
      </body>
    </html>
  );
}
