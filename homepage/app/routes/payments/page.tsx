/**
 * Payments 文档路由（`/en/payments/*` 与 `/zh/payments/*`）。
 */
import { create_docs_loader } from "@/lib/docs/loader.server";
import { create_docs_meta, create_docs_page } from "@/lib/docs/docs-page";

export const loader = create_docs_loader("payments");
export const meta = create_docs_meta(
  "payments",
  "Downcity, payments, accounts, credits, usage, billing",
);

export default create_docs_page("payments");
