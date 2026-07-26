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
  description: "区分中期主线、阶段轮动与题材噪声，跟踪资金、持续性、产业兑现与龙头梯队。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "主线雷达｜A股市场主线监测",
    description: "识别主线，不追逐噪声。",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "主线雷达市场监测" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "主线雷达｜A股市场主线监测",
    description: "识别主线，不追逐噪声。",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={notoSans.variable}>{children}</body></html>;
}
