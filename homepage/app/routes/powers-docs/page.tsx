/**
 * Powers 文档路由（`/en/powers-docs/*` 与 `/zh/powers-docs/*`）。
 */
import { create_docs_loader } from "@/lib/docs/loader.server";
import { create_docs_meta, create_docs_page } from "@/lib/docs/docs-page";

export const loader = create_docs_loader("powers-docs");
export const meta = create_docs_meta(
  "powers-docs",
  "Downcity, agent powers, built-in powers, power development",
);

export default create_docs_page("powers-docs");
