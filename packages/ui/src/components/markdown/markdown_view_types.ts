/** MarkdownView 的公共内容与宿主适配接口；排版完全由组件管理。 */
import type { ReactNode } from "react";
import type { MarkdownViewTextSize } from "./markdown_text_size";

/** 统一 Markdown 阅读视图，不接受字体、字号、行高或节点样式覆盖。 */
export interface MarkdownViewProps {
  /** 完整或持续更新的 Markdown 原文；空字符串不显示占位内容。 */
  text: string;
  /** static 为默认模式；streaming 允许未闭合语法逐步渲染。 */
  mode?: "static" | "streaming";
  /** document 默认提供居中正文与阅读留白；embedded 填满宿主且无外层留白。 */
  layout?: "document" | "embedded";
  /** 来源文档 URL，用于解析相对资源路径，不改变正文中的链接文本。 */
  document_url?: string;
  /** 仅应用于外层布局节点，供宿主布局和定位使用。 */
  class_name?: string;
}

/** 应用级资源、翻译与受控字号档位；不开放插件或任意排版覆盖。 */
export interface MarkdownViewProviderProps {
  /** 应用内容；内部所有 MarkdownView 共用本层的资源与翻译适配。 */
  children: ReactNode;
  /** 嵌入内容的受控字号档位；默认继承祖先或使用 medium，文档与静态导出保持标准档。 */
  text_size?: MarkdownViewTextSize;
  /** 将已校验的图片路径解析为宿主资源 URL；返回 undefined 时不加载图片。 */
  resolve_image_src?: (src: string, document_url?: string) => string | undefined;
  /** 翻译图表操作等辅助文本；未提供时使用内置英文文案。 */
  translate?: (key: string) => string;
}
