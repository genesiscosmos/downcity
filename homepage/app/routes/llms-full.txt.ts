/**
 * `llms-full.txt` 路由：把全部文档正文汇总成单文件，供 AI 引擎一次性读取。
 *
 * 与 `llms.txt` 的分工：
 * - `llms.txt` 是导航索引（标题 + 链接 + 摘要），体积小；
 * - `llms-full.txt` 是全文快照，让模型不必逐页抓取即可获得完整上下文。
 *
 * 输出体积约 1.2 MB（全部 MDX 正文），因此用 1 小时缓存，避免反复生成。
 */
import { readFile } from "node:fs/promises";
import { docs_index } from "@/lib/docs/docs-index";
import { docs_spaces } from "@/lib/docs/spaces";
import { create_site_url } from "@/lib/seo";
import { strip_frontmatter } from "@/lib/ai-content";

/** 每个文档空间在汇总文件中的分组标题。 */
function collection_heading(space_id: string): string {
  const space = docs_spaces.find((item) => item.id === space_id);

  return space ? space.label.en : space_id;
}

/**
 * 渲染单篇文档为可读正文块。
 *
 * 源文件读取失败时返回 null，调用方跳过该页。
 */
async function render_page(page_url: string): Promise<string | null> {
  const page = docs_index.get_page(page_url);
  if (!page?.absolute_path) return null;

  let raw: string;
  try {
    raw = await readFile(page.absolute_path, "utf-8");
  } catch {
    return null;
  }

  const { body } = strip_frontmatter(raw);

  return [
    `### ${page.title}`,
    "",
    `Source: ${create_site_url(page.url)}`,
    "",
    body.trim(),
    "",
  ].join("\n");
}

export async function loader() {
  const sections: string[] = [
    "# Downcity — Full Documentation",
    "",
    "> Complete text of the Downcity documentation, SDK references, and articles.",
    "> Generated from the same MDX sources that render the website.",
    "",
  ];

  for (const space of docs_spaces) {
    const rendered: string[] = [];
    // 逐语言按阅读顺序输出，保持与侧边栏一致的正文顺序。
    for (const locale of ["en", "zh"] as const) {
      for (const page of docs_index.list_space_pages(space.id, locale)) {
        const block = await render_page(page.url);
        if (block) rendered.push(block);
      }
    }
    if (rendered.length === 0) continue;

    sections.push(`## ${collection_heading(space.id)}`, "", ...rendered);
  }

  return new Response(sections.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
