/**
 * 首页可选择 Ghost 的视觉身份配置。
 *
 * 城市中的可选居民只展示图形本身；颜色会一路延续到 Product World，
 * 因此每个配置代表同一个 Agent 的稳定身份，而非临时装饰状态。
 */

import type { HomeGhostDefinition } from "@/types/home/HomeGhost";

/** Hero 城市中按固定顺序展示的五个 Ghost。 */
export const home_ghosts: readonly HomeGhostDefinition[] = [
  { key: "blue", accent: "#4f6f9f", aria_label: "Blue Ghost" },
  { key: "green", accent: "#557b70", aria_label: "Green Ghost" },
  { key: "rust", accent: "#9a6b5d", aria_label: "Rust Ghost" },
  { key: "violet", accent: "#716a9f", aria_label: "Violet Ghost" },
  { key: "red", accent: "#b45d4c", aria_label: "Red Ghost" },
] as const;

/** 首次进入首页时默认延续到 Product World 的 Ghost。 */
export const default_home_ghost = home_ghosts[0];
