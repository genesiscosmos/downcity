/**
 * Downcity 文章（Blog）路由。
 *
 * 关键说明：
 * 1. 公开 URL 为 `/en/blog/<slug>/` 与 `/zh/blog/<slug>/`，与其它内容空间的
 *    语言路径约定一致，canonical、hreflang 与 sitemap 直接复用既有逻辑。
 * 2. 版式是营销文章，不是文档：不挂 DocsLayout 侧边栏，所以 root.tsx 的
 *    `showGlobalChrome` 判定会为真，navbar 与 Footer 正常显示。
 * 3. H1 由本页从 frontmatter 输出，MDX 正文因此禁止再写 `# 标题`，
 *    避免出现两个 h1（文档区当前就存在这个重复标题问题）。
 */
import type { Route } from "./+types/page";
import type { MDXComponents } from "mdx/types";
import type { ComponentType } from "react";
import React from "react";
import { Link } from "react-router";
import { readFile } from "fs/promises";
import { blogSource } from "@/lib/blog-source";
import { getMDXComponents } from "@/components/docs/mdx-components";
import browserCollections from "fumadocs-mdx:collections/browser";
import { Footer } from "@/components/sections/Footer";
import { create_page_meta } from "@/lib/seo";
import {
  create_article_structured_data,
  serialize_structured_data,
} from "@/lib/structured-data";

/** 文章首次发布的固定日期，用于 JSON-LD 的 datePublished。 */
const PUBLISHED_AT = "2026-09-18";

/**
 * 从 MDX frontmatter 读取每篇文章自己的 keywords。
 *
 * 为什么要手工解析：fumadocs 的 `page.data` 只暴露内置字段，自定义 frontmatter
 * 不会透出，直接用 `page.data.keywords` 会静默拿到 undefined 并回退成硬编码值，
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
  const rawPath = params["*"] ?? "";
  const lang =
    url.pathname.startsWith("/zh/") || url.pathname === "/zh" ? "zh" : "en";

  const slugs = rawPath.split("/").filter((value: string) => value.length > 0);
  const langIndex = slugs.findIndex((slug: string) => slug === "en" || slug === "zh");
  const cleanSlugs = langIndex >= 0 ? slugs.slice(langIndex + 1) : slugs;

  const page = blogSource.getPage(cleanSlugs, lang);
  if (!page) {
    throw new Response("Not found", { status: 404 });
  }

  const alternate_page = blogSource.getPage(
    cleanSlugs,
    lang === "en" ? "zh" : "en",
  );

  const title = page.data.title ?? "Downcity Blog";
  const description = page.data.description ?? "";

  // keywords 按文章各自的 frontmatter 输出，避免所有文章共用同一组关键词。
  let raw_markdown = "";
  if (page.absolutePath) {
    try {
      raw_markdown = await readFile(page.absolutePath, "utf-8");
    } catch {
      // 读取失败不影响页面渲染，keywords 回退为通用值
    }
  }
  const keywords =
    read_frontmatter_keywords(raw_markdown) ??
    "agent harness, agent runtime, Downcity";

  const article_jsonld = serialize_structured_data(
    create_article_structured_data({
      title,
      description,
      pathname: page.url,
      date_published: PUBLISHED_AT,
      lang,
    }),
  );

  return {
    path: page.path,
    url: page.url,
    title,
    description,
    keywords,
    alternate_url: alternate_page?.url,
    article_jsonld,
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];

  return create_page_meta({
    title: `${loaderData.title} — Downcity`,
    description: loaderData.description,
    pathname: loaderData.url,
    keywords: loaderData.keywords,
    open_graph_type: "article",
    twitter_card: "summary_large_image",
    localized: Boolean(loaderData.alternate_url),
    alternate_pathname: loaderData.alternate_url,
  });
}

const clientLoader = browserCollections.blog.createClientLoader({
  id: "blog",
  component: ({
    default: Mdx,
    frontmatter,
  }: {
    default: ComponentType<{ components?: MDXComponents }>;
    frontmatter: { title?: string; description?: string };
  }) => (
    <article className="mx-auto max-w-[46rem] px-5 py-16 md:px-8 md:py-24">
      <header className="space-y-4">
        <p className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-text-subtle">
          Blog
        </p>
        <h1 className="font-serif text-[clamp(2rem,4.5vw,3rem)] font-bold leading-[1.1] tracking-[-0.03em] text-foreground">
          {frontmatter.title}
        </h1>
        {frontmatter.description ? (
          <p className="max-w-2xl text-base leading-[1.7] text-text-soft">
            {frontmatter.description}
          </p>
        ) : null}
      </header>
      <div className="prose mt-12 max-w-none">
        <Mdx components={getMDXComponents()} />
      </div>
      <footer className="mt-16 border-t border-line pt-8">
        <Link
          to="/en/blog/what-is-an-agent-harness/"
          className="text-sm font-medium text-foreground underline underline-offset-4"
        >
          Back to top
        </Link>
      </footer>
    </article>
  ),
});

export default function Page({ loaderData }: Route.ComponentProps) {
  // fumadocs 的 client loader 返回 `FC<undefined>`，与 React.ComponentType<{}> 不兼容，
  // 这里收窄为无 props 的组件类型后渲染。
  const Content = clientLoader.getComponent(loaderData.path) as unknown as
    | React.ComponentType
    | undefined;

  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        data-downcity-structured-data="article"
        dangerouslySetInnerHTML={{ __html: loaderData.article_jsonld }}
      />
      <main>{Content ? <Content /> : null}</main>
      <Footer />
    </div>
  );
}
