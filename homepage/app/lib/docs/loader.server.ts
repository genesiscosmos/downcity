/**
 * 文档空间 loader（仅服务端）。
 *
 * 该模块只在服务端引用：它读取磁盘上的 MDX 源文件、访问文档索引（依赖 `node:fs` /
 * `node:path`），并在目录路径上做重定向。**渲染层与 `meta` 不得从这里取值**，
 * 否则会把服务端依赖打进浏览器包，导致文档路由在客户端加载时直接抛错
 * （实测：客户端 chunk 执行 `process.cwd()` 报 `U.join is not a function`）。
 *
 * 页面渲染与 meta 分别在 `docs-page.tsx`（客户端安全）。
 *
 * 关键约定：
 * 1. URL 是语言的唯一事实来源：`/en/...` 与 `/zh/...` 分别渲染对应语言的正文。
 * 2. 目录路径 302 到首个后代页面，不留空壳页；预渲染产物因此是 noindex 跳转页。
 * 3. 面包屑 JSON-LD 在 loader 内序列化成字符串，页面树不进入客户端载荷。
 */
import { readFile } from "node:fs/promises";
import { redirect } from "react-router";
import { docs_index } from "@/lib/docs/docs-index";
import { docs_spaces, is_docs_locale } from "@/lib/docs/spaces";
import type { DocsLocale, DocsNavNode, DocsPageRecord, DocsRouteData } from "@/lib/docs/types";
import { create_doc_breadcrumb } from "@/lib/doc-breadcrumb";
import { serialize_structured_data } from "@/lib/structured-data";

/** 从请求路径解析语言，未知时使用默认语言。 */
function resolve_locale(pathname: string): DocsLocale {
  const segment = pathname.split("/").filter(Boolean)[0];

  return segment && is_docs_locale(segment) ? segment : "en";
}

/** 把路由参数解析为空间与 slug。 */
function resolve_route(space_id: string, params: Record<string, string | undefined>) {
  const space = docs_spaces.find((item) => item.id === space_id);
  if (!space) return undefined;

  const segments = (params["*"] ?? "").split("/").filter((segment) => segment.length > 0);
  // 显式语言路径下 splat 偶尔会带上语言段，统一剔除，避免 slug 混入语言前缀。
  const locale_index = segments.findIndex((segment) => is_docs_locale(segment));
  const slug = locale_index >= 0 ? segments.slice(locale_index + 1) : segments;

  return { space, slug };
}

/**
 * 找出某个目录路径应跳转到的首个后代页面。
 *
 * 只接受非 section 的页面，避免跳到另一个同样会重定向的目录页而形成跳转链。
 */
function find_first_descendant_url(
  tree: readonly DocsNavNode[],
  prefix: string,
): string | undefined {
  const flatten = (
    nodes: readonly DocsNavNode[],
  ): Array<{ url?: string; is_section: boolean }> =>
    nodes.flatMap((node) => [
      { url: node.url, is_section: node.is_section },
      ...flatten(node.children ?? []),
    ]);

  return flatten(tree).find(
    (item) =>
      item.url !== undefined &&
      item.url !== prefix &&
      item.url.startsWith(prefix) &&
      !item.is_section,
  )?.url;
}

/**
 * 创建某个文档空间的 loader。
 *
 * 承担三件事：解析 slug、按目录语义重定向、收集渲染所需数据。面包屑在此序列化完成。
 */
export function create_docs_loader(space_id: string) {
  return async function loader({
    params,
    request,
  }: {
    /** 路由参数，`*` 为空间内的 slug。 */
    params: Record<string, string | undefined>;
    /** 原始请求，用于解析语言、查询串与哈希。 */
    request: Request;
  }): Promise<DocsRouteData> {
    const route = resolve_route(space_id, params);
    if (!route) throw new Response("Not found", { status: 404 });

    const { space, slug } = route;
    const request_url = new URL(request.url);
    const locale = resolve_locale(request_url.pathname);
    const page = docs_index.find_page(space.id, locale, slug);
    if (!page) throw new Response("Not found", { status: 404 });

    const tree = docs_index.get_tree(space.id, locale);

    // 目录路径统一跳转到首个后代页面，不留无正文的跳转壳页。
    if (page.is_section) {
      const descendant_url = find_first_descendant_url(tree, page.url);
      if (descendant_url) {
        throw redirect(`${descendant_url}${request_url.search}${request_url.hash}`, { status: 302 });
      }
    }

    const placement = docs_index.get_placement(page.url);

    // 读取原始 Markdown 供复制按钮使用；失败不影响正文渲染。
    let raw_markdown = "";
    if (page.absolute_path) {
      try {
        raw_markdown = await readFile(page.absolute_path, "utf-8");
      } catch {
        raw_markdown = "";
      }
    }

    return {
      space_id: space.id,
      locale,
      url: page.url,
      title: page.title,
      description: page.description,
      content_path: page.content_path,
      raw_markdown,
      tree,
      toc: page.toc,
      previous: placement?.previous,
      next: placement?.next,
      alternate_url: docs_index.get_alternate_url(page),
      breadcrumb_jsonld: serialize_structured_data(create_doc_breadcrumb(page)),
    };
  };
}

/**
 * 取某篇文档的原始 Markdown 文本。
 *
 * 独立导出供 blog 等其它内容空间复用，避免它们各自拼装磁盘读取逻辑。
 */
export async function read_page_markdown(page: DocsPageRecord): Promise<string> {
  if (!page.absolute_path) return "";

  try {
    return await readFile(page.absolute_path, "utf-8");
  } catch {
    return "";
  }
}
