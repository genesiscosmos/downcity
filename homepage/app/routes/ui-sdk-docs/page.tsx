/**
 * UI SDK 文档路由（`/en/ui-sdk-docs/*` 与 `/zh/ui-sdk-docs/*`）。
 *
 * 组件页通过 `<ComponentPreview>` 渲染真实组件，因此这个空间的正文本身就是组件的
 * 活文档，展示代码与运行代码来自同一份示例文件。
 */
import { create_docs_loader } from "@/lib/docs/loader.server";
import { create_docs_meta, create_docs_page } from "@/lib/docs/docs-page";

export const loader = create_docs_loader("ui-sdk-docs");
export const meta = create_docs_meta(
  "ui-sdk-docs",
  "Downcity, UI SDK, UI components, design system, react, tailwind",
);

export default create_docs_page("ui-sdk-docs");
