/** Presentation Markdown 适配的内部输入协议。 */
import type { ReactNode } from "react";

/** 保留 OpenUI 组件的标准渲染参数，只替换其中的 Markdown 文本。 */
export interface PresentationMarkdownProps {
  /** 上游解析后的组件属性；Markdown 字段由宿主渲染结果替换。 */
  props: Record<string, unknown>;
  /** 渲染嵌套 OpenUI 节点的端口。 */
  renderNode: (value: unknown) => ReactNode;
  /** 稳定语句身份，增量更新不改变该值。 */
  statementId?: string;
}
