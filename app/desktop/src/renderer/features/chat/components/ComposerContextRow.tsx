/**
 * 输入卡片上方的上下文行：草稿的联系人与目录 chip。
 *
 * ## 为什么在卡片外面
 *
 * 这两个 chip 是「这条草稿发给谁、在哪个目录里跑」——它们是**进入输入前的选择**，
 * 而不是输入框内容的一部分。放在卡片内部会让输入框的表头挤进两行控件，
 * 而卡片本身（`.chat-composer`）的语义是「一段正在写的输入」。
 *
 * 因此它是卡片的**同级兄弟**，排在卡片上方，几何与卡片对齐（见 `base.css` 的
 * `.chat-composer-context-row`）：宽度与左右位置都跟卡片同源，看起来是同一列。
 *
 * ## 为什么形状与模型选择器完全同档
 *
 * 模型选择器已经长在卡片内部，是用户对「输入区控件」的既有印象。
 * 这一行如果再引入第二种尺寸与圆角，同一列里就会出现两套控件语言。
 * 因此形状直接沿用它的构成：`Button` 默认尺寸（`h-6` / `text-2xs` / `px-1.5` /
 * `[&_svg]:size-3.5`）+ 胶囊圆角，只补一个宽度上限。
 */

import type { ReactNode } from "react";

/**
 * 上下文 chip 的形状。
 *
 * 只写 `Button` 默认尺寸没给的两件事：左对齐（默认居中，文字要顶格）与宽度上限
 * （长 Agent 名与长路径要截断而不是把这一行撑开）。尺寸、字号、图标档位、颜色、
 * 悬停态全部由 `Button` 与模型选择器共用同一份默认值。
 */
export const composer_context_chip_class_name = "max-w-56 justify-start rounded-full";

/** 上下文行容器：几何与输入卡片同源，见 `base.css` 的 `.chat-composer-context-row`。 */
export function ComposerContextRow({ children }: {
  /** 这一行的 chip；当前是联系人与目录两个选择器。 */
  children: ReactNode;
}) {
  return <div className="chat-composer-context-row flex flex-wrap items-center gap-1 px-2">{children}</div>;
}
