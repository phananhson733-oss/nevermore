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
  applicationName: "GenGrowth",
  // Declared here rather than relying on file-convention discovery: this app
  // renders its <html>/<head> from `[locale]/layout`, and the icon set is a
  // deliberate multi-size one (a 16px tab rendition of the full mark is mush,
  // so the .ico carries its own crop). Mirrors apps/web so both properties
  // present the same mark.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
      { url: "/icon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: [{ url: "/favicon.ico", type: "image/x-icon" }],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
