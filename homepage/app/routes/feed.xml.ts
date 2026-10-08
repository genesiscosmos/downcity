/**
 * RSS 2.0 feed 路由（中英文合并输出）。
 *
 * 为什么需要：blog 此前没有订阅入口，聚合器与部分 AI 抓取器依赖 feed 发现新内容。
 * 文章 frontmatter 没有 date 字段，且实测全部 7 篇均由同一次提交引入
 * （git 首次提交日 2026-09-18），因此统一使用该固定日期，不伪造时间戳。
 */
import { docs_index } from "@/lib/docs/docs-index";
import { create_site_url } from "@/lib/seo";

/** 全部文章的首次发布日期（与 blog JSON-LD 的 datePublished 保持一致）。 */
const PUBLISHED_AT = "2026-09-18";

/** 转义 XML 文本节点中的保留字符。 */
function escape_xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function loader() {
  const pages = docs_index.list_all_space_pages("blog");

  const items = pages
    .map((page) => {
      const title = page.title;
      const description = page.description;
      const url = create_site_url(page.url);

      return [
        "    <item>",
        `      <title>${escape_xml(title)}</title>`,
        `      <link>${escape_xml(url)}</link>`,
        `      <guid isPermaLink="true">${escape_xml(url)}</guid>`,
        description ? `      <description>${escape_xml(description)}</description>` : "",
        `      <pubDate>${new Date(`${PUBLISHED_AT}T00:00:00Z`).toUTCString()}</pubDate>`,
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Downcity Blog</title>
    <link>${create_site_url("/en/blog/")}</link>
    <description>Long-form explanations of the agent runtime layer and agent productization.</description>
    <language>en</language>
    <atom:link href="${create_site_url("/feed.xml")}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(feed, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
