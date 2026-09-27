/**
 * 面向 AI 检索引擎的内容输出模块。
 *
 * 背景：
 * 站点已有 `llms.txt`（导航索引）与 UI 上的「复制 Markdown」按钮，但两者都不可被
 * 爬虫直接抓取：
 * 1. `/en/docs/agent/overview.md` 之类的逐页 Markdown 端点返回 404——内容其实存在
 *    （loader 已读取 raw markdown 给复制按钮用），只是没有对外暴露 URL。
 * 2. 缺少 `llms-full.txt`，AI 引擎只能拿到链接列表，拿不到正文。
 *
 * 这里把「原始 Markdown」变成可抓取的静态资源，让 AI 答案引擎能直接引用正文，
 * 而不必解析 HTML。
 */
import { readFile } from "node:fs/promises";

/** 把 Markdown 原文转换为 text/markdown 响应。 */
export function markdown_response(raw: string) {
  return new Response(raw, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // 内容随文档更新，使用较短缓存。
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "X-Robots-Tag": "noindex",
    },
  });
}

/** 读取某个文档页对应的原始 Markdown。 */
export async function read_page_markdown(
  page: { absolutePath?: string } | undefined,
): Promise<string | null> {
  if (!page?.absolutePath) return null;
  try {
    return await readFile(page.absolutePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * 为文档 loader 提供 `/{path}.md` 的原始 Markdown 直出能力。
 *
 * 用法：在 loader 开头调用，返回非 null 时直接 return 该 Response。
 * 非 `.md` 请求返回 null，不影响原有页面渲染。
 *
 * 为什么放在 loader 而不是新增路由：文档路由是 `en/docs/*` 形式的 splat，
 * 再注册一条 `.md` 路由会与它冲突；在同一个 loader 里分流最稳妥。
 */
export async function serve_page_markdown(
  raw_path: string,
  lang: "en" | "zh",
  get_page: (
    slugs: string[],
    lang: string,
  ) => { absolutePath?: string } | undefined,
): Promise<Response | null> {
  // React Router 预渲染会把路径规范成带尾斜杠的形式（`.../lifecycle.md/`），
  // 因此先去掉尾部斜杠再判断扩展名。
  const normalized = raw_path.replace(/\/+$/, "");
  if (!normalized.endsWith(".md")) return null;

  const slugs = normalized.slice(0, -3).split("/").filter(Boolean);
  const lang_index = slugs.findIndex((value) => value === "en" || value === "zh");
  const clean_slugs = lang_index >= 0 ? slugs.slice(lang_index + 1) : slugs;

  const raw = await read_page_markdown(get_page(clean_slugs, lang));
  return raw ? markdown_response(raw) : null;
}

/**
 * 去掉 MDX 的 frontmatter，只保留正文。
 *
 * llms-full.txt 面向的是语言模型，frontmatter 的 YAML 块只会干扰阅读；
 * 但标题与描述需要保留为一级标题，因此单独提取后拼回正文之前。
 */
export function strip_frontmatter(raw: string): { title?: string; description?: string; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { body: raw };

  const frontmatter = match[1];
  const read = (key: string) => {
    const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
  };

  return {
    title: read("title"),
    description: read("description"),
    body: raw.slice(match[0].length),
  };
}
