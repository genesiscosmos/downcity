/**
 * Homepage SEO URL 与页面元信息模块。
 *
 * 关键约束：
 * 1. 全站只使用 apex 域名作为 canonical 来源。
 * 2. HTML 页面统一使用尾斜杠，避免 canonical 指向会再次 308 的 URL。
 * 3. 多语言页面同时输出 self canonical、双向 hreflang 与 x-default。
 */
import type { MetaDescriptor } from "react-router";
import { product } from "@/lib/product";
import type { InterfaceLocale } from "@/types/interface-locale";
import type { SeoPageMetaOptions } from "@/types/seo";

export const site_origin = product.homepage ?? "https://downcity.ai";

/**
 * 把站内路径规范成 Cloudflare Pages 最终提供的公开路径。
 */
export function normalize_site_path(pathname: string) {
  const parsed_url = new URL(pathname || "/", site_origin);
  let normalized_path = parsed_url.pathname.replace(/\/{2,}/g, "/");
  const final_segment = normalized_path.split("/").filter(Boolean).at(-1) ?? "";
  const has_file_extension = final_segment.includes(".");

  if (normalized_path !== "/" && !normalized_path.endsWith("/") && !has_file_extension) {
    normalized_path = `${normalized_path}/`;
  }

  return normalized_path;
}

/**
 * 使用统一站点源生成绝对规范 URL。
 */
export function create_site_url(pathname: string) {
  return new URL(normalize_site_path(pathname), site_origin).toString();
}

/**
 * 判断 href 是否指向站外或非路径目标（外链、锚点、协议链接）。
 */
function is_external_href(href: string) {
  return (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) ||
    href.startsWith("//") ||
    href.startsWith("#")
  );
}

/**
 * 把站内 href 规范成带尾斜杠的最终公开路径。
 *
 * 为什么需要：站点规范 URL 一律带尾斜杠（见 normalize_site_path），但内链、MDX 正文
 * 与组件里的 href 大量写成无尾斜杠形态。Cloudflare Pages 会对无尾斜杠路径返回 308，
 * 导致每次站内跳转都多一跳、权重传递被削弱、抓取预算被浪费。
 *
 * 约束：外链、锚点、查询串与哈希片段原样保留；已有文件扩展名的路径不动。
 */
export function create_internal_href(href: string): string {
  if (!href || is_external_href(href)) return href;

  const hash_index = href.indexOf("#");
  const hash = hash_index >= 0 ? href.slice(hash_index) : "";
  const without_hash = hash_index >= 0 ? href.slice(0, hash_index) : href;
  const query_index = without_hash.indexOf("?");
  const query = query_index >= 0 ? without_hash.slice(query_index) : "";
  const pathname = query_index >= 0 ? without_hash.slice(0, query_index) : without_hash;

  if (!pathname.startsWith("/")) return href;

  return `${normalize_site_path(pathname)}${query}${hash}`;
}

/**
 * 判断公开路径使用的页面语言。
 */
export function get_path_locale(pathname: string): InterfaceLocale {
  return pathname === "/zh/" || pathname.startsWith("/zh/") ? "zh" : "en";
}

/**
 * 根据当前路径和可选对应路径生成英文、中文页面路径。
 */
function create_language_paths(pathname: string, alternate_pathname?: string) {
  const current_path = normalize_site_path(pathname);
  const current_locale = get_path_locale(current_path);
  const alternate_path = alternate_pathname
    ? normalize_site_path(alternate_pathname)
    : undefined;

  if (current_locale === "zh") {
    const english_path = alternate_path ?? normalize_site_path(current_path.replace(/^\/zh(?=\/)/, ""));
    return {
      current_locale,
      english_path,
      chinese_path: current_path,
    };
  }

  const is_explicit_english = current_path.startsWith("/en/");
  const chinese_path = alternate_path ?? normalize_site_path(
    is_explicit_english
      ? current_path.replace(/^\/en(?=\/)/, "/zh")
      : `/zh${current_path}`,
  );

  return {
    current_locale,
    english_path: current_path,
    chinese_path,
  };
}

/**
 * 生成路由完整 SEO 元信息。
 *
 * React Router 子路由的 meta 会覆盖父路由，因此这里一次性输出搜索引擎和社交
 * 分享所需的完整标签，避免部分页面只有 title 却丢失 canonical。
 */
export function create_page_meta(options: SeoPageMetaOptions): MetaDescriptor[] {
  const canonical_url = create_site_url(options.pathname);
  const image_url = create_site_url(options.image_pathname ?? "/og-image.png");
  const current_locale = get_path_locale(normalize_site_path(options.pathname));
  const open_graph_locale = current_locale === "zh" ? "zh_CN" : "en_US";
  const alternate_open_graph_locale = current_locale === "zh" ? "en_US" : "zh_CN";
  const meta: MetaDescriptor[] = [
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { title: options.title },
    { name: "description", content: options.description },
    { name: "robots", content: "index, follow" },
    { name: "googlebot", content: "index, follow" },
    { property: "og:title", content: options.title },
    { property: "og:description", content: options.description },
    { property: "og:type", content: options.open_graph_type ?? "website" },
    { property: "og:site_name", content: "Downcity" },
    { property: "og:locale", content: open_graph_locale },
    { property: "og:url", content: canonical_url },
    { property: "og:image", content: image_url },
    { name: "twitter:card", content: options.twitter_card ?? "summary_large_image" },
    { name: "twitter:site", content: "@downcity_ai" },
    { name: "twitter:title", content: options.title },
    { name: "twitter:description", content: options.description },
    { name: "twitter:image", content: image_url },
    { tagName: "link", rel: "canonical", href: canonical_url },
  ];

  if (options.keywords) {
    meta.push({ name: "keywords", content: options.keywords });
  }

  if (options.localized) {
    const language_paths = create_language_paths(
      options.pathname,
      options.alternate_pathname,
    );
    const english_url = create_site_url(language_paths.english_path);
    const chinese_url = create_site_url(language_paths.chinese_path);

    meta.push(
      { property: "og:locale:alternate", content: alternate_open_graph_locale },
      // hreflang 必须使用小写属性名：React Router 会把 meta 描述符的属性原样序列化进
      // HTML，驼峰 hrefLang 会输出非法属性名，导致全站语言注解被搜索引擎忽略
      // （React 19.2 SSR 实测：hrefLang 输出 <link hrefLang=...>，小写才输出合法属性）。
      { tagName: "link", rel: "alternate", hreflang: "en", href: english_url },
      { tagName: "link", rel: "alternate", hreflang: "zh-CN", href: chinese_url },
      { tagName: "link", rel: "alternate", hreflang: "x-default", href: english_url },
    );
  }

  return meta;
}
