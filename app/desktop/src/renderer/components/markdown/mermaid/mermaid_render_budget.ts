/**
 * Markdown 图表块的单会话渲染预算。
 *
 * Mermaid 渲染出的 SVG 会连同 React Fiber 一起长期留在消息树里，长会话可能累积几十张图，
 * 每张都带完整 DOM 子树，是渲染进程内存的可见来源之一。这里给会话内的已渲染图表数设上限，
 * 达到上限后新图表只显示占位与「仍然渲染」入口，由用户按需触发。
 *
 * 三个设计点：
 * 1. **按图表标识记账，而不是按次数计数。** 同一张图在主题切换、重试、组件重挂载时会再次请求
 *    渲染；按次数会让这些正常重渲染白白消耗预算，按标识则天然幂等。
 * 2. **没有 Provider 时不设限。** 图表块是通用 Markdown 能力，Power 预览与 Workspace 文件预览
 *    也在用；只有会话视图提供预算，其余场景保持原有行为。
 * 3. **上限由会话容器给出，不由图表自己猜。** 阈值是产品口径，图表只负责询问「还能不能画」。
 */

import { createContext, useContext, useMemo, useRef } from "react";

/** 一个会话内允许自动渲染的图表数量上限。 */
export const max_auto_rendered_diagrams_per_session = 20;

/** 单会话的图表渲染预算。 */
export interface MermaidRenderBudget {
  /** 渲染上限；超出后新图表需用户确认。 */
  readonly limit: number;
  /** 尝试占用一次预算；该图表已占用或仍有余额时返回 true。 */
  claim(render_key: string): boolean;
  /** 无视上限占用预算；用于用户显式要求渲染某一张图。 */
  claim_forced(render_key: string): void;
}

const mermaid_render_budget_context = createContext<MermaidRenderBudget | undefined>(undefined);

/** 向下游声明当前会话的图表渲染预算。 */
export const MermaidRenderBudgetProvider = mermaid_render_budget_context.Provider;

/** 读取当前会话的图表渲染预算；不在会话视图中时返回 undefined，表示不设限。 */
export function use_mermaid_render_budget(): MermaidRenderBudget | undefined {
  return useContext(mermaid_render_budget_context);
}

/**
 * 创建一个会话级图表渲染预算。
 *
 * 预算随会话容器存在；切换会话时容器重建，记账自然清空，不需要额外的重置逻辑。
 */
export function use_mermaid_render_budget_value(limit: number = max_auto_rendered_diagrams_per_session): MermaidRenderBudget {
  const claimed_ref = useRef(new Set<string>());
  return useMemo<MermaidRenderBudget>(() => ({
    limit,
    claim: (render_key) => {
      if (claimed_ref.current.has(render_key)) return true;
      if (claimed_ref.current.size >= limit) return false;
      claimed_ref.current.add(render_key);
      return true;
    },
    claim_forced: (render_key) => {
      claimed_ref.current.add(render_key);
    },
  }), [limit]);
}
