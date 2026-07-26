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
  description: "监测A股主线、资金、扩散和龙头梯队，识别启动、加速、观察与退潮阶段。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "主线雷达｜A股市场主线监测",
    description: "识别主线，不追逐噪声。监测启动、加速、观察与退潮。",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "主线雷达市场监测" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "主线雷达｜A股市场主线监测",
    description: "识别主线，不追逐噪声。监测启动、加速、观察与退潮。",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={notoSans.variable}>{children}</body></html>;
}
