// @input  — globals.css 全局样式
// @output — 全局根布局（无 <html>/<body>，由 [locale]/layout 渲染）
// @pos    — App Router 根布局，仅引入样式和 metadata
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://gengrowth.ai"),
  title: { default: "GenGrowth", template: "%s — GenGrowth" },
  description: "Automated Growth Operating System",
  alternates: {
    types: {
      "application/rss+xml": "/feed.xml",
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
