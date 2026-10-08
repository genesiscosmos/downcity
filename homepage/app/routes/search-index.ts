/**
 * 静态搜索索引路由。
 *
 * 为每个语言输出一份 JSON 索引，路径固定为 `/search-index.<locale>.json`，由预渲染
 * 写成静态资源。为什么不用服务端检索：站点部署在 Cloudflare Pages 静态直传，构建期
 * 生成索引既能省掉一个运行时依赖，也让检索完全在浏览器内完成。
 *
 * 索引只保留检索需要的字段：标题、摘要、正文小标题与少量正文摘要，避免把全文塞进
 * 首页会加载的资源。正文顺序与文档索引一致。
 */
import { docs_index } from "@/lib/docs/docs-index";
import { docs_spaces } from "@/lib/docs/spaces";
import type { DocsLocale, DocsSearchIndex, DocsSearchRecord } from "@/lib/docs/types";

/** 单条记录保留的正文摘要长度上限，用于结果命中定位。 */
const snippet_length_limit = 600;

/**
 * 从编译期的结构化正文中抽取摘要。
 *
 * 结构化正文按标题切段，这里把所有段落拼成一段纯文本并截断，用于检索时的正文命中。
 */
function create_snippet(record_text: string): string {
  const normalized = record_text.replace(/\s+/g, " ").trim();

  return normalized.slice(0, snippet_length_limit);
}

/** 解析请求路径中的语言，未知取值一律回退到默认语言。 */
function resolve_locale(pathname: string): DocsLocale {
  return pathname.includes(".zh.") ? "zh" : "en";
}

export function loader({ request }: { request: Request }) {
  const locale = resolve_locale(new URL(request.url).pathname);
  const records: DocsSearchRecord[] = [];

  for (const space of docs_spaces) {
    for (const page of docs_index.list_space_pages(space.id, locale)) {
      const contents = page.structured_data?.contents ?? [];
      const headings = contents
        .map((section) => section.heading?.trim())
        .filter((heading): heading is string => Boolean(heading && heading.length > 0));

      records.push({
        space: space.id,
        locale,
        title: page.title,
        url: page.url,
        description: page.description,
        headings,
        // 摘要优先保留正文开头，用于按正文内容命中。
        snippet: create_snippet(contents.map((section) => section.content ?? "").join(" ")),
      });
    }
  }

  const index: DocsSearchIndex = { locale, records };

  return new Response(JSON.stringify(index), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
