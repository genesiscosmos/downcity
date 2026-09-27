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
import { document_source_exists } from "@/lib/document-source";
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
 *
 * `collection_directory` 是 `content/` 下的集合目录名（如 `city-sdk-docs`），用于回查
 * 源文件是否真实存在。
 */
function create_document_entries(
  pages: Array<{ url: string }>,
  collection_directory: string,
): SeoSitemapEntry[] {
  const normalized_paths = pages
    .map((page) => normalize_site_path(page.url))
    .filter((pathname) => document_source_exists(pathname, collection_directory));
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
 * 判断某个路径是否为 fumadocs 生成的目录跳转壳页。
 *
 * 背景：文档目录（如 /en/city-sdk-docs/concepts/）在 loader 里会 302 到首个子文档，
 * 但静态预渲染会把它先输出成一张 `<meta http-equiv="refresh">` + `noindex` 的壳页。
 * 这类页面不能进 sitemap：它既被标记 noindex，又是无正文的跳转页，收录后只会
 * 浪费抓取预算并制造 soft 404。
 *
 * 判定条件（与线上 30 个壳页实测完全一致，无误报）：
 * - 路径深度 > 2（排除 /en/docs/ 这类空间根，它们自带内容不跳转）；
 * - 存在以该路径为前缀的更长子路径，即 loader 一定会重定向。
 */
function is_redirect_stub_path(pathname: string, all_paths: ReadonlySet<string>) {
  const normalized = normalize_site_path(pathname);
  const segments = normalized.split("/").filter(Boolean);

  if (segments.length <= 2) return false;

  for (const candidate of all_paths) {
    if (candidate !== normalized && candidate.startsWith(normalized)) return true;
  }

  return false;
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
    ...create_document_entries(source.getPages(), "docs"),
    ...create_document_entries(citySdkDocsSource.getPages(), "city-sdk-docs"),
    ...create_document_entries(agentSdkDocsSource.getPages(), "agent-sdk-docs"),
    ...create_document_entries(paymentsSource.getPages(), "payments"),
    ...create_document_entries(pluginsDocsSource.getPages(), "plugins-docs"),
    ...create_document_entries(uiSdkDocsSource.getPages(), "ui-sdk-docs"),
    ...create_document_entries(blogSource.getPages(), "blog"),
  ];
  const unique_entries = new Map<string, SeoSitemapEntry>();

  for (const entry of [
    ...create_marketing_entries(),
    ...blog_index_entries,
    ...document_entries,
  ]) {
    unique_entries.set(normalize_site_path(entry.pathname), entry);
  }

  // 目录跳转壳页不能进 sitemap：它们被标记 noindex 且正文为空。
  const all_document_paths = new Set(unique_entries.keys());
  for (const [pathname, entry] of unique_entries) {
    if (is_redirect_stub_path(pathname, all_document_paths)) {
      unique_entries.delete(pathname);
      continue;
    }

    // hreflang 只能指向真实存在的对应语言页面。文档空间里英文有、中文缺的页面
    // （例如 /en/city-sdk-docs/service/feedback/）如果照旧声明 zh-CN，会把语言
    // 聚类指向一个 404。
    if (entry.english_pathname && !all_document_paths.has(entry.english_pathname)) {
      entry.english_pathname = undefined;
    }
    if (entry.chinese_pathname && !all_document_paths.has(entry.chinese_pathname)) {
      entry.chinese_pathname = undefined;
    }
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
