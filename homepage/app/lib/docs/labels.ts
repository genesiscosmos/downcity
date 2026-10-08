/**
 * 文档外壳文案模块。
 *
 * 外壳控件（搜索、目录、主题、语言、移动端导航）的文案集中在这里，避免把中英文
 * 字符串散落到多个组件中。文案按界面语言取值，与 URL 语言一致。
 */
import type { DocsLocale } from "./types";
import { docs_spaces } from "./spaces";

/** 各语言下的外壳文案集合。 */
const shell_labels: Record<
  DocsLocale,
  {
    search: string;
    search_placeholder: string;
    search_empty: string;
    search_results: string;
    toc: string;
    switch_theme: string;
    switch_language: string;
    toggle_navigation: string;
  }
> = {
  en: {
    search: "Search",
    search_placeholder: "Search documentation…",
    search_empty: "No matching pages.",
    search_results: "Results",
    toc: "On this page",
    switch_theme: "Switch theme",
    switch_language: "Switch language",
    toggle_navigation: "Toggle navigation",
  },
  zh: {
    search: "搜索",
    search_placeholder: "搜索文档…",
    search_empty: "没有匹配的页面。",
    search_results: "结果",
    toc: "本页目录",
    switch_theme: "切换主题",
    switch_language: "切换语言",
    toggle_navigation: "切换导航",
  },
};

/**
 * 生成外壳文案。
 *
 * `space_label` 取当前空间的显示名，与侧边栏标题、面包屑根层保持一致。
 */
export function create_docs_shell_labels(locale: DocsLocale, space_id: string) {
  const space = docs_spaces.find((item) => item.id === space_id);

  return {
    ...shell_labels[locale],
    space_label: space ? space.label[locale] : space_id,
  };
}
