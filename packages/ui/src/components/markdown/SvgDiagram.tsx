/**
 * MarkdownView 中 SVG 围栏的隔离预览。只接受完整的 SVG XML 文档，通过 Blob 图片加载，
 * 不向页面注入 SVG DOM；无效或未完成的流式源码保留为可读代码。
 * 每次源码变更和卸载时释放对象 URL，图片解码失败也退回源码。
 */

import { useEffect, useState, type ReactNode } from "react";

/** 校验文档并补齐图片解码要求的 SVG 命名空间。 */
function prepare_svg(source: string): string | null {
  if (!source.trim() || /<!DOCTYPE/i.test(source)) return null;
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (document.querySelector("parsererror") || root.localName !== "svg") return null;
  if (root.namespaceURI && root.namespaceURI !== "http://www.w3.org/2000/svg") return null;
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(document);
}

/** 将 rehype 写入的源码显示为图片；不完整的代码保持原文可见。 */
export function SvgDiagram({ children }: { /** SVG 围栏的原始文本子节点。 */ children?: ReactNode }) {
  const source = typeof children === "string" ? children : Array.isArray(children) ? children.filter((child) => typeof child === "string").join("") : "";
  const [preview, set_preview] = useState<{ /** 对应当前图片的原始源码。 */ source: string; /** 组件持有并负责释放的 Blob URL。 */ url: string } | null>(null);
  const [failed_url, set_failed_url] = useState<string | null>(null);

  useEffect(() => {
    const svg = prepare_svg(source);
    if (!svg) {
      set_preview(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    set_preview({ source, url });
    set_failed_url(null);
    return () => URL.revokeObjectURL(url);
  }, [source]);

  const current_preview = preview?.source === source && preview.url !== failed_url ? preview : null;
  return current_preview ? (
    <div className="markdown-svg" data-svg-state="rendered">
      <img src={current_preview.url} alt="SVG" onError={() => set_failed_url(current_preview.url)} />
    </div>
  ) : (
    <pre data-svg-state="source"><code className="language-svg">{source}</code></pre>
  );
}
