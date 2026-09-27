import defaultMdxComponents from "fumadocs-ui/mdx";
import { Callout } from "fumadocs-ui/components/callout";
import { lazy, Suspense, type ComponentProps, type FC } from "react";
import type { MDXComponents } from "mdx/types";
import { create_internal_href } from "@/lib/seo";

/**
 * MDX 正文锚点组件。
 *
 * 为什么需要覆盖：站点规范 URL 一律带尾斜杠，但 MDX 正文里的站内链接大量写成
 * 无尾斜杠形态（实测 6 个文档空间 + blog 共 359 个不同路径、841 处引用）。
 * 每一条都会让 Cloudflare Pages 返回 308，使正文链接的权重传递被额外跳转削弱。
 *
 * 在这里集中规范化 href，比逐个修改 MDX 源文件更安全：新增内容也不会再写错，
 * 且外链、锚点、查询串与哈希片段都原样保留。
 */
const DefaultAnchor = defaultMdxComponents.a as FC<ComponentProps<"a">>;

const Anchor: FC<ComponentProps<"a">> = ({ href, ...props }) => (
  <DefaultAnchor {...props} href={href ? create_internal_href(href) : href} />
);

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
    a: Anchor,
    Callout,
    Mermaid,
    ...components,
  };
}
