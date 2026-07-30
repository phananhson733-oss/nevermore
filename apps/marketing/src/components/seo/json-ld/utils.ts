// @input  -- JSON-serializable data
// @output -- safeJsonLd() XSS-safe JSON-LD serializer
// @pos    -- json-ld 目录的共享工具函数，被各 JSON-LD 组件引用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/** Escape `</` in JSON-LD to prevent </script> injection (XSS) */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
