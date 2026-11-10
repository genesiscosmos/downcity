/** Mermaid 图表导出与全屏适配共用的 SVG 原始尺寸。 */
export type MermaidSvgSize = {
  /** 布局坐标系中的宽度，优先读取 SVG viewBox，单位为布局像素。 */
  width: number;
  /** 布局坐标系中的高度，优先读取 SVG viewBox，单位为布局像素。 */
  height: number;
};
