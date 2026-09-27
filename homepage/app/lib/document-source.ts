/**
 * 文档源文件存在性校验模块。
 *
 * 背景：fumadocs 在页面树里会带上 fallback 节点，`source.getPage(slugs, lang)` 对
 * 「英文有、中文缺」的页面仍会返回一个页面对象。实测
 * `/zh/city-sdk-docs/service/feedback/`（英文有 `feedback.mdx`、中文没有）就是这种情况：
 * 它会被写进 sitemap，并让英文页声明一条指向 404 的 `zh-CN` hreflang。
 *
 * 回查源文件是否真实存在，是判断一个公开文档 URL 是否真正可索引的唯一可靠方式。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * 校验某个公开文档 URL 在 `content/<collection>/` 下是否真有对应源文件。
 *
 * URL 与文件的映射规则与 `react-router.config.ts` 的预渲染扫描保持一致：
 * - 公开 URL：`/{lang}/{route_prefix}/{slug...}/`
 * - 源文件：  `content/{collection_directory}/{lang}/{slug...}.mdx`（或 `index.mdx`）
 */
export function document_source_exists(pathname: string, collection_directory: string) {
  const segments = pathname.split("/").filter(Boolean);

  // 至少需要「语言段 + route_prefix 段」，否则无从映射到源文件。
  if (segments.length < 2) return false;

  // 丢掉语言段之后的 route_prefix 段（实测两者同名，但不应依赖这一点）。
  const relative = [segments[0], ...segments.slice(2)].join("/");
  const base = join(process.cwd(), "content", collection_directory);

  return (
    existsSync(join(base, `${relative}.mdx`)) ||
    existsSync(join(base, `${relative}.md`)) ||
    existsSync(join(base, relative, "index.mdx")) ||
    existsSync(join(base, relative, "index.md"))
  );
}

/**
 * 仅当对应语言的源文件真实存在时，才返回可用的 alternate URL。
 *
 * 用途：文档页 loader 判断是否输出 hreflang。缺少真实译文时返回 undefined，
 * 避免把语言聚类指向一个 404。
 */
export function resolve_alternate_url(
  alternate_page: { url: string } | undefined,
  collection_directory: string,
): string | undefined {
  if (!alternate_page) return undefined;
  return document_source_exists(alternate_page.url, collection_directory)
    ? alternate_page.url
    : undefined;
}
