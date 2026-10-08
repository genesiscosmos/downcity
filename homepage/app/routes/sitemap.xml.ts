/**
 * Downcity 全站 XML sitemap 路由。
 *
 * 关键说明：
 * 1. 只输出可直接访问的最终规范 URL，不输出会重定向的无尾斜杠地址。
 * 2. 文档 URL 来自文档索引的公开 `page.url`，禁止把 MDX 文件路径写入 sitemap。
 * 3. hreflang 只指向真实存在的对应语言页面：索引的 `get_alternate_url` 已按
 *    页面表校验，不存在时返回 undefined。
 * 4. 目录跳转壳页（`index.mdx` 与子页共存的目录）被索引标记为 section，不进入
 *    sitemap，因此这里不再需要按路径前缀推断。
 */
import { docs_index } from "@/lib/docs/docs-index";
import { docs_locales, docs_spaces } from "@/lib/docs/spaces";
import { create_site_url, normalize_site_path } from "@/lib/seo";
import type { SeoSitemapEntry } from "@/types/seo";

const localized_marketing_paths = [
  "/",
  "/whitepaper/",
  "/start/",
  "/features/",
  "/product/",
  "/product/city-sdk/",
  "/product/federation-sdk/",
  "/product/agent-sdk/",
  "/product/ui-sdk/",
  // "/resources/" 故意不入 sitemap：该路由只是客户端 Navigate 到 /resources/skills/ 的空壳页面，
  // 让搜索引擎收录一个无内容的 JS 跳转页会浪费抓取预算并容易被判定为 soft 404。
  "/resources/skills/",
  "/resources/marketplace/",
  "/resources/hosting/",
  "/resources/examples/",
  "/community/",
  "/community/faq/",
  "/community/roadmap/",
  "/community/showcase/",
] as const;

const single_language_paths = ["/terms/", "/privacy/"] as const;

/**
 * Blog 列表页的双语条目。
 *
 * 文章页由 `create_document_entries` 从内容目录自动采集，但列表页不是 MDX，
 * 不在其中，因此这里手工声明一对，保证 sitemap 里也带上 hreflang。
 */
const blog_index_entries: SeoSitemapEntry[] = [
  {
    pathname: "/en/blog/",
    english_pathname: "/en/blog/",
    chinese_pathname: "/zh/blog/",
  },
  {
    pathname: "/zh/blog/",
    english_pathname: "/en/blog/",
    chinese_pathname: "/zh/blog/",
  },
];

/** 转义 XML 文本节点和属性值中的保留字符。 */
function escape_xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** 将英文营销页路径转换为对应中文路径。 */
function create_chinese_marketing_path(english_pathname: string) {
  return english_pathname === "/"
    ? "/zh/"
    : normalize_site_path(`/zh${english_pathname}`);
}

/**
 * 创建营销页 sitemap 条目。
 *
 * 营销页的中英文入口都在预渲染列表里成对存在，因此直接声明双向 hreflang。
 */
function create_marketing_entries(): SeoSitemapEntry[] {
  const localized_entries = localized_marketing_paths.flatMap((english_pathname) => {
    const chinese_pathname = create_chinese_marketing_path(english_pathname);
    return [
      { pathname: english_pathname, english_pathname, chinese_pathname },
      { pathname: chinese_pathname, english_pathname, chinese_pathname },
    ];
  });
  const single_language_entries = single_language_paths.map((pathname) => ({ pathname }));

  return [...localized_entries, ...single_language_entries];
}

/**
 * 从文档索引创建全部文档 sitemap 条目。
 *
 * 每个可索引页面已经由索引排除了 section 与缺失语言的情况，这里只负责把语言配对
 * 表达成 sitemap 的 `english_pathname` / `chinese_pathname`。
 */
function create_document_entries(): SeoSitemapEntry[] {
  const entries: SeoSitemapEntry[] = [];

  for (const space of docs_spaces) {
    for (const locale of docs_locales) {
      for (const page of docs_index.list_space_pages(space.id, locale)) {
        const alternate_pathname = docs_index.get_alternate_url(page);

        entries.push({
          pathname: page.url,
          english_pathname: locale === "en" ? page.url : alternate_pathname,
          chinese_pathname: locale === "zh" ? page.url : alternate_pathname,
        });
      }
    }
  }

  return entries;
}

/**
 * 把单个规范页面序列化为 sitemap XML。
 */
function serialize_entry(entry: SeoSitemapEntry) {
  const alternate_links: string[] = [];

  if (entry.english_pathname) {
    const english_url = escape_xml(create_site_url(entry.english_pathname));
    alternate_links.push(
      `    <xhtml:link rel="alternate" hreflang="en" href="${english_url}" />`,
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${english_url}" />`,
    );
  }
  if (entry.chinese_pathname) {
    alternate_links.push(
      `    <xhtml:link rel="alternate" hreflang="zh-CN" href="${escape_xml(create_site_url(entry.chinese_pathname))}" />`,
    );
  }

  const alternate_xml = alternate_links.length > 0
    ? `\n${alternate_links.join("\n")}`
    : "";

  return `  <url>\n    <loc>${escape_xml(create_site_url(entry.pathname))}</loc>${alternate_xml}\n  </url>`;
}

/**
 * 返回构建期可预渲染的 XML sitemap。
 */
export function loader() {
  const unique_entries = new Map<string, SeoSitemapEntry>();

  for (const entry of [
    ...create_marketing_entries(),
    ...blog_index_entries,
    ...create_document_entries(),
  ]) {
    unique_entries.set(normalize_site_path(entry.pathname), entry);
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${Array.from(unique_entries.values())
  .sort((left, right) => left.pathname.localeCompare(right.pathname))
  .map(serialize_entry)
  .join("\n")}
</urlset>`;

  return new Response(sitemap, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
