/**
 * 文档数据层类型定义。
 *
 * 这一层完全拥有文档的语义：公开 URL 形态、导航树、面包屑、分页与搜索索引都从
 * 这里推导，不再借用文档框架的运行时对象。因此每个字段的取值规则都在注释中写明，
 * 修改 URL 规则时只需要改这里的常量与 `docs-index.ts` 的解析函数。
 */
import type { ReactNode } from "react";

/** 文档空间标识，同时是 `content/<id>/` 的目录名与公开路径前缀。 */
export type DocsSpaceId =
  | "docs"
  | "city-sdk-docs"
  | "agent-sdk-docs"
  | "payments"
  | "powers-docs"
  | "ui-sdk-docs"
  | "blog";

/** 文档语言。公开 URL 的第一段就是该值。 */
export type DocsLocale = "en" | "zh";

/**
 * 编译产物中单篇文档的原始形态。
 *
 * 字段来自 `fumadocs-mdx` 的集合条目：`toc` 与 `body` 由 MDX 编译期生成，
 * 其余为 frontmatter。这里只声明数据层实际读取的字段。
 */
export type DocsCompiledFile = {
  /** 文档标题，来自 frontmatter，缺失时由 slug 推导。 */
  title?: string;
  /** 文档摘要，来自 frontmatter，用于 meta description 与搜索结果。 */
  description?: string;
  /** 目录项图标名，来自 frontmatter。 */
  icon?: string;
  /** 编译后的正文组件。 */
  body?: unknown;
  /** 正文标题树，用于右侧目录。 */
  toc?: DocsTocItem[];
  /** 供检索使用的正文结构化数据。 */
  structuredData?: DocsStructuredData;
  /** 相对内容目录的路径，形如 `en/agent/overview.mdx`。 */
  info?: { path: string; fullPath: string };
};

/** 正文标题树中的单个条目。 */
export type DocsTocItem = {
  /** 标题渲染内容。 */
  title: ReactNode;
  /** 标题锚点，形如 `#quickstart`。 */
  url: string;
  /** 标题层级，`2` 表示二级标题。 */
  depth: number;
};

/** 编译期为检索生成的结构化正文。 */
export type DocsStructuredData = {
  /** 按标题切分的正文段落。 */
  contents?: Array<{ heading?: string; content?: string }>;
};

/** 侧边栏顺序声明文件（`meta.json`）的原始形态。 */
export type DocsMetaFile = {
  /** 目录在侧边栏中的显示名。 */
  title?: string;
  /** 该目录下的排列顺序，元素为页面 slug 或子目录名。 */
  pages?: string[];
  /** 目录级摘要。 */
  description?: string;
};

/**
 * 导航树节点。
 *
 * 目录节点与页面节点共用同一结构：目录只有 `children` 没有 `url`，页面两者都有。
 * 一个目录同时存在 `index.mdx` 与子页时，会同时带上 `url` 与 `children`——
 * 此时该 URL 在访问时重定向到首个后代页面，因此 `is_section` 为真。
 */
export type DocsNavNode = {
  /** 节点稳定标识，等于其在空间内的相对路径，用于 React key。 */
  key: string;
  /** 侧边栏显示名。 */
  label: string;
  /** 页面节点的公开 URL；纯目录节点为 undefined。 */
  url?: string;
  /** 该节点是否为「仅作为目录容器」的页面（访问时重定向到首个后代）。 */
  is_section: boolean;
  /** 子节点，仅在目录节点上出现。 */
  children?: DocsNavNode[];
};

/** 单篇可访问文档的完整模型。 */
export type DocsPageRecord = {
  /** 所属文档空间。 */
  space: DocsSpaceId;
  /** 页面语言。 */
  locale: DocsLocale;
  /** 语言无关的 slug 路径片段，`[]` 表示空间根页。 */
  slug: string[];
  /** 公开 URL，始终带尾斜杠，形如 `/en/docs/agent/overview/`。 */
  url: string;
  /** 页面标题。 */
  title: string;
  /** 页面摘要，可能为空字符串。 */
  description: string;
  /** 正文标题树，用于右侧目录。 */
  toc: DocsTocItem[];
  /** 编译后的正文组件。 */
  body: unknown;
  /**
   * 相对内容目录的源文件路径，形如 `en/agent/overview.mdx` 或 `zh/payments/credits/index.mdx`。
   *
   * 客户端加载器按此路径索引编译产物，因此必须保存真实路径而不是由 slug 反推：
   * `index.mdx` 在 URL 上折叠为目录，反推会得到不存在的 `zh/payments/credits.mdx`。
   */
  content_path: string;
  /** 为检索生成的正文结构化数据。 */
  structured_data: DocsStructuredData | undefined;
  /** 磁盘上的源文件绝对路径，用于读取原始 Markdown 与做存在性校验。 */
  absolute_path: string | undefined;
  /**
   * 正文链接是否需要额外一跳。
   *
   * 该页面存在 `index.mdx` 且同一目录下还有其它页面时，访问 URL 会重定向到首个
   * 后代页面。此类页面不进 sitemap，侧边栏中也只作为目录标题出现。
   */
  is_section: boolean;
};

/** 页面在其空间导航树中的位置信息。 */
export type DocsPagePlacement = {
  /** 从空间根到当前页面的祖先节点，用于面包屑。 */
  ancestors: Array<{ label: string; url?: string }>;
  /** 空间导航树，供侧边栏渲染。 */
  tree: DocsNavNode[];
  /** 同一空间内的上一篇页面。 */
  previous?: { title: string; url: string };
  /** 同一空间内的下一篇页面。 */
  next?: { title: string; url: string };
};

/** 搜索索引中的单条记录。 */
export type DocsSearchRecord = {
  /** 所属文档空间。 */
  space: DocsSpaceId;
  /** 页面语言。 */
  locale: DocsLocale;
  /** 页面标题。 */
  title: string;
  /** 页面公开 URL。 */
  url: string;
  /** 页面摘要，用作结果副标题；可能为空。 */
  description: string;
  /** 正文标题列表，命中标题时提升排序权重。 */
  headings: string[];
  /** 正文摘要，用于按正文内容命中；已压缩空白并截断。 */
  snippet: string;
};

/** 按语言切分的静态搜索索引文件内容。 */
export type DocsSearchIndex = {
  /** 生成时对应的语言。 */
  locale: DocsLocale;
  /** 该语言下的全部可检索页面。 */
  records: DocsSearchRecord[];
};

/**
 * 文档页面 loader 的返回值，也是渲染层唯一的数据入口。
 *
 * 全部字段都是可直接序列化的纯数据：渲染层会在浏览器中执行，因此不允许再触碰
 * 文档索引或磁盘。类型放在这里而不是 loader 模块，是为了避免渲染层为了取类型
 * 而引用服务端模块（`verbatimModuleSyntax` 会擦除类型引用，但把边界写清楚更安全）。
 */
export type DocsRouteData = {
  /** 当前空间标识。 */
  space_id: string;
  /** 当前语言。 */
  locale: DocsLocale;
  /** 当前页面公开 URL。 */
  url: string;
  /** 当前页面标题。 */
  title: string;
  /** 当前页面摘要。 */
  description: string;
  /** 用于取正文组件的内容路径，形如 `en/agent/overview.mdx`。 */
  content_path: string;
  /** 原始 MDX 文本，供复制按钮使用。 */
  raw_markdown: string;
  /** 导航树，渲染侧边栏。 */
  tree: DocsNavNode[];
  /** 右侧目录。 */
  toc: DocsTocItem[];
  /** 同一空间内的上一篇页面。 */
  previous?: { title: string; url: string };
  /** 同一空间内的下一篇页面。 */
  next?: { title: string; url: string };
  /** 另一种语言下的对应 URL。 */
  alternate_url?: string;
  /** 面包屑 JSON-LD 字符串。 */
  breadcrumb_jsonld: string;
};
