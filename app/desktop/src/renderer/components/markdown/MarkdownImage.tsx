/**
 * Markdown 图片渲染。
 *
 * 关键点（中文）
 * - Agent 产出的图片保存在本地，Markdown 里写的是绝对路径；浏览器不能直接加载它。
 * - 这里把本地路径改写为 Desktop 受控协议 URL，由主进程按允许根校验后返回文件。
 * - 网络地址、data URL 与相对路径原样交给浏览器，不做猜测。
 */

import type { ComponentProps } from "react";
import { resolve_markdown_image_src } from "@common/file/local_file_url.js";

/** Markdown 内联图片。 */
export function MarkdownImage({ src, ...rest }: ComponentProps<"img">) {
  return <img {...rest} src={typeof src === "string" ? resolve_markdown_image_src(src) : src} />;
}
