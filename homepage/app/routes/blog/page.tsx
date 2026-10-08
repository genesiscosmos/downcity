/**
 * Blog 文章页路由。
 *
 * 关键说明：
 * 1. 公开 URL 为 `/en/blog/<slug>/` 与 `/zh/blog/<slug>/`，与其它内容空间的
 *    语言路径约定一致，canonical、hreflang 与 sitemap 直接复用既有逻辑。
 * 2. 版式是营销文章，不是文档：不挂文档侧边栏，因此 root.tsx 的 `showGlobalChrome`
 *    判定为真，navbar 与 Footer 正常显示。
 * 3. H1 由本页从 loader 数据输出，MDX 正文因此禁止再写 `# 标题`，避免出现两个 h1。
 * 4. loader 位于 `loader.server.ts`：它读取磁盘并访问文档索引，不能与渲染代码
 *    同处一个模块，否则服务端依赖会被打进浏览器包。
 */
import { type Route } from "./+types/page";
import { createElement, type ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { get_mdx_loader } from "@/lib/docs/mdx-client";
import { Footer } from "@/components/sections/Footer";
import { create_page_meta } from "@/lib/seo";

export { loader } from "./loader.server";

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

/** 文章正文加载器：按内容路径取编译后的 MDX 组件。 */
const client_loader = get_mdx_loader("blog");

/**
 * 用文章版式包裹正文。
 *
 * 标题与摘要在服务端输出：预渲染产物必须自带唯一的 H1，浏览器才能在不执行脚本时
 * 也得到完整语义。加载器只提供正文组件。
 */
function ArticleBody({
  title,
  description,
  children,
}: {
  /** 文章标题，输出为唯一的 H1。 */
  title: string;
  /** 文章摘要，为空时不渲染。 */
  description: string;
  /** MDX 正文。 */
  children: ReactNode;
}) {
  const { i18n } = useTranslation("home");
  const is_zh = i18n.language === "zh";

  return (
    <article className="mx-auto max-w-[46rem] px-5 py-16 md:px-8 md:py-24">
      <header className="mb-12 space-y-4">
        <p className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-text-subtle">
          {is_zh ? "文章" : "Blog"}
        </p>
        <h1 className="font-serif text-[clamp(2rem,4.5vw,3rem)] font-bold leading-[1.1] tracking-[-0.03em] text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-base leading-[1.7] text-text-soft">{description}</p>
        ) : null}
      </header>
      <div className="docs-markdown">{children}</div>
      <footer className="mt-16 border-t border-line pt-8">
        <Link
          to={is_zh ? "/zh/blog/" : "/en/blog/"}
          className="text-sm font-medium text-foreground underline underline-offset-4"
        >
          {is_zh ? "返回文章列表" : "Back to all articles"}
        </Link>
      </footer>
    </article>
  );
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const Content = client_loader.getComponent(loaderData.content_path);

  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        data-downcity-structured-data="article"
        dangerouslySetInnerHTML={{ __html: loaderData.article_jsonld }}
      />
      <main>
        <ArticleBody title={loaderData.title} description={loaderData.description}>
          {Content ? createElement(Content) : null}
        </ArticleBody>
      </main>
      <Footer />
    </div>
  );
}
