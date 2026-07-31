/**
 * UI 展示应用的 Vite 与 MDX 构建配置。
 *
 * 本地可信 MDX 在构建阶段编译，fenced code 通过 Shiki 转为高亮 HAST；
 * 浏览器运行时不加载 MDX 编译器或语法高亮引擎。
 */

import { compile } from "@mdx-js/mdx";
import tailwindcss from "@tailwindcss/vite";
import remarkGfm from "remark-gfm";
import { createHighlighter, type Highlighter } from "shiki";
import { defineConfig, type Plugin } from "vite";

import type { MdxHastNode } from "./src/types/mdx.js";

/** 读取 HAST 子树中的原始文本。 */
function read_hast_text(node: MdxHastNode): string {
  if (node.type === "text") return node.value ?? "";
  return node.children?.map(read_hast_text).join("") ?? "";
}

/** 从 fenced code 的 className 中读取语言名称。 */
function read_code_language(node: MdxHastNode): string {
  const class_names = node.properties?.className;
  const values = Array.isArray(class_names) ? class_names : [class_names];
  const language_class = values.find(
    (value): value is string => typeof value === "string" && value.startsWith("language-"),
  );
  return language_class?.slice("language-".length) || "text";
}

/** 创建使用共享 Highlighter 的 rehype 插件。 */
function create_rehype_shiki(highlighter: Highlighter) {
  return () => async (tree: MdxHastNode) => {
    const highlight_nodes = async (node: MdxHastNode): Promise<void> => {
      const code_node = node.tagName === "pre" ? node.children?.[0] : undefined;
      if (code_node?.tagName === "code") {
        const raw_code = read_hast_text(code_node).replace(/\n$/, "");
        const language = read_code_language(code_node);
        const supported_language = highlighter.getLoadedLanguages().includes(language)
          ? language
          : "text";
        const highlighted_root = highlighter.codeToHast(raw_code, {
          lang: supported_language,
          theme: "github-light",
        }) as MdxHastNode;
        const highlighted_pre = highlighted_root.children?.[0];
        if (highlighted_pre) {
          node.properties = {
            ...highlighted_pre.properties,
            "data-language": language,
            "data-raw": raw_code,
          };
          node.children = highlighted_pre.children;
        }
        return;
      }

      await Promise.all((node.children ?? []).map(highlight_nodes));
    };

    await highlight_nodes(tree);
  };
}

/** 创建只处理本地 `.mdx` 文件的 Vite 插件。 */
function create_mdx_plugin(highlighter: Highlighter): Plugin {
  return {
    name: "downcity-ui-mdx",
    enforce: "pre",
    async transform(source, id) {
      if (!id.endsWith(".mdx")) return null;
      const compiled = await compile(source, {
        jsxImportSource: "react",
        remarkPlugins: [remarkGfm],
        rehypePlugins: [create_rehype_shiki(highlighter)],
      });
      return { code: String(compiled), map: null };
    },
  };
}

export default defineConfig(async () => {
  const highlighter = await createHighlighter({
    themes: ["github-light"],
    langs: ["text", "tsx", "typescript", "jsx", "javascript", "css", "json", "bash", "html", "markdown"],
  });

  return {
    plugins: [create_mdx_plugin(highlighter), tailwindcss()],
    server: {
      host: "127.0.0.1",
      port: 5175,
      strictPort: true,
    },
  };
});
