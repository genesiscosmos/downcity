/**
 * Blog 文章页 loader（仅服务端）。
 *
 * 与文档空间同因：这里读取磁盘上的 MDX 并访问文档索引，若与页面渲染放在同一模块，
 * 会把 `node:fs` / `node:path` 打进浏览器包，导致路由在客户端加载即抛错。
 * 渲染层在 `page.tsx`，只消费本模块返回的纯数据。
 */
import { type Route } from "./+types/page";
import { readFile } from "node:fs/promises";
import { docs_index } from "@/lib/docs/docs-index";
import {
  create_article_structured_data,
  serialize_structured_data,
} from "@/lib/structured-data";

/** 文章首次发布的固定日期，用于 JSON-LD 的 datePublished。 */
const PUBLISHED_AT = "2026-09-18";

/**
 * 从 MDX frontmatter 读取每篇文章自己的 keywords。
 *
 * 为什么要手工解析：编译集合只暴露内置字段，自定义 frontmatter 不会透出，
 * 直接用 `page.keywords` 会静默拿到 undefined 并回退成硬编码值，
 * 让所有文章共用同一组关键词（这是之前存在的真实缺陷）。
 */
function read_frontmatter_keywords(raw: string): string | undefined {
  const match = raw.match(/^keywords:\s*(.+)$/m);
  if (!match) return undefined;
  const value = match[1].trim().replace(/^["']|["']$/g, "");

  return value.length > 0 ? value : undefined;
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const raw_path = params["*"] ?? "";
  const lang = url.pathname.startsWith("/zh/") || url.pathname === "/zh" ? "zh" : "en";

  const slugs = raw_path.split("/").filter((value: string) => value.length > 0);
  const lang_index = slugs.findIndex((slug: string) => slug === "en" || slug === "zh");
  const clean_slugs = lang_index >= 0 ? slugs.slice(lang_index + 1) : slugs;

  const page = docs_index.find_page("blog", lang, clean_slugs);
  if (!page) {
    throw new Response("Not found", { status: 404 });
  }

  // 读取原始 Markdown，用于 keywords 解析；失败时回退为通用关键词。
  let raw_markdown = "";
  if (page.absolute_path) {
    try {
      raw_markdown = await readFile(page.absolute_path, "utf-8");
    } catch {
      raw_markdown = "";
    }
  }

  const keywords =
    read_frontmatter_keywords(raw_markdown) ?? "agent harness, agent runtime, Downcity";

  const article_jsonld = serialize_structured_data(
    create_article_structured_data({
      title: page.title,
      description: page.description,
      pathname: page.url,
      date_published: PUBLISHED_AT,
      lang,
    }),
  );

  return {
    title: page.title,
    description: page.description,
    keywords,
    content_path: page.content_path,
    url: page.url,
    alternate_url: docs_index.get_alternate_url(page),
    article_jsonld,
  };
}
