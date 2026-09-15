/**
 * 右侧 BayBar 的标签页模型与纯规则。
 *
 * ## 一句话模型
 *
 * BayBar = **一个可开关的面板** + **一组标签页**。
 * 面板的开合与标签页的数量互相独立：没有标签页时展开就是一张空白标签页。
 *
 * ## 标签页从哪来
 *
 * 由拥有内容的组件在用户点击时**直接构造并打开**（见各 feature 的 `*_tab()` 构造函数）。
 * 没有「注册」、没有「声明」、没有生命周期：一次点击 = 一个标签页。
 * 这曾经是一套带所有者标识的注册协议（声明可打开哪些、随视图卸载撤回），
 * 代价是「切换视图会换掉已打开的标签页」，而且从视图卸载后内容无法渲染。
 * 现在标签页自包含：id、标题、图标、内容齐备，与哪个视图还活着无关。
 *
 * ## 内容必须自解析
 *
 * `content` 只能依赖 id 与 controller，不能依赖构造它的那个视图的临时状态
 * （例如 `useState` 里的选中项）。否则切走视图后，已打开的标签页会渲染成空或旧数据。
 *
 * 本模块保持纯粹（不引入 React 运行时、不读 localStorage），因此可被单测直接加载。
 */

import type { ReactNode } from "react";

/** 标签页内的一个分区，对应内容区上方的一组分段按钮。 */
export interface BayBarSection {
  /** 分区稳定标识。 */
  id: string;
  /** 分段按钮使用的名称。 */
  label: string;
  /** 自解析的分区内容。 */
  content: ReactNode;
}

/** 一个标签页。id 指向具体对象，例如 `agent:a1`、`files:<会话>`。 */
export interface BayBarTab {
  /** 稳定标识；同类对象的每个实例各占一个标签页。 */
  id: string;
  /** 标签行上的名称。 */
  label: string;
  /** 标签行上的图标；属于具体对象的标签页用该对象的头像或图标。 */
  icon: ReactNode;
  /** 分区；至少一个。 */
  sections: BayBarSection[];
}

/** 翻译函数的最小形态；各构造函数用它取自己命名空间下的文案。 */
export type BayBarTranslate = (key: string) => string;

/** 合成标签页标识：同类对象的每个实例各占一个。 */
export function baybar_tab_id(kind: string, key: string): string {
  return `${kind}:${key}`;
}

/** 面板开合状态的持久化键。这是唯一持久化的东西：标签页是会话内的状态。 */
export const baybar_open_storage_key = "downcity.baybar_open";

/** 解析布尔持久化值；只有明确存过 "true" 才算真（没存过时默认收起）。 */
export function parse_stored_flag(value: string | null): boolean {
  return value === "true";
}

/**
 * 解析标签页内应当显示的分区。
 *
 * 沿用上次的分区；它消失了则回退到第一个——切换分区、从正文入口打开时
 * 用户不该看到空面板。`section_id` 为空表示没有指定，同样落到第一个。
 */
export function resolve_section(tab: BayBarTab, section_id: string | null | undefined): BayBarSection | null {
  const first = tab.sections[0];
  if (!first) return null;
  if (!section_id) return first;
  return tab.sections.find((section) => section.id === section_id) ?? first;
}

/**
 * 关闭一个标签页之后应当显示哪一个。
 *
 * 规则：关的不是当前页 → 当前页不变；关的是当前页 → 优先接右侧邻居，其次左侧；
 * 都没有则返回 null，此时面板保持展开并显示空白标签页。
 *
 * **刻意只回答「显示哪一个」**：关标签页与开关面板是两个正交的维度，
 * 面板是壳层的一列，不会因为里面没有标签页而消失。
 * 曾经把「关掉最后一个」写成「收起面板」，于是关标签页会连带关掉整个 BayBar；
 * 把规则做成这个签名（返回值里根本没有面板状态），它在类型上就无法再犯那个错。
 */
export function resolve_active_after_close(tab_ids: readonly string[], active_id: string | null, closing_id: string): string | null {
  if (active_id !== closing_id) return active_id;
  const index = tab_ids.indexOf(closing_id);
  if (index === -1) return active_id;
  return tab_ids[index + 1] ?? tab_ids[index - 1] ?? null;
}
