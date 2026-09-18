/**
 * Blog 列表页（`/en/blog/` 与 `/zh/blog/`）。
 *
 * 说明：
 * 1. 文章数量达到 3 篇后，裸 `/blog` 单向 301 到首篇已不合理；这里提供真正的
 *    列表页，既是新内容的入口，也是站内链接的枢纽。
 * 2. 排序采信 `content/blog/<lang>/meta.json` 的 pages 顺序（即阅读顺序），
 *    避免再引入一套需要手工维护的权重字段。
 * 3. 文案从 page data 取（title / description 均为字符串），不直接遍历 page tree
 *    的 name/description，因为后者是 ReactNode，不适合当纯文本使用。
 */
import type { Route } from "./+types/index";
import { Footer } from "@/components/sections/Footer";
import { blogSource } from "@/lib/blog-source";
import { create_page_meta, normalize_site_path } from "@/lib/seo";

type TreeNode = {
  type?: string;
  url?: string;
  children?: TreeNode[];
};

/** 按 page tree 顺序收集文章 URL。 */
function collect_page_urls(node: TreeNode | undefined, out: string[]) {
  if (!node) return;
  if (node.type === "page" && typeof node.url === "string") {
    out.push(node.url);
  }
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) {
    collect_page_urls(child, out);
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const lang: "en" | "zh" =
    url.pathname.startsWith("/zh/") || url.pathname === "/zh" ? "zh" : "en";

  const urls: string[] = [];
  collect_page_urls(blogSource.getPageTree(lang) as TreeNode, urls);

  const pages_by_url = new Map(
    blogSource.getPages(lang).map((page) => [page.url, page]),
  );

  const articles = urls
    .map((page_url) => {
      const page = pages_by_url.get(page_url);
      if (!page) return null;
      return {
        url: normalize_site_path(page.url),
        title: page.data.title ?? page.url,
        description: page.data.description ?? "",
      };
    })
    .filter((item): item is { url: string; title: string; description: string } =>
      item !== null,
    );

  return { lang, articles };
}

export function meta({ location }: Route.MetaArgs) {
  const is_chinese = location.pathname.startsWith("/zh");

  return create_page_meta({
    title: is_chinese
      ? "Agent Harness 与 Agent 产品化：全部文章 — Downcity"
      : "Agent Harness and Agent Productization: All Articles — Downcity",
    description: is_chinese
      ? "Downcity 全部文章：Agent Harness 是什么、内部构造、与 MCP 的关系，以及智能体框架选型。"
      : "Every Downcity article: what an agent harness is, its anatomy, how it relates to MCP, and how to choose an agent framework.",
    pathname: location.pathname,
    keywords: is_chinese
      ? "agent harness, 智能体框架, AI Agent 架构, MCP, Downcity 文章"
      : "agent harness, agent runtime, MCP, agent framework, Downcity blog",
    twitter_card: "summary_large_image",
    localized: true,
    // 显式给出另一语言路径：/en/blog/ 与 /zh/blog/ 不属于「去掉语言前缀」的推导规则，
    // 交给 create_page_meta 推导会把 /zh/blog/ 的英文对错算成 /blog/。
    alternate_pathname: is_chinese ? "/en/blog/" : "/zh/blog/",
  });
}

export default function BlogIndex({ loaderData }: Route.ComponentProps) {
  const { lang, articles } = loaderData;
  const is_zh = lang === "zh";

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-[46rem] px-5 py-16 md:px-8 md:py-24">
        <header className="space-y-4">
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-text-subtle">
            Blog
          </p>
          <h1 className="font-serif text-[clamp(2rem,4.5vw,3rem)] font-bold leading-[1.1] tracking-[-0.03em] text-foreground">
            {is_zh ? "文章" : "Articles"}
          </h1>
          <p className="max-w-2xl text-base leading-[1.7] text-text-soft">
            {is_zh
              ? "关于 Agent Harness、Agent 产品化与运行时的长文。"
              : "Long-form pieces on the agent harness, agent productization, and the runtime layer."}
          </p>
        </header>

        <ul className="mt-12 space-y-px overflow-hidden rounded-[14px] bg-line">
          {articles.map((article) => (
            <li key={article.url}>
              {/*
                用原生 a 而非 <Link>：
                1. <Link> 会把 `/en/blog/x/` 归一化成不带尾斜杠的形式，而站点 canonical
                   带尾斜杠，结果是每次点击多一跳 308。列表页的主要作用就是内部链接，
                   href 应当与 canonical 完全一致。
                2. 代价是列表到详情走整页导航，对文章页这种体量可以接受。
              */}
              <a
                href={article.url}
                className="group block bg-card p-6 transition-colors hover:bg-background md:p-8"
              >
                <h2 className="font-serif text-[1.25rem] font-semibold tracking-[-0.02em] text-foreground">
                  {article.title}
                </h2>
                {article.description ? (
                  <p className="mt-3 text-sm leading-[1.7] text-text-soft">
                    {article.description}
                  </p>
                ) : null}
                <span className="mt-4 inline-block text-sm font-medium text-foreground underline-offset-4 group-hover:underline">
                  {is_zh ? "阅读" : "Read"}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </main>
      <Footer />
    </div>
  );
}
