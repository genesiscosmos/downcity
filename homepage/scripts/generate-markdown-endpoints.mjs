/**
 * 构建后生成逐页原始 Markdown 端点。
 *
 * 背景：
 * 站点是 Cloudflare Pages 静态直传（build/client），因此「路由」无法在运行时返回
 * 原始 Markdown。但 CF Pages 本身会按扩展名正确服务静态 .md 文件——站内已有的
 * `agent-strategy-whitepaper-2026-03-09.md` 实测返回 `content-type: text/markdown`。
 *
 * 所以正确做法不是新增路由，而是在构建产物里直接写入 `.md` 文件：
 *   /en/docs/agent/overview/  ->  build/client/en/docs/agent/overview.md
 *
 * 这样 `/en/docs/agent/overview.md` 就是一个纯静态资源，AI 引擎与开发工具可以直接
 * 抓取正文，无需解析 HTML。
 *
 * 不参与搜索索引：public/_headers 已对 /*.md 声明 X-Robots-Tag: noindex。
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const homepage_root = join(dirname(fileURLToPath(import.meta.url)), "..");
const content_root = join(homepage_root, "content");
const output_root = join(homepage_root, "build", "client");

/** 文档集合：内容目录名与公开路径前缀一一对应。 */
const collections = [
  { directory: "docs", prefix: "docs" },
  { directory: "city-sdk-docs", prefix: "city-sdk-docs" },
  { directory: "agent-sdk-docs", prefix: "agent-sdk-docs" },
  { directory: "payments", prefix: "payments" },
  { directory: "powers-docs", prefix: "powers-docs" },
  { directory: "ui-sdk-docs", prefix: "ui-sdk-docs" },
  { directory: "blog", prefix: "blog" },
];

/** 递归收集目录下的 .mdx 文件。 */
async function collect_mdx(directory, out) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collect_mdx(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
      out.push(full);
    }
  }
}

/**
 * 把 MDX 文件路径映射为公开 URL 路径。
 *
 * 与 react-router.config.ts 的预渲染扫描保持同一套规则：
 *   content/{dir}/{lang}/{slug...}.mdx  ->  /{lang}/{prefix}/{slug...}
 * `index.mdx` 不贡献 slug 段。
 */
function to_public_path(file_path, collection) {
  const rel = relative(join(content_root, collection.directory), file_path);
  const parts = rel.split(sep);
  const lang = parts[0];
  const slug_parts = parts
    .slice(1)
    .join("/")
    .replace(/\.mdx$/, "")
    .split("/")
    .filter((part) => part !== "index");
  const suffix = slug_parts.length > 0 ? `/${slug_parts.join("/")}` : "";
  return `/${lang}/${collection.prefix}${suffix}`;
}

async function main() {
  let written = 0;
  let skipped = 0;

  for (const collection of collections) {
    const files = [];
    await collect_mdx(join(content_root, collection.directory), files);

    for (const file_path of files) {
      const public_path = to_public_path(file_path, collection);

      // 集合根（形如 /en/docs，只有 {lang}/{prefix} 两段）不生成 .md：
      // 其正文已包含在 llms-full.txt 中，且 /en/docs.md 这种 URL 容易与目录语义混淆。
      const segments = public_path.split("/").filter(Boolean);
      if (segments.length <= 2) {
        skipped += 1;
        continue;
      }

      const target = join(output_root, `${public_path}.md`);
      const raw = await readFile(file_path, "utf-8");

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, raw, "utf-8");
      written += 1;
    }
  }

  console.log(`[markdown-endpoints] 生成 ${written} 个 .md 端点（跳过 ${skipped} 个集合根）`);
}

await main();
