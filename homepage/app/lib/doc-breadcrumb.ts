/**
 * 文档页 BreadcrumbList 构建模块。
 *
 * 六个文档集合（docs / city-sdk-docs / agent-sdk-docs / payments / plugins-docs /
 * ui-sdk-docs）共用该模块。面包屑层级必须与文档侧边栏可见导航一致：根层为文档区入口，
 * 中间层为目录（folder），最后一层为当前页面自身。
 */
import { create_site_url } from "@/lib/seo";
import type { SeoBreadcrumbStructuredData } from "@/types/seo";

/** Fumadocs 页面树节点中本模块关心的字段。 */
type TreeEntry = {
  name?: unknown;
  url?: unknown;
  children?: unknown;
  root?: { nodes?: unknown };
  nodes?: unknown;
};

/**
 * 兼容多种页面树形态（PageTree.root.nodes / 直接节点列表），返回顶层节点数组。
 */
function as_tree_nodes(tree: unknown): TreeEntry[] {
  if (!tree || typeof tree !== "object") return [];
  const candidate = tree as TreeEntry;
  if (Array.isArray(candidate.root?.nodes)) return candidate.root.nodes;
  if (Array.isArray(candidate.nodes)) return candidate.nodes;
  if (Array.isArray(candidate.children)) return candidate.children;
  return [];
}

/**
 * 深度优先收集每个页面 URL 对应的可见名称路径（从顶层目录到页面自身）。
 */
function collect_page_trails(
  node: TreeEntry | undefined,
  trail: string[],
  out: Map<string, string[]>,
) {
  if (!node || typeof node !== "object") return;

  const label = typeof node.name === "string" ? node.name : undefined;
  const next_trail = label ? [...trail, label] : trail;

  if (typeof node.url === "string" && next_trail.length > 0) {
    out.set(node.url, next_trail);
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collect_page_trails(child as TreeEntry, next_trail, out);
    }
  }
}

/** 把 URL 中的 slug 片段转换成兜底显示名。 */
function slug_to_label(slug: string) {
  return slug
    .split("-")
    .map((part) => (part.length > 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

/**
 * 各文档集合根入口的显示名，必须与导航中用户可见的集合名一致。
 */
const collection_names: Record<string, { en: string; zh: string }> = {
  docs: { en: "Docs", zh: "文档" },
  "city-sdk-docs": { en: "City SDK", zh: "City SDK" },
  "agent-sdk-docs": { en: "Agent SDK", zh: "Agent SDK" },
  payments: { en: "Payments", zh: "Payments" },
  "plugins-docs": { en: "Plugins", zh: "插件" },
  "ui-sdk-docs": { en: "UI SDK", zh: "UI SDK" },
};

/**
 * 从页面 URL、页面标题和页面树构建文档页面包屑 JSON-LD。
 *
 * 页面树中找不到对应 URL 时（例如新页面尚未进入 meta.json），回退为 slug 兜底名，
 * 保证任何文档页都输出合法且非空的 BreadcrumbList。
 */
export function create_doc_breadcrumb(options: {
  /** 当前文档页公开 URL，例如 /en/docs/agent/overview/。 */
  page_url: string;
  /** 当前文档页标题（来自 frontmatter），树缺失时作为最后一层名称。 */
  page_title: string;
  /** 当前页面语言。 */
  lang: "en" | "zh";
  /** Fumadocs source.getPageTree(lang) 的返回值。 */
  tree: unknown;
}): SeoBreadcrumbStructuredData {
  const { page_url, page_title, lang, tree } = options;

  const url_parts = page_url.split("/").filter(Boolean);
  // 前两段是语言前缀与文档集合前缀，例如 /en/docs/agent/overview/ → en, docs。
  const collection_prefix = url_parts.slice(0, 2).join("/");
  const slugs = url_parts.slice(2);

  const trails = new Map<string, string[]>();
  for (const root_node of as_tree_nodes(tree)) {
    collect_page_trails(root_node, [], trails);
  }
  const tree_trail = trails.get(page_url);

  // 树路径长度必须与 slug 数量一致才采信；否则回退为 slug 兜底名。
  const labels =
    tree_trail && tree_trail.length === slugs.length
      ? tree_trail
      : slugs.map((slug, index) =>
          index === slugs.length - 1 ? page_title : slug_to_label(slug),
        );

  const items: Array<{ name: string; pathname: string }> = [];

  // 集合入口始终作为第一层：叶子页从集合根开始，集合根页自身（slugs 为空）输出
  // 单层面包屑指向自身，禁止空 itemListElement。根层名称使用集合显示名而不是
  // 第一个目录名，否则 /en/docs/agent/overview/ 的根层会显示 "Agent" 却指向
  // /en/docs/。
  const collection_key = url_parts[1] ?? "docs";
  items.push({
    name: collection_names[collection_key]?.[lang] ?? slug_to_label(collection_key),
    pathname: `/${collection_prefix}/`,
  });

  slugs.forEach((slug, index) => {
    const is_last = index === slugs.length - 1;
    items.push({
      name: labels[index] ?? (is_last ? page_title : slug_to_label(slug)),
      pathname: `/${collection_prefix}/${slugs.slice(0, index + 1).join("/")}/`,
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
