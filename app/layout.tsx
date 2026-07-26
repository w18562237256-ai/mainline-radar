import type { Metadata } from "next";
import { Noto_Sans_SC } from "next/font/google";
import "./globals.css";

export const dynamic = "force-dynamic";

const notoSans = Noto_Sans_SC({
  variable: "--font-noto",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "主线雷达｜A股前向信号监测",
  description: "前向监测A股候选主线、资金、扩散和龙头梯队；历史复盘与实时信号严格分离。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "主线雷达｜A股前向信号监测",
    description: "只记录前向信号，不用历史复盘冒充预测。",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "主线雷达市场监测" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "主线雷达｜A股前向信号监测",
    description: "只记录前向信号，不用历史复盘冒充预测。",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={notoSans.variable}>{children}</body></html>;
}
