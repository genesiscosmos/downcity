/**
 * Blog 列表页 loader（仅服务端）。
 *
 * 访问文档索引以获得阅读顺序；与渲染层分离的原因同文章页：索引依赖 `node:*`，
 * 混在同一模块会被打进浏览器包。
 */
import type { Route } from "./+types/index";
import { docs_index } from "@/lib/docs/docs-index";
import { normalize_site_path } from "@/lib/seo";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const lang: "en" | "zh" =
    url.pathname.startsWith("/zh/") || url.pathname === "/zh" ? "zh" : "en";

  // 顺序直接采用文档索引的阅读顺序（即 blog 的 meta.json 声明顺序），
  // 避免再引入一套需要手工维护的权重字段。
  const articles = docs_index.list_space_pages("blog", lang).map((page) => ({
    url: normalize_site_path(page.url),
    title: page.title,
    description: page.description,
  }));

  return { lang, articles };
}
