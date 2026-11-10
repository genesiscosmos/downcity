/** MarkdownView 自有节点映射；稳定引用保证流式内容的 memo 边界。 */
import type { StreamdownProps } from "streamdown";
import { MarkdownImage } from "./MarkdownImage";
import { SvgDiagram } from "./SvgDiagram";
import { MermaidDiagram } from "./mermaid/MermaidDiagram";

/** 自定义图表标签由清洗后的代码围栏转换产生，其他节点沿用 Streamdown。 */
export const markdown_components = {
  "mermaid-diagram": MermaidDiagram,
  "svg-diagram": SvgDiagram,
  img: MarkdownImage,
} as unknown as NonNullable<StreamdownProps["components"]>;
