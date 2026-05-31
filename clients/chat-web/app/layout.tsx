import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "autix",
  description: "工程底座最小示例",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
