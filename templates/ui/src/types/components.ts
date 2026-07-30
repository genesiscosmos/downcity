/**
 * UI 展示应用的组件类型。
 *
 * 这些类型只描述展示应用自身的布局组件，不扩展 `@downcity/ui` 的公开类型。
 */

/** 展示区域标题组件属性。 */
export interface SectionHeadingProps {
  /** 当前展示区域的主标题。 */
  title: string;
  /** 当前展示区域用途与组件范围的简短说明。 */
  description: string;
}
