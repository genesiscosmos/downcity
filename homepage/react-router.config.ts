import type { Config } from "@react-router/dev/config";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

type DocsCollection = {
  /** 文档内容目录名，对应 `homepage/content/<directory>`。 */
  directory: string;
  /** 用户访问路径前缀，对应 React Router 中的文档路由。 */
  route_prefix: string;
};

const docs_collections: DocsCollection[] = [
  { directory: "docs", route_prefix: "docs" },
  { directory: "city-sdk-docs", route_prefix: "city-sdk-docs" },
  { directory: "agent-sdk-docs", route_prefix: "agent-sdk-docs" },
  { directory: "payments", route_prefix: "payments" },
  { directory: "plugins-docs", route_prefix: "plugins-docs" },
  { directory: "ui-sdk-docs", route_prefix: "ui-sdk-docs" },
  // blog 不是文档，但 MDX → `/{lang}/{route_prefix}/<slug>` 的路径映射与文档一致，
  // 复用同一套扫描可避免新增文章时漏配预渲染。
  { directory: "blog", route_prefix: "blog" },
];

/**
 * 递归收集目录下所有 MDX 文件路径。
 */
function collect_mdx_files(directory: string, out: string[]) {
  for (const entry of readdirSync(directory)) {
    const entry_path = join(directory, entry);
    const entry_stat = statSync(entry_path);
    if (entry_stat.isDirectory()) {
      collect_mdx_files(entry_path, out);
      continue;
    }
    if (entry_stat.isFile() && entry_path.endsWith(".mdx")) {
      out.push(entry_path);
    }
  }
}

/**
 * 将文档内容目录中的 MDX 文件映射为用户可访问 URL。
 */
function get_docs_collection_paths(collection: DocsCollection) {
  const collection_root = join("content", collection.directory);
  const mdx_files: string[] = [];
  collect_mdx_files(collection_root, mdx_files);

  return mdx_files.map((file_path) => {
    const relative_path = relative(collection_root, file_path);
    const path_parts = relative_path.split(sep);
    const lang = path_parts[0] ?? "en";
    const slug_parts = path_parts
      .slice(1)
      .join("/")
      .replace(/\.mdx$/, "")
      .split("/")
      .filter((part) => part !== "index");
    const suffix = slug_parts.length > 0 ? `/${slug_parts.join("/")}` : "";
    return `/${lang}/${collection.route_prefix}${suffix}`;
  });
}

/**
 * 收集 Cloudflare Pages 静态直传需要预渲染的文档路径。
 *
 * 关键说明（中文）
 * - Downcity homepage 部署到 Pages 的 `build/client`，不依赖 Vercel 函数运行时。
 * - 文档页数量较多，必须在构建期生成对应 HTML，保证搜索引擎与直链访问稳定。
 * - 无语言前缀的文档入口保留为重定向页，兼容站内现有链接。
 */
function get_prerender_paths() {
  const docs_paths = docs_collections.flatMap(get_docs_collection_paths);

  return Array.from(
    new Set([
      "/",
      "/zh",
      "/whitepaper",
      "/zh/whitepaper",
      "/start",
      "/zh/start",
      "/terms",
      "/privacy",
      "/sitemap.xml",
      "/features",
      "/zh/features",
      "/product",
      "/zh/product",
      // /product/sdk 已拆分，旧路径不再预渲染（由 public/_redirects 以 301 接管）。
      "/product/city-sdk",
      "/zh/product/city-sdk",
      "/product/federation-sdk",
      "/zh/product/federation-sdk",
      "/product/agent-sdk",
      "/zh/product/agent-sdk",
      "/product/ui-sdk",
      "/zh/product/ui-sdk",
      "/resources",
      "/zh/resources",
      "/resources/skills",
      "/zh/resources/skills",
      "/resources/hosting",
      "/zh/resources/hosting",
      "/resources/marketplace",
      "/zh/resources/marketplace",
      "/resources/examples",
      "/zh/resources/examples",
      "/community",
      "/zh/community",
      "/community/faq",
      "/zh/community/faq",
      "/community/roadmap",
      "/zh/community/roadmap",
      "/community/showcase",
      "/zh/community/showcase",
      "/docs",
      "/city-sdk-docs",
      "/agent-sdk-docs",
      "/payments",
      "/plugins-docs",
      "/ui-sdk-docs",
      "/en/blog",
      "/zh/blog",
      "/api/search",
      "/api/city-sdk-docs/search",
      "/api/agent-sdk-docs/search",
      "/api/payments/search",
      "/api/plugins-docs/search",
      "/api/ui-sdk-docs/search",
      ...docs_paths,
    ]),
  );
}

export default {
  // 站点默认启用 SSR，保证营销页与文档页都可以走服务端渲染。
  ssr: true,
  // 提前启用 React Router v8 行为，避免 typegen/build 重复输出 future flag 提示。
  future: {
    v8_middleware: true,
    v8_splitRouteModules: true,
    v8_viteEnvironmentApi: true,
    v8_passThroughRequests: true,
    v8_trailingSlashAwareDataRequests: true,
  },
  // Homepage 部署在静态回退与 SSR 混合环境中，关闭 lazy route discovery，
  // 避免前端额外请求 `/__manifest` 时被平台回退成 HTML，进而触发 JSON 解析报错。
  routeDiscovery: {
    mode: "initial",
  },
  // Cloudflare Pages 直传 `build/client`，预渲染全部用户可访问入口。
  async prerender() {
    return get_prerender_paths();
  },
} satisfies Config;
