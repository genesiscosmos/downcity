/**
 * 复制 Markdown 按钮。
 *
 * 把当前页面的原始 MDX 文本复制到剪贴板，并在开头补一条指向页面规范地址的注释，
 * 便于直接粘贴给 AI Agent 时保留来源。与旧实现的区别：原始文本与页面地址由父组件
 * 作为 props 传入，不再依赖隐式的 React context，组件本身可独立复用与测试。
 */
import { useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { create_site_url } from "@/lib/seo";

export function CopyMarkdownButton({
  raw_markdown,
  page_url,
}: {
  /** 当前页面的原始 MDX 文本。 */
  raw_markdown: string;
  /** 当前页面公开 URL，用于在复制内容前附加来源。 */
  page_url: string;
}) {
  const [copied, set_copied] = useState(false);

  if (!raw_markdown) return null;

  const copy = async () => {
    const payload = `<!-- Source: ${create_site_url(page_url)} -->\n\n${raw_markdown}`;

    try {
      await navigator.clipboard.writeText(payload);
      set_copied(true);
      window.setTimeout(() => set_copied(false), 1500);
    } catch {
      // 剪贴板不可用时保持静默。
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title="Copy page as Markdown"
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[0.75rem] font-medium text-text-soft transition-colors hover:border-line-strong hover:text-foreground"
    >
      {copied ? (
        <IconCheck className="size-3.5 text-success" strokeWidth={2} />
      ) : (
        <IconCopy className="size-3.5" strokeWidth={1.7} />
      )}
      <span className="hidden sm:inline">{copied ? "Copied" : "Markdown"}</span>
    </button>
  );
}
