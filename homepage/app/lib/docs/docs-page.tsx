/**
 * 文档空间页面渲染实现（客户端安全）。
 *
 * 该模块会被打进浏览器包，因此**只允许依赖纯数据与 UI 组件**：
 * - 数据来自 loader 返回值（`DocsRouteData`，定义在 `types.ts`），全部是可序列化字段；
 * - 正文组件来自 MDX 集合的浏览器加载器；
 * - 禁止引入 `docs-index`、`doc-breadcrumb` 或任何 `node:*` 模块。
 *
 * 曾经的实现把 loader 与页面渲染放在同一个文件里，导致 `node:fs` / `node:path`
 * 被一起打进客户端 chunk，文档路由在浏览器加载时直接抛错（`U.join is not a function`），
 * 表现为点击文档导航无法跳转。服务端逻辑因此拆到 `loader.server.ts`。
 */
import type { DocsRouteData } from "@/lib/docs/types";
import { docs_spaces } from "@/lib/docs/spaces";
import { create_docs_shell_labels } from "@/lib/docs/labels";
import { get_mdx_loader } from "@/lib/docs/mdx-client";
import { DocsArticle, DocsPager } from "@/components/docs/docs-page";
import { DocsContentLayout, DocsShell } from "@/components/docs/docs-shell";
import { DocsTableOfContents } from "@/components/docs/docs-toc";
import { create_page_meta } from "@/lib/seo";

/**
 * 空间标识到 MDX 集合名的映射。
 *
 * 集合名由 `source.config.ts` 的导出名决定，这里是两套命名之间的唯一转换点。
 */
const collection_keys: Record<string, string> = {
  docs: "docs",
  "city-sdk-docs": "citySdkDocs",
  "agent-sdk-docs": "agentSdkDocs",
  payments: "payments",
  "powers-docs": "powersDocs",
  "ui-sdk-docs": "uiSdkDocs",
};

/** 取某个空间的客户端正文加载器。 */
function get_client_loader(space_id: string) {
  return get_mdx_loader(collection_keys[space_id]);
}

/**
 * 创建某个文档空间的 meta 函数。
 *
 * 为什么放在客户端安全模块：React Router 会把 `meta` 导出保留在客户端包中
 * （只有 `loader` / `action` / `middleware` / `headers` 会被剔除），因此它不能位于
 * 引用了 `node:*` 的模块里。这里仅依赖纯数据与 `create_page_meta`。
 */
export function create_docs_meta(space_id: string, keywords: string) {
  return function meta({ loaderData }: { loaderData?: DocsRouteData }) {
    if (!loaderData) return [];

    const space = docs_spaces.find((item) => item.id === space_id);
    const space_label = space ? space.label[loaderData.locale] : space_id;

    return create_page_meta({
      title: `${loaderData.title} — Downcity ${space_label}`,
      description: loaderData.description || `Downcity ${space_label} documentation`,
      pathname: loaderData.url,
      keywords,
      image_pathname: "/og-image.png",
      localized: Boolean(loaderData.alternate_url),
      alternate_pathname: loaderData.alternate_url,
    });
  };
}

/**
 * 渲染某个文档空间。
 *
 * 正文通过浏览器集合按需加载：预渲染阶段只输出页面骨架与标题，正文由客户端加载器
 * 接管，使单页载荷不随文档总量增长。
 */
export function create_docs_page(space_id: string) {
  const client_loader = get_client_loader(space_id);

  return function DocsPage({ loaderData }: { loaderData: DocsRouteData }) {
    const Content = client_loader.getComponent(loaderData.content_path);
    const labels = create_docs_shell_labels(loaderData.locale, loaderData.space_id);

    return (
      <DocsShell
        space_id={loaderData.space_id}
        locale={loaderData.locale}
        tree={loaderData.tree}
        current_url={loaderData.url}
        alternate_url={loaderData.alternate_url}
        labels={labels}
      >
        {loaderData.breadcrumb_jsonld ? (
          <script
            type="application/ld+json"
            data-downcity-structured-data="breadcrumb"
            dangerouslySetInnerHTML={{ __html: loaderData.breadcrumb_jsonld }}
          />
        ) : null}
        <DocsContentLayout toc={<DocsTableOfContents items={loaderData.toc} title={labels.toc} />}>
          <DocsArticle
            title={loaderData.title}
            description={loaderData.description}
            raw_markdown={loaderData.raw_markdown}
            current_url={loaderData.url}
          >
            {Content ? <Content /> : null}
          </DocsArticle>
          <DocsPager previous={loaderData.previous} next={loaderData.next} />
        </DocsContentLayout>
      </DocsShell>
    );
  };
}
