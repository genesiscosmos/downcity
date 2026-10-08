/**
 * 文档页 BreadcrumbList 构建模块。
 *
 * 六个文档集合共用该模块。面包屑层级与文档侧边栏可见导航一致：根层为文档空间入口，
 * 中间层为该语言的 slug 逐级路径，最后一层为当前页面自身。
 *
 * 名称优先取文档索引里对应层级的导航标题（与侧边栏完全一致），缺失时回退为 slug
 * 的标题化形式。每一层都合成出真实可访问的路径，禁止产出空 itemListElement 或
 * 无 URL 的条目。
 */
import { docs_index } from "@/lib/docs/docs-index";
import { create_docs_url } from "@/lib/docs/spaces";
import type { DocsPageRecord } from "@/lib/docs/types";
import { create_site_url } from "@/lib/seo";
import { docs_spaces } from "@/lib/docs/spaces";
import type { SeoBreadcrumbStructuredData } from "@/types/seo";

/** 把 slug 片段转换成兜底显示名。 */
function slug_to_label(slug: string): string {
  return slug
    .split("-")
    .map((part) => (part.length > 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

/** 取文档空间的显示名，未注册时回退到空间标识。 */
function space_label(space_id: string, lang: "en" | "zh"): string {
  const space = docs_spaces.find((item) => item.id === space_id);

  return space ? space.label[lang] : slug_to_label(space_id);
}

/**
 * 从文档索引构建当前页面的面包屑 JSON-LD。
 *
 * 根层固定是文档空间入口，因此集合根页（slug 为空）输出单层面包屑指向自身。
 */
export function create_doc_breadcrumb(page: DocsPageRecord): SeoBreadcrumbStructuredData {
  const placement = docs_index.get_placement(page.url);
  const ancestors = placement?.ancestors ?? [];
  const label_by_depth = new Map<number, string>();

  ancestors.forEach((ancestor, depth) => {
    if (ancestor.label.length > 0) label_by_depth.set(depth, ancestor.label);
  });

  const items: Array<{ name: string; pathname: string }> = [
    {
      name: space_label(page.space, page.locale),
      pathname: create_docs_url(page.space, page.locale, []),
    },
  ];

  // slug 逐级展开：中间层用导航标题，最后一层用页面标题，保证与侧边栏命名一致。
  page.slug.forEach((segment, depth) => {
    const is_last = depth === page.slug.length - 1;
    const name =
      (is_last ? page.title : undefined) ??
      label_by_depth.get(depth) ??
      slug_to_label(segment);

    items.push({
      name,
      pathname: create_docs_url(page.space, page.locale, page.slug.slice(0, depth + 1)),
    });
  });

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      position: index + 1,
      name: item.name,
      item: create_site_url(item.pathname),
    })),
  };
}
