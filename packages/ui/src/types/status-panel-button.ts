/** 状态面板内部按钮的视觉契约；沿用公共 Button 的交互、原生属性与 ref。 */
import type { ComponentProps } from "react";
import type { Button } from "../components/button";

/** 仅供状态面板及其交互表单共用，不增加公共 Button 的规格。 */
export interface StatusPanelButtonProps extends Omit<ComponentProps<typeof Button>, "variant" | "size"> {
  /** 普通操作使用透明背景；确认和提交使用主题主色。 */
  variant?: "default" | "primary";
  /** compact 为 24px 行内操作；图标分别为 24px 与 20px；表单分别为 28px 胶囊和 32px 页面操作。 */
  size?: "compact" | "icon" | "inline-icon" | "chat-action" | "action";
}
