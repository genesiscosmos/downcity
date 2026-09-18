import { loader } from "fumadocs-core/source";
import { blog } from "../../.source/server";
import { i18n } from "./i18n";

/**
 * Downcity 文章（Blog）source 装载模块。
 *
 * 说明：
 * 1. 与 docs / city-sdk-docs 等文档空间平级，但承载的是信息型营销内容（术语页、
 *    对比页、长文），不是产品手册，因此路由层不使用 DocsLayout 侧边栏。
 * 2. 公开 URL 形如 `/en/blog/<slug>/` 与 `/zh/blog/<slug>/`，与其它 space 的语言
 *    路径约定保持一致，canonical、hreflang 与 sitemap 可直接复用既有逻辑。
 */
export const blogSource = loader({
  baseUrl: "/blog",
  source: blog.toFumadocsSource(),
  i18n,
});
