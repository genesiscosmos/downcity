/**
 * Agent 正文的显示边界：历史与导出直接渲染，生成中的正文启用有限频率的自适应平滑。
 * MarkdownView 仍拥有解析、主题与块级 memo；动画没有额外的字词 DOM 节点。
 */
import { MarkdownView } from "./MarkdownView";
import { use_markdown_export } from "./markdown_export_context";
import { use_smooth_text } from "./use_smooth_text";

/** Agent 正文的最小展示输入。 */
type AgentTextProps = {
  /** 当前 Part 的权威完整正文。 */
  text: string;
  /** 当前正文是否仍在生成。 */
  streaming: boolean;
  /** 宿主可在停止、失败等边界关闭平滑并直接显示完整正文。 */
  smooth: boolean;
};

/** 平滑只更新本组件；Markdown 节点在历史恢复续写时保留身份，不重新挂载。 */
export function AgentText({ text, streaming, smooth }: AgentTextProps) {
  const export_mode = use_markdown_export();
  const enabled = smooth && !export_mode;
  const visible = use_smooth_text(text, streaming && enabled, enabled);
  return <MarkdownView layout="embedded" text={visible.text} mode={visible.streaming ? "streaming" : "static"} />;
}
