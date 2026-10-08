/**
 * City SDK 文档路由（`/en/city-sdk-docs/*` 与 `/zh/city-sdk-docs/*`）。
 */
import { create_docs_loader } from "@/lib/docs/loader.server";
import { create_docs_meta, create_docs_page } from "@/lib/docs/docs-page";

export const loader = create_docs_loader("city-sdk-docs");
export const meta = create_docs_meta(
  "city-sdk-docs",
  "Downcity, City SDK, agent host, workspace, canvas, API",
);

export default create_docs_page("city-sdk-docs");
