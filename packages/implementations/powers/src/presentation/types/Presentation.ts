/** Presentation 动作与视图的内部输入协议。 */
import type { PowerMessageComponentProps } from "@downcity/city/power/react";

/** 完整描述发布输入，在 Schema 校验后由 Action 读取。 */
export interface PresentationShowInput {
  /** 文本渠道、复制及历史上下文使用的摘要。 */
  fallback_text: string;
  /** 待目录校验的 OpenUI Lang 文本。 */
  content: string;
}

/** 固定描述对应的一次视图实例输入。 */
export interface PresentationViewProps extends PowerMessageComponentProps {
  /** 累计 OpenUI 描述，更新不会改变视图实例身份。 */
  content: string;
  /** 生成预览尚未通过 Action 完整校验。 */
  streaming: boolean;
}
