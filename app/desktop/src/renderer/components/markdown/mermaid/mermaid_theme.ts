/**
 * Desktop Mermaid 的主题绑定。
 *
 * Mermaid 自带一套与宿主无关的颜色体系：默认 `theme: "default"` 画出来的是浅色节点加紫色
 * 连线，在 Desktop 的九套主题（尤其是深色模式）里都像贴上去的图。这里把当前主题的语义令牌
 * 翻译成 Mermaid 的 `themeVariables`，并用 `themeCSS` 补齐 Mermaid 默认样式与 Desktop 排版
 * 不一致的部分：描边过粗、节点没有圆角、连线颜色过亮、cluster 底色太重、标签字号与正文字号
 * 脱节。
 *
 * 所有颜色都在每次渲染时从 `document.documentElement` 读取，因此切换主题或明暗模式后重新
 * 渲染的图表会直接跟随，不需要额外的状态同步。
 */

import type { MermaidConfig } from "mermaid";

/** Mermaid 渲染需要的一组具体颜色值；字段与 Desktop 语义令牌一一对应。 */
export type MermaidThemeTokens = {
  /** 内容底色（--background）：画布背景与边标签底色。 */
  background: string;
  /** 正文色（--foreground）：标题与派生色阶的暗端。 */
  foreground: string;
  /** 卡片表面（--card）：节点、参与者、实体方框的填充色。 */
  card: string;
  /** 卡片正文色（--card-foreground）：节点内文字颜色。 */
  card_foreground: string;
  /** 弱化表面（--muted）：边标签背景、次级填充。 */
  muted: string;
  /** 次要文字色（--muted-foreground）：连线、箭头与边标签文字。 */
  muted_foreground: string;
  /** 主色（--primary）：图表强调色，也是色阶的基底。 */
  primary: string;
  /** 主色前景（--primary-foreground）：序号等叠在主色上的文字。 */
  primary_foreground: string;
  /** 次级表面（--secondary）：note、时序图区块底色。 */
  secondary: string;
  /** 次级表面正文（--secondary-foreground）。 */
  secondary_foreground: string;
  /** 强调表面（--accent）：激活条、交替区块。 */
  accent: string;
  /** 强调表面正文（--accent-foreground）。 */
  accent_foreground: string;
  /** 描边色（--border）：节点与 cluster 的边框。 */
  border: string;
  /** 界面字体栈（--font-sans）：图表文字必须与正文同字体。 */
  font_family: string;
  /** 多色图表（饼图、象限图、git graph）使用的色阶，统一由主色派生。 */
  chart_palette: readonly string[];
};

/** 读取主题令牌失败时的兜底取值；与 Duobox 浅色主题一致。 */
export const DEFAULT_MERMAID_THEME_TOKENS: MermaidThemeTokens = {
  background: "rgb(255, 255, 255)",
  foreground: "rgb(10, 10, 10)",
  card: "rgb(255, 255, 255)",
  card_foreground: "rgb(10, 10, 10)",
  muted: "rgb(245, 245, 245)",
  muted_foreground: "rgb(115, 115, 115)",
  primary: "rgb(23, 23, 23)",
  primary_foreground: "rgb(250, 250, 250)",
  secondary: "rgb(245, 245, 245)",
  secondary_foreground: "rgb(23, 23, 23)",
  accent: "rgb(245, 245, 245)",
  accent_foreground: "rgb(23, 23, 23)",
  border: "rgb(229, 229, 229)",
  font_family: "ui-sans-serif, system-ui, -apple-system, sans-serif",
  chart_palette: ["rgb(145, 197, 255)", "rgb(58, 129, 246)", "rgb(37, 99, 239)", "rgb(26, 78, 218)", "rgb(31, 63, 173)"],
};

/*
 * 字号与取整的固定像素说明：themeCSS 写进的是 Mermaid 自己按像素计算布局结果的 SVG。
 * 这里不能用 rem —— 图表内部坐标、字体度量与 viewBox 是同一套像素单位，混入跟随界面缩放的
 * 相对单位会让标签与节点尺寸互相错位。整张图随后由 CSS 等比缩放，观感不会被钉死。
 */

const hex_color_pattern = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const rgb_color_pattern = /^rgba?\(([^)]+)\)$/i;

/** 把 `#rgb` / `#rrggbb` / `rgb()` / `rgba()` 解析为 RGB 三元组；无法解析时返回 null。 */
function parse_color(value: string): [number, number, number] | null {
  const normalized = value.trim();
  const hex_match = normalized.match(hex_color_pattern);
  if (hex_match) {
    const hex = hex_match[1]!;
    const expanded = hex.length === 3 ? hex.split("").map((channel) => channel + channel).join("") : hex;
    return [Number.parseInt(expanded.slice(0, 2), 16), Number.parseInt(expanded.slice(2, 4), 16), Number.parseInt(expanded.slice(4, 6), 16)];
  }

  const rgb_match = normalized.match(rgb_color_pattern);
  if (!rgb_match) return null;
  const channels = rgb_match[1]!.split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
  if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) return null;
  return [channels[0]!, channels[1]!, channels[2]!];
}

/**
 * 把两个颜色按权重混合成 `rgb()` 字面量。
 *
 * Mermaid 会用 khroma 从主题色派生出一整组颜色，因此这里必须给出具体颜色值，
 * 不能把 `var(--primary)` 或 `color-mix()` 交给它。weight 是 overlay 的占比。
 */
export function mix_color(base: string, overlay: string, weight: number): string {
  const base_rgb = parse_color(base);
  const overlay_rgb = parse_color(overlay);
  if (!base_rgb || !overlay_rgb) return base;

  const ratio = Math.min(1, Math.max(0, weight));
  const mixed = base_rgb.map((channel, index) => Math.round(channel + (overlay_rgb[index]! - channel) * ratio));
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}

/** 由主色向背景、前景两端展开的色阶；保证在明暗主题下都是单调节奏。 */
export function build_chart_palette(tokens: Pick<MermaidThemeTokens, "primary" | "background" | "foreground">): string[] {
  return [
    mix_color(tokens.primary, tokens.background, 0.55),
    mix_color(tokens.primary, tokens.background, 0.25),
    tokens.primary,
    mix_color(tokens.primary, tokens.foreground, 0.28),
    mix_color(tokens.primary, tokens.foreground, 0.55),
  ];
}

/** 读取一个语义令牌的计算值。 */
function read_css_token(variable_name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(variable_name).trim() || fallback;
}

/** 按当前主题读取全部 Mermaid 主题令牌。 */
export function read_mermaid_theme_tokens(): MermaidThemeTokens {
  const tokens: Omit<MermaidThemeTokens, "chart_palette"> = {
    background: read_css_token("--background", DEFAULT_MERMAID_THEME_TOKENS.background),
    foreground: read_css_token("--foreground", DEFAULT_MERMAID_THEME_TOKENS.foreground),
    card: read_css_token("--card", DEFAULT_MERMAID_THEME_TOKENS.card),
    card_foreground: read_css_token("--card-foreground", DEFAULT_MERMAID_THEME_TOKENS.card_foreground),
    muted: read_css_token("--muted", DEFAULT_MERMAID_THEME_TOKENS.muted),
    muted_foreground: read_css_token("--muted-foreground", DEFAULT_MERMAID_THEME_TOKENS.muted_foreground),
    primary: read_css_token("--primary", DEFAULT_MERMAID_THEME_TOKENS.primary),
    primary_foreground: read_css_token("--primary-foreground", DEFAULT_MERMAID_THEME_TOKENS.primary_foreground),
    secondary: read_css_token("--secondary", DEFAULT_MERMAID_THEME_TOKENS.secondary),
    secondary_foreground: read_css_token("--secondary-foreground", DEFAULT_MERMAID_THEME_TOKENS.secondary_foreground),
    accent: read_css_token("--accent", DEFAULT_MERMAID_THEME_TOKENS.accent),
    accent_foreground: read_css_token("--accent-foreground", DEFAULT_MERMAID_THEME_TOKENS.accent_foreground),
    border: read_css_token("--border", DEFAULT_MERMAID_THEME_TOKENS.border),
    font_family: read_css_token("--font-sans", DEFAULT_MERMAID_THEME_TOKENS.font_family),
  };

  return { ...tokens, chart_palette: build_chart_palette(tokens) };
}

/**
 * Mermaid 的结构性配置。与主题无关，因此不随主题变化；改动这里等于改动所有图表的布局密度。
 */
export const MERMAID_BASE_CONFIG = {
  startOnLoad: false,
  theme: "base",
  // 图表源码来自模型输出；strict 关闭点击回调与任意 HTML 标签，图表只被当作图形绘制。
  securityLevel: "strict",
  htmlLabels: false,
  deterministicIds: true,
  // 失败时不要往 DOM 里塞一个红色错误图；错误由 Desktop 自己呈现。
  suppressErrorRendering: true,
  fontSize: 14,
  maxTextSize: 100_000,
  flowchart: { curve: "basis", htmlLabels: false, padding: 12, nodeSpacing: 32, rankSpacing: 42, diagramPadding: 12 },
  sequence: { actorMargin: 64, messageMargin: 40, mirrorActors: false, showSequenceNumbers: false },
  state: { defaultRenderer: "dagre-wrapper" },
} satisfies MermaidConfig;

/** Mermaid 默认描边约 2px、节点直角、连线接近纯色；这里统一压到与 Desktop 卡片一致的密度。 */
function build_theme_css(tokens: MermaidThemeTokens): string {
  return `
    .node rect,
    .node circle,
    .node ellipse,
    .node polygon,
    .node path,
    .actor,
    .entityBox,
    .classBox,
    .statediagram-state rect {
      stroke-width: 1px;
    }

    .node rect,
    .actor,
    .entityBox,
    .classBox,
    .statediagram-state rect {
      rx: 6px;
      ry: 6px;
    }

    .flowchart-link,
    .edgePath path,
    .transition,
    .messageLine0,
    .messageLine1,
    .relation {
      stroke: ${tokens.muted_foreground};
      stroke-opacity: 0.72;
      stroke-width: 1.1px;
    }

    marker path {
      fill: ${tokens.muted_foreground};
      stroke: ${tokens.muted_foreground};
      opacity: 0.8;
    }

    .edgeLabel rect,
    .labelBkg {
      fill: ${tokens.muted};
      opacity: 0.96;
    }

    .cluster rect {
      fill: ${tokens.foreground};
      fill-opacity: 0.028;
      stroke: ${tokens.border};
      stroke-opacity: 0.72;
      stroke-width: 1px;
      rx: 10px;
      ry: 10px;
    }

    .node .label text,
    .nodeLabel,
    .messageText,
    .actor,
    .classText,
    .stateLabel,
    .entityLabel {
      font-size: 14px;
      font-weight: 500;
      letter-spacing: -0.012em;
    }

    .edgeLabel,
    .edgeLabel text {
      fill: ${tokens.muted_foreground};
      font-size: 12px;
      font-weight: 400;
    }

    .cluster-label,
    .cluster-label text,
    .titleText {
      fill: ${tokens.muted_foreground};
      font-size: 12.5px;
      font-weight: 500;
      letter-spacing: -0.01em;
    }
  `;
}

/** 把主题令牌与结构配置合成一次 `mermaid.initialize` 需要的完整配置。 */
export function build_mermaid_config(tokens: MermaidThemeTokens, deterministic_id_seed: string): MermaidConfig {
  return {
    ...MERMAID_BASE_CONFIG,
    deterministicIDSeed: deterministic_id_seed,
    fontFamily: tokens.font_family,
    themeCSS: build_theme_css(tokens),
    themeVariables: {
      fontSize: "14px",
      fontFamily: tokens.font_family,
      background: tokens.background,
      mainBkg: tokens.card,
      primaryColor: tokens.card,
      primaryTextColor: tokens.card_foreground,
      primaryBorderColor: tokens.border,
      secondaryColor: tokens.secondary,
      secondaryTextColor: tokens.secondary_foreground,
      secondaryBorderColor: tokens.border,
      tertiaryColor: tokens.muted,
      tertiaryTextColor: tokens.foreground,
      tertiaryBorderColor: tokens.border,
      textColor: tokens.foreground,
      titleColor: tokens.foreground,
      lineColor: tokens.muted_foreground,
      edgeLabelBackground: tokens.background,
      nodeBorder: tokens.border,
      clusterBkg: tokens.background,
      clusterBorder: tokens.border,
      noteBkgColor: tokens.secondary,
      noteTextColor: tokens.secondary_foreground,
      noteBorderColor: tokens.border,
      actorBkg: tokens.card,
      actorBorder: tokens.border,
      actorTextColor: tokens.card_foreground,
      actorLineColor: tokens.muted_foreground,
      signalColor: tokens.muted_foreground,
      signalTextColor: tokens.foreground,
      loopTextColor: tokens.foreground,
      activationBkgColor: tokens.accent,
      activationBorderColor: tokens.border,
      sequenceNumberColor: tokens.primary_foreground,
      sectionBkgColor: tokens.secondary,
      altSectionBkgColor: tokens.muted,
      gridColor: tokens.border,
      c0: tokens.chart_palette[0],
      c1: tokens.chart_palette[1],
      c2: tokens.chart_palette[2],
      c3: tokens.chart_palette[3],
      c4: tokens.chart_palette[4],
    },
  };
}
