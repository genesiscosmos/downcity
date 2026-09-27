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
import { source } from "@/lib/source";
import { citySdkDocsSource } from "@/lib/city-sdk-docs-source";
import { agentSdkDocsSource } from "@/lib/agent-sdk-docs-source";
import { paymentsSource } from "@/lib/payments-source";
import { pluginsDocsSource } from "@/lib/plugins-docs-source";
import { uiSdkDocsSource } from "@/lib/ui-sdk-docs-source";
import { blogSource } from "@/lib/blog-source";
import { create_site_url } from "@/lib/seo";
import { strip_frontmatter } from "@/lib/ai-content";

type DocPage = {
  url: string;
  absolutePath?: string;
  data: { title?: string; description?: string };
};

const collections: Array<{ heading: string; pages: () => DocPage[] }> = [
  { heading: "Documentation", pages: () => source.getPages() as unknown as DocPage[] },
  { heading: "City SDK", pages: () => citySdkDocsSource.getPages() as unknown as DocPage[] },
  { heading: "Agent SDK", pages: () => agentSdkDocsSource.getPages() as unknown as DocPage[] },
  { heading: "Payments", pages: () => paymentsSource.getPages() as unknown as DocPage[] },
  { heading: "Plugins", pages: () => pluginsDocsSource.getPages() as unknown as DocPage[] },
  { heading: "UI SDK", pages: () => uiSdkDocsSource.getPages() as unknown as DocPage[] },
  { heading: "Blog", pages: () => blogSource.getPages() as unknown as DocPage[] },
];

async function render_page(page: DocPage): Promise<string | null> {
  if (!page.absolutePath) return null;

  let raw: string;
  try {
    raw = await readFile(page.absolutePath, "utf-8");
  } catch {
    return null;
  }

  const { body } = strip_frontmatter(raw);
  const title = page.data.title ?? page.url;
  const url = create_site_url(page.url);

  return [
    `### ${title}`,
    "",
    `Source: ${url}`,
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

  for (const collection of collections) {
    const rendered: string[] = [];
    for (const page of collection.pages()) {
      const block = await render_page(page);
      if (block) rendered.push(block);
    }
    if (rendered.length === 0) continue;

    sections.push(`## ${collection.heading}`, "", ...rendered);
  }

  return new Response(sections.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
