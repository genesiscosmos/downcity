/**
 * MDX 正文客户端加载模块。
 *
 * `fumadocs-mdx` 生成的浏览器集合提供按内容路径取正文组件的加载器，但其类型声明为
 * `FC<undefined>`，与站点其他地方使用的无 props 组件类型不兼容。本模块把这一层类型
 * 差异收敛到一处，向调用方暴露统一的 `ComponentType`，避免每个路由各写一次断言。
 *
 * 说明：编译与懒加载行为完全由集合提供，本模块只做类型归一与缓存。
 */
import type { ComponentType, ReactNode } from "react";
import type { MDXComponents } from "mdx/types";
import browserCollections from "fumadocs-mdx:collections/browser";
import { getMDXComponents } from "@/components/docs/mdx-components";
import type { DocsTocItem } from "./types";

/** 集合的客户端加载器形态。 */
type BrowserCollection = {
  /** 创建一个客户端加载器。 */
  createClientLoader: (options: {
    /** 加载器标识，用于跨实例共享缓存。 */
    id: string;
    /** 渲染正文的组件工厂。 */
    component: (loaded: {
      /** 编译后的正文组件。 */
      default: ComponentType<{ components?: MDXComponents }>;
      /** 编译期写入的标题树。 */
      toc?: DocsTocItem[];
    }) => ReactNode;
  }) => {
    /** 按内容路径取可直接渲染的组件。 */
    getComponent: (path: string) => ComponentType | undefined;
  };
};

/** 浏览器端集合表，键名与 `source.config.ts` 的集合导出名一致。 */
const browser_collections = browserCollections as unknown as Record<string, BrowserCollection>;

/** 已创建的加载器缓存，按集合名区分。 */
const loaders = new Map<string, { getComponent: (path: string) => ComponentType | undefined }>();

/**
 * 取某个 MDX 集合的正文加载器。
 *
 * 正文组件在浏览器端按需加载：预渲染阶段只输出页面骨架，正文由加载器接管，
 * 单页载荷因此不随文档总量增长。
 */
export function get_mdx_loader(collection_name: string) {
  const cached = loaders.get(collection_name);
  if (cached) return cached;

  const loader = browser_collections[collection_name].createClientLoader({
    id: collection_name,
    component: ({ default: Mdx }) => <Mdx components={getMDXComponents()} />,
  });

  loaders.set(collection_name, loader);

  return loader;
}
