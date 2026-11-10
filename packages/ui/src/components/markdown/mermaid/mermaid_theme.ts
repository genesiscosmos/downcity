/**
 * Pele 图表的独立导出样式快照。
 *
 * 屏幕内的主题由组件 mermaid.css 映射，全屏层从真实宿主捕获局部令牌与字体。导出到 Blob 后，
 * SVG 无法继承页面上的 CSS 变量，因此在脱离文档前读取已挂载 SVG 的计算值，写入克隆节点。
 * 收集图表实际引用的变量（含色阶与 Pele 内部别名），避免遗漏某种图表独有的主题属性。
 */

import type { CSSProperties } from "react";

/** Portal 必须携带的宿主主题令牌，覆盖画布、图表色阶、控件与焦点。 */
const overlay_theme_tokens = [
  "--background", "--foreground", "--muted", "--muted-foreground", "--card",
  "--border", "--border-subtle", "--primary", "--destructive", "--popover",
  "--ring", "--interaction-hover", "--markdown-font-family", "--font-mono",
];

/** 从正文画布读取计算值；局部 ThemeContainer 的令牌不再依赖 body 继承。 */
export function read_mermaid_overlay_style(source: HTMLElement | null): CSSProperties {
  if (!source) return {};
  const computed = getComputedStyle(source);
  const tokens: Record<string, string> = {};
  for (const name of overlay_theme_tokens) {
    const value = computed.getPropertyValue(name).trim();
    if (value) tokens[name] = value;
  }
  return {
    ...tokens,
    fontFamily: computed.fontFamily,
    fontSize: computed.fontSize,
    fontWeight: computed.fontWeight,
    lineHeight: computed.lineHeight,
    colorScheme: computed.colorScheme,
  };
}

/** 将当前主题、字体与背景固化到 SVG 副本，原始页面节点保持不变。 */
export function snapshot_mermaid_svg(svg_element: SVGSVGElement): string {
  const clone = svg_element.cloneNode(true) as SVGSVGElement;
  const style = getComputedStyle(svg_element);
  const serialized = new XMLSerializer().serializeToString(clone);
  const variable_names = new Set([...serialized.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]!));
  for (const name of variable_names) {
    const value = style.getPropertyValue(name).trim();
    if (value) clone.style.setProperty(name, value);
  }
  clone.style.backgroundColor = style.backgroundColor;
  clone.style.color = style.color;
  clone.style.fontFamily = style.fontFamily;
  return new XMLSerializer().serializeToString(clone);
}
