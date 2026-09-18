import defaultMdxComponents from "fumadocs-ui/mdx";
import { Callout } from "fumadocs-ui/components/callout";
import { lazy, Suspense, type FC } from "react";
import type { MDXComponents } from "mdx/types";

/**
 * 按需加载 Mermaid。
 *
 * 为什么必须 lazy：`mermaid` 会连带引入 chroma-js、rough.js、graphlib 等一批依赖。
 * 只要本文件对它是静态 import，所有 MDX 页面（6 个文档空间 + blog，共 500+ 页）
 * 都会被写进这条依赖边，即使正文里一张图都没有。实测这部分在每个文档/文章页
 * 的预加载里约占 250 KB。
 *
 * 改成动态导入后，只有正文真的出现图表时才会去取这段代码。
 * 图表本身本来就是客户端渲染，因此渲染时机没有变化。
 */
const LazyMermaid = lazy(() =>
  import("../mermaid").then((module) => ({ default: module.Mermaid })),
);

const Mermaid: FC<{ chart: string }> = (props) => (
  <Suspense
    fallback={
      <div
        aria-hidden="true"
        className="my-6 h-48 animate-pulse rounded-lg border border-line bg-surface"
      />
    }
  >
    <LazyMermaid {...props} />
  </Suspense>
);

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Callout,
    Mermaid,
    ...components,
  };
}
