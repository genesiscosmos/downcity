/**
 * MarkdownView 的 Mermaid 语法渲染入口，由 Pele 同步生成 SVG。
 *
 * 布局缓存只依赖源码、可用宽度与字体；颜色通过宿主 CSS 变量更新，无需重排。
 * 所有图表类型静态注册，避免首次显示某种图表时再发起异步加载。Pele 不写全局主题配置，
 * 因此无需串行队列。缓存使用完整输入作为键，不依赖可能碰撞的内容散列。
 *
 * 缓存中的 SVG 使用内部标识前缀，交付组件时替换成该组件的独立前缀，避免同页多张相同图
 * 的 marker、clipPath 等 SVG 引用冲突，同时保留离屏卸载后的缓存复用。
 */

import { forgetTextWidths, render } from "pele";

const render_cache_limit = 32;
const cached_id_prefix = "downcity-pele-cache-";
const render_cache = new Map<string, string>();

/** 字体文件加载完成后，清除 Pele 的文字测量与本地布局缓存。 */
export function invalidate_mermaid_fonts(): void {
  forgetTextWidths();
  render_cache.clear();
}

/**
 * 按容器内容宽度渲染；字体在调用时从宿主读取，主题颜色保留为 CSS 变量。
 *
 * fontSize 使用固定布局像素，SVG 再按容器等比缩放。禁止图表声明外部图片或链接，
 * 让模型生成的图表保持为纯展示内容；源码中的节点文字与样式由 Pele 转义、过滤。
 */
export function render_mermaid_svg(source: string, max_width: number, canvas: HTMLElement, id_prefix: string): string {
  const style = getComputedStyle(canvas);
  const options = {
    fontFamily: style.fontFamily,
    fontFamilyMono: style.getPropertyValue("--markdown-mermaid-mono").trim() || "monospace",
    fontSize: 14,
    maxWidth: Math.max(1, Math.floor(max_width)),
    idPrefix: cached_id_prefix,
    links: false,
    images: false,
  };
  const cache_key = JSON.stringify([source, options]);
  let svg = render_cache.get(cache_key);
  if (svg !== undefined) {
    render_cache.delete(cache_key);
  } else {
    svg = render(source, options).svg;
  }
  render_cache.set(cache_key, svg);
  while (render_cache.size > render_cache_limit) {
    const oldest = render_cache.keys().next().value;
    if (oldest === undefined) break;
    render_cache.delete(oldest);
  }
  // 只替换 SVG 属性中的标识，不改动用户标签里偶然出现的相同文本。
  return svg.replace(/\b(id|href|clip-path|mask|filter|fill|stroke|marker-start|marker-mid|marker-end)="([^"]*)"/g, (attribute, name: string, value: string) => {
    if (name === "id" && value.startsWith(cached_id_prefix)) return `${name}="${id_prefix}${value.slice(cached_id_prefix.length)}"`;
    return attribute.replaceAll(`#${cached_id_prefix}`, `#${id_prefix}`);
  });
}
