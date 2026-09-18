import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import {
  remarkImage,
  remarkHeading,
  remarkDirectiveAdmonition,
} from "fumadocs-core/mdx-plugins";
import { remarkMdxMermaid } from "fumadocs-core/mdx-plugins";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkDirective from "remark-directive";

export const docs = defineDocs({
  dir: "content/docs",
});

export const citySdkDocs = defineDocs({
  dir: "content/city-sdk-docs",
});

export const payments = defineDocs({
  dir: "content/payments",
});

export const uiSdkDocs = defineDocs({
  dir: "content/ui-sdk-docs",
});

export const agentSdkDocs = defineDocs({
  dir: "content/agent-sdk-docs",
});

export const pluginsDocs = defineDocs({
  dir: "content/plugins-docs",
});

export const blog = defineDocs({
  dir: "content/blog",
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: (v) => [
      ...v,
      remarkDirective,
      remarkDirectiveAdmonition,
      remarkMath,
      remarkImage,
      remarkHeading,
      remarkMdxMermaid,
    ],
    rehypePlugins: (v) => [[rehypeKatex, { strict: false }], ...v],
    remarkImageOptions: {
      placeholder: "none",
    },
  },
});
