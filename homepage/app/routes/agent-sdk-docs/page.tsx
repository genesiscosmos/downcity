import type { Route } from "./+types/page";
import type { MDXComponents } from "mdx/types";
import type { ComponentType } from "react";
import type { TOCItemType } from "fumadocs-core/toc";
import { readFile } from "fs/promises";
import React from "react";
import { redirect } from "react-router";
import { agentSdkDocsSource } from "@/lib/agent-sdk-docs-source";
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
} from "fumadocs-ui/page";
import { getMDXComponents } from "@/components/docs/mdx-components";
import browserCollections from "fumadocs-mdx:collections/browser";
import {
  CopyMarkdownButton,
  RawMarkdownContext,
} from "@/components/docs/copy-markdown-button";
import { create_page_meta } from "@/lib/seo";
import { create_doc_breadcrumb } from "@/lib/doc-breadcrumb";
import { serialize_structured_data } from "@/lib/structured-data";

type PageTreeNode = {
  type?: string;
  url?: string;
  children?: PageTreeNode[];
};

/**
 * 递归按侧边栏顺序收集 Agent SDK 文档 URL，用于目录页跳转。
 */
function collectPageUrls(node: PageTreeNode | undefined, out: string[]) {
  if (!node) return;
  if (node.type === "page" && typeof node.url === "string") {
    out.push(node.url);
  }
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) {
    collectPageUrls(child, out);
  }
}

/**
 * 当请求的是目录路径时，返回该目录下第一个子文档 URL。
 */
function findFirstChildDocUrl(lang: "en" | "zh", slugs: string[]) {
  if (slugs.length === 0) return undefined;
  const tree = agentSdkDocsSource.getPageTree(lang) as PageTreeNode | undefined;
  if (!tree) return undefined;

  const urls: string[] = [];
  collectPageUrls(tree, urls);

  const prefix = `/${lang}/agent-sdk-docs/${slugs.join("/")}/`;
  return urls.find((item) => item.startsWith(prefix));
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const rawPath = params["*"] ?? "";
  const lang =
    url.pathname.startsWith("/zh/") || url.pathname === "/zh" ? "zh" : "en";

  const slugs = rawPath.split("/").filter((v) => v.length > 0);
  const langIndex = slugs.findIndex((s) => s === "en" || s === "zh");
  const cleanSlugs = langIndex >= 0 ? slugs.slice(langIndex + 1) : slugs;

  const firstChild = findFirstChildDocUrl(lang, cleanSlugs);
  if (firstChild) {
    throw redirect(`${firstChild}${url.search}${url.hash}`, { status: 302 });
  }

  const page = agentSdkDocsSource.getPage(cleanSlugs, lang);
  if (!page) {
    throw new Response("Not found", { status: 404 });
  }
  const alternate_lang = lang === "en" ? "zh" : "en";
  const alternate_page = agentSdkDocsSource.getPage(cleanSlugs, alternate_lang);

  let rawMarkdown = "";
  if (page.absolutePath) {
    try {
      rawMarkdown = await readFile(page.absolutePath, "utf-8");
    } catch {
      // 读取失败时不影响页面渲染
    }
  }

  // 面包屑 JSON-LD 在 loader 内序列化为最终字符串：页面树不进入 loader 返回值，
  // 避免被 React Router 序列化进每个文档页的客户端载荷。
  const breadcrumb_jsonld = serialize_structured_data(
    create_doc_breadcrumb({
      page_url: page.url,
      page_title: page.data.title ?? "Agent SDK Docs",
      lang,
      tree: agentSdkDocsSource.getPageTree(lang),
    }),
  );

  return {
    path: page.path,
    url: page.url,
    breadcrumb_jsonld,
    alternate_url: alternate_page?.url,
    title: page.data.title ?? "Agent SDK Docs",
    description: page.data.description ?? "",
    rawMarkdown,
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];

  const title = `${loaderData.title} — Downcity Agent SDK Docs`;
  const description = loaderData.description || "Downcity Agent SDK documentation";

  return create_page_meta({
    title,
    description,
    pathname: loaderData.url,
    keywords: "Downcity, Agent SDK, agent-sdk-docs, sessions, plugins, api",
    image_pathname: "/og-image.png",
    localized: Boolean(loaderData.alternate_url),
    alternate_pathname: loaderData.alternate_url,
  });
}

const clientLoader = browserCollections.agentSdkDocs.createClientLoader({
  id: "agentSdkDocs",
  component: ({
    default: Mdx,
    frontmatter,
    toc,
  }: {
    default: ComponentType<{ components?: MDXComponents }>;
    frontmatter: { title?: string; description?: string };
    toc?: TOCItemType[];
  }) => (
    <DocsPage toc={Array.isArray(toc) ? toc : []}>
      <div className="flex items-center justify-between gap-4">
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <CopyMarkdownButton />
      </div>
      <DocsDescription>{frontmatter.description}</DocsDescription>
      <DocsBody>
        <Mdx components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  ),
});

export default function Page({ loaderData }: Route.ComponentProps) {
  const { path, rawMarkdown } = loaderData;
  const Content: any = clientLoader.getComponent(path);

  return (
    <RawMarkdownContext.Provider value={rawMarkdown ?? ""}>
      {loaderData.breadcrumb_jsonld ? (
        <script
          type="application/ld+json"
          data-downcity-structured-data="breadcrumb"
          dangerouslySetInnerHTML={{ __html: loaderData.breadcrumb_jsonld }}
        />
      ) : null}
      {React.createElement(Content)}
    </RawMarkdownContext.Provider>
  );
}
