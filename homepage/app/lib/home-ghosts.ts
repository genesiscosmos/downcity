/**
 * 首页可选择 Ghost 的居民身份配置。
 *
 * 城市只用颜色区分当前主角与其他居民，不再为每位居民建立独立配色。
 * 被选中的居民统一使用主角色，并将该颜色延续到 Product World。
 */

import type { HomeGhostDefinition } from "@/types/home/HomeGhost";

/** 当前主角在 Hero 与 Product World 中使用的唯一强调色。 */
export const home_hero_agent_accent = "#4f6f9f";

/** Hero 城市中按固定顺序展示的五个 Ghost。 */
export const home_ghosts: readonly HomeGhostDefinition[] = [
  { key: "blue", accent: home_hero_agent_accent, aria_label: "Agent 1" },
  { key: "green", accent: home_hero_agent_accent, aria_label: "Agent 2" },
  { key: "rust", accent: home_hero_agent_accent, aria_label: "Agent 3" },
  { key: "violet", accent: home_hero_agent_accent, aria_label: "Agent 4" },
  { key: "red", accent: home_hero_agent_accent, aria_label: "Agent 5" },
] as const;

/** 首次进入首页时默认延续到 Product World 的 Ghost。 */
export const default_home_ghost = home_ghosts[0];
