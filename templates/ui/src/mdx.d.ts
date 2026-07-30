/** UI 模板本地 MDX 模块声明。 */

declare module "*.mdx" {
  import type { MdxDocumentComponent } from "./types/mdx.js";

  const Document: MdxDocumentComponent;
  export default Document;
}
