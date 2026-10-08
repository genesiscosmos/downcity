/**
 * 文档索引构建模块。
 *
 * 本模块把 `fumadocs-mdx` 编译出的集合条目整理成站点自己的页面模型：公开 URL、
 * 导航树、面包屑、上下页与 section 判定。所有派生逻辑集中在这里，路由层只做查询。
 *
 * 为什么自己建这一层：原实现通过文档框架的 `loader()` 取页面，需要为框架的
 * fallback 语义额外写存在性校验，并且 URL 规则散落在框架内部。改为直接消费编译
 * 集合后，slug 解析、`index.mdx` 折叠与 section 判定都由本模块显式拥有。
 */
import { resolve } from "node:path";
import {
  agentSdkDocs,
  blog,
  citySdkDocs,
  docs,
  payments,
  powersDocs,
  uiSdkDocs,
} from "../../../.source/server";
import {
  create_alternate_docs_url,
  create_docs_url,
  docs_locales,
  docs_spaces,
  find_docs_space,
  type DocsSpace,
} from "./spaces";
import type {
  DocsCompiledFile,
  DocsLocale,
  DocsNavNode,
  DocsPagePlacement,
  DocsPageRecord,
  DocsSpaceId,
  DocsStructuredData,
  DocsTocItem,
} from "./types";

/** 编译集合条目的最小形态，避免在派生逻辑里重复断言。 */
type CollectionEntry = DocsCompiledFile & {
  /** 原始 frontmatter 中除已声明字段外的自定义键。 */
  [key: string]: unknown;
};

/** 集合容器，只声明派生逻辑实际读取的两个数组。 */
type DocsCollection = {
  /** 文档条目。 */
  docs: readonly unknown[];
  /** 目录声明条目。 */
  meta: readonly unknown[];
};

/** 各文档空间到编译集合的映射，键是空间标识。 */
const space_collections: Record<DocsSpaceId, DocsCollection> = {
  docs,
  "city-sdk-docs": citySdkDocs,
  "agent-sdk-docs": agentSdkDocs,
  payments,
  "powers-docs": powersDocs,
  "ui-sdk-docs": uiSdkDocs,
  blog,
};

/**
 * 把集合条目的内容路径解析为语言与 slug。
 *
 * 路径形如 `en/agent/overview.mdx` 或 `zh/components/index.mdx`：第一段是语言，
 * 其余是 slug，末尾的 `index` 折叠掉（它在 URL 上等于所在目录）。
 */
function parse_content_path(path: string): { locale: DocsLocale; slug: string[] } | undefined {
  const segments = path.replace(/^\.\//, "").replace(/\.mdx?$/, "").split("/").filter(Boolean);
  const [locale_segment, ...slug_segments] = segments;

  if (locale_segment !== "en" && locale_segment !== "zh") return undefined;

  const slug = slug_segments.at(-1) === "index" ? slug_segments.slice(0, -1) : slug_segments;

  return { locale: locale_segment, slug };
}

/** 判断内容路径是否为 `index` 文件；这是 section 折叠判定的前提。 */
function is_index_file(path: string): boolean {
  return /(^|\/)index\.mdx?$/.test(path);
}

/** 把 slug 片段转换成兜底显示名，用于缺少 `meta.json` 标题的目录。 */
function slug_to_label(slug: string): string {
  return slug
    .split("-")
    .map((part) => (part.length > 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

/** 读取集合条目的内容路径，缺失时返回 undefined。 */
function entry_path(entry: CollectionEntry): string | undefined {
  const path = entry.info?.path;

  return typeof path === "string" ? path.replace(/^\.\//, "") : undefined;
}

/** 读取集合条目的磁盘绝对路径，用于读取原始 Markdown 与做存在性校验。 */
function entry_full_path(entry: CollectionEntry): string | undefined {
  const full_path = entry.info?.fullPath;

  return typeof full_path === "string" ? resolve(process.cwd(), full_path) : undefined;
}

/** 目录声明记录：目录路径（已去掉语言段）与其中的排列声明。 */
type MetaRecord = {
  /** 目录相对空间根的路径，空数组表示空间根目录。 */
  directory: string[];
  /** 目录显示名，缺省时由目录名或页面标题推导。 */
  title?: string;
  /** 该目录下的排列顺序，元素为页面 slug 或子目录名。 */
  pages?: string[];
};

/** 收集某个空间在某个语言下的 `meta.json` 声明。 */
function build_meta_records(collection: DocsCollection, locale: DocsLocale): MetaRecord[] {
  const records: MetaRecord[] = [];

  for (const raw_entry of collection.meta) {
    const entry = raw_entry as CollectionEntry;
    const path = entry_path(entry);
    if (!path) continue;

    const segments = path.split("/");
    // 第一段是语言，最后一段是 meta.json，中间是目录。
    if (segments[0] !== locale) continue;

    records.push({
      directory: segments.slice(1, -1),
      title: typeof entry.title === "string" ? entry.title : undefined,
      pages: Array.isArray(entry.pages)
        ? entry.pages.filter((value): value is string => typeof value === "string")
        : undefined,
    });
  }

  return records;
}

/** 展开某个空间在某个语言下的全部页面。 */
function build_space_pages(space: DocsSpace, locale: DocsLocale, collection: DocsCollection) {
  const collected = collection.docs
    .map((raw_entry) => raw_entry as CollectionEntry)
    .flatMap((entry) => {
      const path = entry_path(entry);
      if (!path) return [];

      const parsed = parse_content_path(path);
      if (!parsed || parsed.locale !== locale) return [];

      return [{ entry, slug: parsed.slug, is_index: is_index_file(path) }];
    });

  // 同一目录下存在多个页面时，该目录的 index 页面访问后会重定向到首个后代页面，
  // 因此不进 sitemap，侧边栏中也只作为目录标题出现。
  //
  // 空间根页例外：slug 为空时路由不会做首个子页重定向，它本身就是有正文的落地页。
  const directory_page_counts = new Map<string, number>();
  for (const item of collected) {
    const directory = item.is_index ? item.slug.join("/") : item.slug.slice(0, -1).join("/");
    directory_page_counts.set(directory, (directory_page_counts.get(directory) ?? 0) + 1);
  }

  return collected.map(({ entry, slug, is_index }) => {
    const directory = slug.join("/");
    const is_section = is_index && slug.length > 0 && (directory_page_counts.get(directory) ?? 0) > 1;
    const title =
      typeof entry.title === "string" && entry.title.length > 0
        ? entry.title
        : slug_to_label(slug.at(-1) ?? space.label[locale]);

    const page: DocsPageRecord = {
      space: space.id,
      locale,
      slug,
      url: create_docs_url(space.id, locale, slug),
      title,
      description: typeof entry.description === "string" ? entry.description : "",
      toc: Array.isArray(entry.toc) ? (entry.toc as DocsTocItem[]) : [],
      body: entry.body,
      content_path: entry_path(entry) ?? "",
      structured_data:
        entry.structuredData && typeof entry.structuredData === "object"
          ? (entry.structuredData as DocsStructuredData)
          : undefined,
      absolute_path: entry_full_path(entry),
      is_section,
    };

    return page;
  });
}

/**
 * 构建某个目录下的节点列表。
 *
 * 子节点由页面 slug 直接推导：深度恰好多一段的是子页面，更深的页面其下一段构成
 * 子目录。这样目录结构完全由内容文件决定，不需要额外目录声明。
 */
function build_directory_nodes(
  space: DocsSpace,
  locale: DocsLocale,
  pages: readonly DocsPageRecord[],
  meta_by_directory: Map<string, MetaRecord>,
  directory: string[],
): DocsNavNode[] {
  const directory_key = directory.join("/");
  const prefix = directory_key.length > 0 ? `${directory_key}/` : "";

  const belongs_to_directory = (page: DocsPageRecord) =>
    page.slug.slice(0, directory.length).join("/") === directory_key;

  const child_directory_names = new Set(
    pages
      .filter((page) => belongs_to_directory(page) && page.slug.length > directory.length + 1)
      .map((page) => page.slug[directory.length])
      .filter((name): name is string => typeof name === "string"),
  );

  // 已展开为目录的 index 页面不再单独成节点，否则同一个 URL 会在侧边栏出现两次。
  // 该页面的标题与 URL 由目录节点继承，与文档框架的目录节点行为一致。
  const child_pages = pages.filter(
    (page) =>
      belongs_to_directory(page) &&
      page.slug.length === directory.length + 1 &&
      !child_directory_names.has(page.slug[directory.length] ?? ""),
  );

  const page_nodes: DocsNavNode[] = child_pages.map((page) => ({
    key: `${prefix}${page.slug.at(-1) ?? ""}`,
    label: page.title,
    url: page.url,
    is_section: page.is_section,
  }));

  // 空间根页（slug 为空）不属于任何子目录，单独作为首个节点接回导航，
  // 否则文档入口会从侧边栏消失。
  const root_page = directory.length === 0 ? pages.find((page) => page.slug.length === 0) : undefined;
  if (root_page) {
    page_nodes.unshift({
      key: "",
      label: root_page.title,
      url: root_page.url,
      is_section: root_page.is_section,
    });
  }

  const directory_nodes: DocsNavNode[] = [...child_directory_names].map((name) => {
    const child_directory = [...directory, name];
    const child_key = child_directory.join("/");
    const directory_page = pages.find((page) => page.slug.join("/") === child_key);

    return {
      key: child_key,
      label:
        directory_page?.title ??
        meta_by_directory.get(child_key)?.title ??
        slug_to_label(name),
      url: directory_page?.url,
      is_section: directory_page?.is_section ?? false,
      children: build_directory_nodes(space, locale, pages, meta_by_directory, child_directory),
    };
  });

  const nodes = [...page_nodes, ...directory_nodes];
  const ordered_keys = meta_by_directory.get(directory_key)?.pages;

  if (!ordered_keys || ordered_keys.length === 0) {
    return nodes.sort((left, right) => left.label.localeCompare(right.label));
  }

  return sort_nodes_by_order(nodes, ordered_keys, directory_key);
}

/**
 * 按 `meta.json` 声明的顺序排列节点。
 *
 * 声明中的 `index` 指向当前目录自身的页面（节点 key 即目录路径）。未声明的节点
 * 按标题追加到末尾，保证新增内容一定出现在侧边栏里。
 */
function sort_nodes_by_order(
  nodes: DocsNavNode[],
  ordered_keys: readonly string[],
  directory_key: string,
): DocsNavNode[] {
  const prefix = directory_key.length > 0 ? `${directory_key}/` : "";
  const rank = new Map<string, number>();

  ordered_keys.forEach((entry, index) => {
    rank.set(entry === "index" ? directory_key : `${prefix}${entry}`, index);
  });

  const listed = nodes
    .filter((node) => rank.has(node.key))
    .sort((left, right) => (rank.get(left.key) ?? 0) - (rank.get(right.key) ?? 0));
  const unlisted = nodes
    .filter((node) => !rank.has(node.key))
    .sort((left, right) => left.label.localeCompare(right.label));

  return [...listed, ...unlisted];
}

/** 按导航树顺序取出可访问页面，section 页面本身不属于阅读序列。 */
function flatten_readable_pages(
  tree: readonly DocsNavNode[],
  pages_by_url: ReadonlyMap<string, DocsPageRecord>,
): DocsPageRecord[] {
  const result: DocsPageRecord[] = [];

  const visit = (nodes: readonly DocsNavNode[]) => {
    for (const node of nodes) {
      if (node.url && !node.is_section) {
        const page = pages_by_url.get(node.url);
        if (page) result.push(page);
      }
      if (node.children) visit(node.children);
    }
  };

  visit(tree);

  return result;
}

/** 在导航树中查找某个 URL 的祖先链（不含页面自身）。 */
function find_ancestors(
  tree: readonly DocsNavNode[],
  target_url: string,
): Array<{ label: string; url?: string }> {
  const search = (
    nodes: readonly DocsNavNode[],
    trail: Array<{ label: string; url?: string }>,
  ): Array<{ label: string; url?: string }> | undefined => {
    for (const node of nodes) {
      if (node.url === target_url) return trail;

      if (node.children) {
        const found = search(node.children, [...trail, { label: node.label, url: node.url }]);
        if (found) return found;
      }
    }

    return undefined;
  };

  return search(tree, []) ?? [];
}

/**
 * 文档索引。
 *
 * 构造时一次性展开全部空间的页面，之后所有查询都是内存查找。索引在模块首次被
 * 引用时构建，构建期与运行期共享同一份结果。
 */
class DocsIndex {
  /** 全部页面，按空间与语言展开后的扁平列表。 */
  private readonly pages: DocsPageRecord[];

  /** 公开 URL 到页面的映射。 */
  private readonly pages_by_url: Map<string, DocsPageRecord>;

  /** `${space}:${locale}` 到导航树的映射。 */
  private readonly trees = new Map<string, DocsNavNode[]>();

  /**
   * `${space}:${locale}` 到阅读顺序页面列表的映射。
   *
   * 顺序与侧边栏一致，列表页、上下页与 sitemap 都直接复用，避免另建一套排序。
   */
  private readonly readable_pages = new Map<string, DocsPageRecord[]>();

  /** 页面 URL 到其空间内位置信息的映射。 */
  private readonly placements = new Map<string, DocsPagePlacement>();

  constructor() {
    const pages: DocsPageRecord[] = [];
    const pages_by_url = new Map<string, DocsPageRecord>();

    for (const space of docs_spaces) {
      const collection = space_collections[space.id];

      for (const locale of docs_locales) {
        const space_pages = build_space_pages(space, locale, collection);
        for (const page of space_pages) {
          pages.push(page);
          pages_by_url.set(page.url, page);
        }

        const meta_by_directory = new Map(
          build_meta_records(collection, locale).map((record) => [
            record.directory.join("/"),
            record,
          ]),
        );
        const tree = build_directory_nodes(space, locale, space_pages, meta_by_directory, []);
        this.trees.set(this.tree_key(space.id, locale), tree);

        const readable = flatten_readable_pages(tree, pages_by_url);
        this.readable_pages.set(this.tree_key(space.id, locale), readable);

        for (const [index, page] of readable.entries()) {
          const previous = index > 0 ? readable[index - 1] : undefined;
          const next = index < readable.length - 1 ? readable[index + 1] : undefined;

          this.placements.set(page.url, {
            ancestors: find_ancestors(tree, page.url),
            tree,
            previous: previous ? { title: previous.title, url: previous.url } : undefined,
            next: next ? { title: next.title, url: next.url } : undefined,
          });
        }
      }
    }

    this.pages = pages;
    this.pages_by_url = pages_by_url;
  }

  /** 目录树缓存键。 */
  private tree_key(space: DocsSpaceId, locale: DocsLocale): string {
    return `${space}:${locale}`;
  }

  /** 按公开 URL 取页面。 */
  get_page(url: string): DocsPageRecord | undefined {
    return this.pages_by_url.get(url);
  }

  /** 按空间、语言与 slug 取页面。 */
  find_page(space: DocsSpaceId, locale: DocsLocale, slug: string[]): DocsPageRecord | undefined {
    return this.pages_by_url.get(create_docs_url(space, locale, slug));
  }

  /** 取某个空间在某个语言下的导航树。 */
  get_tree(space: DocsSpaceId, locale: DocsLocale): DocsNavNode[] {
    return this.trees.get(this.tree_key(space, locale)) ?? [];
  }

  /** 取某个页面的空间内位置信息。 */
  get_placement(url: string): DocsPagePlacement | undefined {
    return this.placements.get(url);
  }

  /**
   * 取某个页面在另一种语言下的对应 URL。
   *
   * 仅当该语言的源文件真实存在时才返回，避免 hreflang 指向 404。原实现依赖回查
   * 磁盘来判断这件事，现在页面表本身就是事实来源。
   */
  get_alternate_url(page: DocsPageRecord): string | undefined {
    const candidate = create_alternate_docs_url(page.space, page.locale, page.slug);
    const alternate = this.pages_by_url.get(candidate);

    return alternate && !alternate.is_section ? candidate : undefined;
  }

  /** 列出某个空间在某个语言下的全部可索引页面，顺序与侧边栏一致。 */
  list_space_pages(space: DocsSpaceId, locale: DocsLocale): DocsPageRecord[] {
    return this.readable_pages.get(this.tree_key(space, locale)) ?? [];
  }

  /** 列出某个空间在全部语言下的页面。 */
  list_all_space_pages(space: DocsSpaceId): DocsPageRecord[] {
    return this.pages.filter((page) => page.space === space);
  }

  /** 列出某个语言下的全部可索引页面。 */
  list_locale_pages(locale: DocsLocale): DocsPageRecord[] {
    return this.pages.filter((page) => page.locale === locale && !page.is_section);
  }
}

/** 全站共享的文档索引实例。 */
export const docs_index = new DocsIndex();

export { find_docs_space };
export type { DocsSpace };
