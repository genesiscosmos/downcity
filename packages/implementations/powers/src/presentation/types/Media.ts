/** Presentation 媒体适配的内部输入与解析协议。 */
import type { ReactNode } from "react";

/** 保留 OpenUI 组件的标准渲染参数。 */
export interface PresentationMediaProps {
  /** 上游解析后的组件属性，图片字段由宿主协议适配。 */
  props: Record<string, unknown>;
  /** 渲染嵌套 OpenUI 节点的端口。 */
  renderNode: (value: unknown) => ReactNode;
  /** 稳定语句身份，增量更新不改变该值。 */
  statementId?: string;
}
