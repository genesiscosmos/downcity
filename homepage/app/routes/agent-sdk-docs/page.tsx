/**
 * Agent SDK 文档路由（`/en/agent-sdk-docs/*` 与 `/zh/agent-sdk-docs/*`）。
 */
import { create_docs_loader } from "@/lib/docs/loader.server";
import { create_docs_meta, create_docs_page } from "@/lib/docs/docs-page";

export const loader = create_docs_loader("agent-sdk-docs");
export const meta = create_docs_meta(
  "agent-sdk-docs",
  "Downcity, Agent SDK, sessions, powers, remote agent, API reference",
);

export default create_docs_page("agent-sdk-docs");
