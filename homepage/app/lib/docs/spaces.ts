/**
 * 文档空间注册表。
 *
 * 每个文档空间把「内容目录」「公开路径前缀」「导航显示名」绑成一条记录，是整个文档
 * 层唯一的空间事实来源。路由、侧边栏、面包屑、sitemap、llms 端点与预渲染扫描都从
 * 这里读取，新增文档空间只需要在 `docs_spaces` 里加一项。
 */
import type { DocsLocale, DocsSpaceId } from "./types";

/** 单个文档空间的静态定义。 */
export type DocsSpace = {
  /** 空间标识，等于 `content/<id>/` 目录名与公开路径前缀。 */
  id: DocsSpaceId;
  /** 侧边栏与面包屑使用的空间显示名。 */
  label: Record<DocsLocale, string>;
  /**
   * 该空间是否使用文档版式。
   *
   * blog 承载营销长文，不含侧边栏与右侧目录，因此单独标记。
   */
  uses_docs_layout: boolean;
};

/** 全部文档空间，顺序即 sitemap 与检索结果中的分组顺序。 */
export const docs_spaces: readonly DocsSpace[] = [
  {
    id: "docs",
    label: { en: "Docs", zh: "文档" },
    uses_docs_layout: true,
  },
  {
    id: "city-sdk-docs",
    label: { en: "City SDK", zh: "City SDK" },
    uses_docs_layout: true,
  },
  {
    id: "agent-sdk-docs",
    label: { en: "Agent SDK", zh: "Agent SDK" },
    uses_docs_layout: true,
  },
  {
    id: "payments",
    label: { en: "Payments", zh: "Payments" },
    uses_docs_layout: true,
  },
  {
    id: "powers-docs",
    label: { en: "Powers", zh: "Power" },
    uses_docs_layout: true,
  },
  {
    id: "ui-sdk-docs",
    label: { en: "UI SDK", zh: "UI SDK" },
    uses_docs_layout: true,
  },
  {
    id: "blog",
    label: { en: "Blog", zh: "文章" },
    uses_docs_layout: false,
  },
];

/** 站点支持的语言，顺序即语言切换器顺序。 */
export const docs_locales: readonly DocsLocale[] = ["en", "zh"];

/** 默认语言。无语言前缀的文档入口会重定向到该语言。 */
export const default_docs_locale: DocsLocale = "en";

/** 按 id 查找空间定义，未注册时返回 undefined。 */
export function find_docs_space(space_id: string): DocsSpace | undefined {
  return docs_spaces.find((space) => space.id === space_id);
}

/** 判断字符串是否为受支持的文档语言。 */
export function is_docs_locale(value: string): value is DocsLocale {
  return (docs_locales as readonly string[]).includes(value);
}

/**
 * 判断路径片段是否为语言前缀。
 *
 * 站点同时支持 `/en/docs/...` 与 `/zh/docs/...`，无前缀入口由重定向路由接管。
 */
export function is_docs_locale_segment(value: string): boolean {
  return is_docs_locale(value);
}

/**
 * 拼接空间内的一篇文档的公开 URL。
 *
 * 规则：语言段在前，空间前缀其次，slug 在后，一律带尾斜杠；slug 为空时即空间根页。
 */
export function create_docs_url(space: DocsSpaceId, locale: DocsLocale, slug: string[]): string {
  const segments = [locale, space, ...slug].filter((segment) => segment.length > 0);

  return `/${segments.join("/")}/`;
}

/**
 * 把公开 URL 还原为空间、语言与 slug。
 *
 * 这是 `create_docs_url` 的逆运算，用于路由参数解析与 sitemap 反向推导语言配对。
 * 无法解析为已注册空间时返回 undefined。
 */
export function parse_docs_url(
  pathname: string,
): { space: DocsSpace; locale: DocsLocale; slug: string[] } | undefined {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const [locale_segment, space_segment, ...slug] = segments;

  if (!locale_segment || !space_segment) return undefined;
  if (!is_docs_locale(locale_segment)) return undefined;

  const space = find_docs_space(space_segment);
  if (!space) return undefined;

  return { space, locale: locale_segment, slug };
}

/**
 * 生成同一文档在另一种语言下的候选 URL。
 *
 * 该 URL 是否真实存在需要由页面表校验，本函数只负责按规则推导。
 */
export function create_alternate_docs_url(
  space: DocsSpaceId,
  locale: DocsLocale,
  slug: string[],
): string {
  const alternate_locale: DocsLocale = locale === "en" ? "zh" : "en";

  return create_docs_url(space, alternate_locale, slug);
}
