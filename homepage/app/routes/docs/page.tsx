/**
 * 主文档空间路由（`/en/docs/*` 与 `/zh/docs/*`）。
 *
 * 加载、meta 与渲染全部复用文档共享实现，本文件只声明空间标识与检索关键词。
 *
 * 注意：loader 与渲染必须来自不同模块 —— loader 访问文档索引（依赖 `node:*`），
 * 而渲染与 `meta` 会进入客户端包。两者混在一个模块会让文档路由在浏览器里加载即失败。
 */
import { create_docs_loader } from "@/lib/docs/loader.server";
import { create_docs_meta, create_docs_page } from "@/lib/docs/docs-page";

export const loader = create_docs_loader("docs");
export const meta = create_docs_meta("docs", "Downcity, docs, products, SDKs, guide");

export default create_docs_page("docs");
