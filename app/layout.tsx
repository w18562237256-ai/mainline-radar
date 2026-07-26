import type { Metadata } from "next";
import { Noto_Sans_SC } from "next/font/google";
import "./globals.css";

const notoSans = Noto_Sans_SC({
  variable: "--font-noto",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "主线雷达｜A股市场主线监测",
  description: "用资金强度、板块扩散、走势持续与龙头梯队识别A股市场主线。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "主线雷达｜A股市场主线监测",
    description: "识别资金真正聚焦的方向，不被单日涨幅误导。",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "主线雷达市场监测仪表盘" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "主线雷达｜A股市场主线监测",
    description: "识别资金真正聚焦的方向，不被单日涨幅误导。",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={notoSans.variable}>{children}</body>
    </html>
  );
}
