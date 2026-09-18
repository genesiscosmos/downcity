/**
 * Downcity 全站 XML sitemap 路由。
 *
 * 关键说明：
 * 1. 只输出可直接访问的最终规范 URL，不输出会重定向的无尾斜杠地址。
 * 2. 文档 URL 使用 Fumadocs 的公开 page.url，禁止把 MDX 文件路径写入 sitemap。
 * 3. 同时存在中英文版本时输出双向 hreflang 与 x-default。
 */
import { source } from "@/lib/source";
import { citySdkDocsSource } from "@/lib/city-sdk-docs-source";
import { agentSdkDocsSource } from "@/lib/agent-sdk-docs-source";
import { paymentsSource } from "@/lib/payments-source";
import { pluginsDocsSource } from "@/lib/plugins-docs-source";
import { uiSdkDocsSource } from "@/lib/ui-sdk-docs-source";
import { blogSource } from "@/lib/blog-source";
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
 * 文章页由 create_document_entries 从 content/blog 自动采集，但列表页不是 MDX，
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

/**
 * 转义 XML 文本节点和属性值中的保留字符。
 */
function escape_xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * 将英文营销页路径转换为对应中文路径。
 */
function create_chinese_marketing_path(english_pathname: string) {
  return english_pathname === "/"
    ? "/zh/"
    : normalize_site_path(`/zh${english_pathname}`);
}

/**
 * 创建营销页 sitemap 条目。
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
 * 根据公开文档 URL 创建 sitemap 条目，并且仅关联真实存在的对应语言页面。
 */
function create_document_entries(pages: Array<{ url: string }>): SeoSitemapEntry[] {
  const normalized_paths = pages.map((page) => normalize_site_path(page.url));
  const path_set = new Set(normalized_paths);

  return normalized_paths.map((pathname) => {
    const is_chinese = pathname.startsWith("/zh/");
    const english_pathname = is_chinese
      ? normalize_site_path(pathname.replace(/^\/zh(?=\/)/, "/en"))
      : pathname;
    const chinese_pathname = is_chinese
      ? pathname
      : normalize_site_path(pathname.replace(/^\/en(?=\/)/, "/zh"));

    return {
      pathname,
      english_pathname: path_set.has(english_pathname) ? english_pathname : undefined,
      chinese_pathname: path_set.has(chinese_pathname) ? chinese_pathname : undefined,
    };
  });
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
  const document_entries = [
    ...create_document_entries(source.getPages()),
    ...create_document_entries(citySdkDocsSource.getPages()),
    ...create_document_entries(agentSdkDocsSource.getPages()),
    ...create_document_entries(paymentsSource.getPages()),
    ...create_document_entries(pluginsDocsSource.getPages()),
    ...create_document_entries(uiSdkDocsSource.getPages()),
    ...create_document_entries(blogSource.getPages()),
  ];
  const unique_entries = new Map<string, SeoSitemapEntry>();

  for (const entry of [
    ...create_marketing_entries(),
    ...blog_index_entries,
    ...document_entries,
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
