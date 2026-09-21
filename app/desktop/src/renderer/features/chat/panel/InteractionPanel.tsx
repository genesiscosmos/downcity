/**
 * Interaction（审批 / 提问）在右侧 BayBar 的标签页。
 *
 * ## 为什么不再内联在活动行里
 *
 * Interaction 原先渲染在所属 Tool 行的下方、折叠内容之外。这在结构上是错的：
 *
 * 1. **它不属于那一行的“摘要”**。Tool 行讲的是“模型调用了什么”，Interaction 讲的是
 *    “需要你回答什么”，是两件不同的事，却挤在同一个视觉块里。
 * 2. **它把消息流撑开**。一张审批卡有标题、正文、输入框和两个按钮，内联在时间线中会把
 *    上下文推走；用户回答完还得再找刚才读到哪。
 * 3. **它没有归属感**。行折叠起来时，卡片还留在外面，看不出它属于哪一次调用。
 *
 * ## 现在的结构
 *
 * Interaction 是 Tool 行**折叠内容的一部分**（见 `AgentActivity` 的 `AgentTool`）：
 * 展开那一行才看得到它。同时它有一个 BayBar 标签页，需要仔细阅读或填长回答时
 * 可以放到右侧面板里作答——与输入区（`composer`）、文件（`files`）完全同构。
 *
 * ## 内容必须自解析
 *
 * 标签页只带 `interaction` 与 `respond`，不依赖构造它的那个视图是否还活着
 * （见 `baybarPanelState` 的约定）。
 */

import { useCallback } from "react";
import { TbAlertTriangle, TbMessageQuestion } from "react-icons/tb";
import type { RespondSessionInteractionInput, SessionAgentInteraction } from "@downcity/agent";
import { use_baybar_open, baybar_tab_id, type BayBarTab, type BayBarTranslate } from "@/layouts/BayBar";
import { AgentInteraction } from "@/features/chat/components/messages/AgentInteraction";
import { use_translation } from "@/locales/i18n";

/** 「交互」标签页的种类标识；完整 id 还需拼上具体的 interaction 标识。 */
export const INTERACTION_TAB_KIND = "interaction";

/** 交互标签页唯一分区的稳定标识。 */
export const INTERACTION_SECTION_ID = "interaction";

/** 构造某个 Interaction 的标签页标识。 */
export function interaction_tab_id(interaction_id: string): string {
  return baybar_tab_id(INTERACTION_TAB_KIND, interaction_id);
}

/**
 * 构造一个 Interaction 标签页。
 *
 * 标题取 Interaction 自己的标题（审批是「操作确认」、提问是问题卡标题）；
 * 图标区分两类语义：审批是警示、提问是问号。
 */
export function interaction_tab(
  interaction: SessionAgentInteraction,
  respond: (input: RespondSessionInteractionInput) => Promise<void>,
  translate_chat: BayBarTranslate,
): BayBarTab {
  return {
    id: interaction_tab_id(interaction.interaction_id),
    label: interaction.request.title || translate_chat(
      interaction.request.type === "approval" ? "activity.confirmation" : "activity.input_required",
    ),
    icon: interaction.request.type === "approval" ? <TbAlertTriangle /> : <TbMessageQuestion />,
    sections: [{
      id: INTERACTION_SECTION_ID,
      label: translate_chat("activity.input_required"),
      content: <AgentInteraction part={interaction} respond={respond} />,
    }],
  };
}

/** 把「打开交互面板」的动作交给活动行；不在壳内时为空操作。 */
export function use_open_interaction_tab(): (interaction: SessionAgentInteraction, respond: (input: RespondSessionInteractionInput) => Promise<void>) => void {
  const translate_chat = use_translation("chat");
  const open_baybar = use_baybar_open();
  return useCallback(
    (interaction, respond) => open_baybar(interaction_tab(interaction, respond, translate_chat), INTERACTION_SECTION_ID),
    [open_baybar, translate_chat],
  );
}
