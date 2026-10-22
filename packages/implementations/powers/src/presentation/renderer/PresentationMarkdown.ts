/**
 * Presentation 的 Markdown 桥接：结构化内容与宿主正文共用同一套 Markdown 方言。
 *
 * ## 为什么需要这一层
 *
 * 结构化内容里必然夹着正文：卡片文字、步骤详情、Callout 说明、独立的 Markdown 区块。
 * 上游 OpenUI 把这些位置交给它自己的 `MarkDownRenderer`，而那个渲染器**没有默认 remark
 * 插件**，也没有图表能力：
 *
 * - 管道表格不会变成 `<table>`，而是原样输出成一行带竖线的文字；
 * - 围栏图表不认 `mermaid`，整个上游组件库不依赖 Mermaid，Prism 只把源码当普通代码高亮；
 * - 本地图片路径不会被解析为宿主受控协议，公式也不走 KaTeX。
 *
 * 宿主（Desktop）已有完整的方言实现：GFM、KaTeX、模型产出的围栏图表（主题令牌、渲染队列、
 * 结果缓存）与清洗。让 Power 声明「这段文字有多重要」、由宿主决定排版，比在 Power 里再养
 * 一套图表实现要合理：后者约 1MB，且会与宿主那套在主题和缓存上各说各话。
 *
 * ## 与上游的关系
 *
 * 本模块只替换注册组件的 `component`，**复用上游 props schema**，因此
 * `openui-catalog.json`（由 `PRESENTATION_LIBRARY` 生成）与模型提示保持逐字节不变。
 * `Callout` 的可见性绑定、`Steps` 的编号与连接线、`TextContent` 的档位语义仍由上游渲染
 * 组件承担，这里只把它们内部的 Markdown 文本换成宿主渲染结果。
 *
 * 宿主没有提供端口时（Node 测试、独立预览）整体退回上游组件：能力较弱，但结构与交互不变。
 *
 * ## 拆分理由
 *
 * 「某个组件要渲染哪段文字」是纯映射，「怎么把它渲染出来」依赖 React。两者分开后，
 * 映射可以在不挂载 DOM 的前提下逐项核对（见 `scripts/presentation-markdown.test.mjs`）。
 */
import { createContext, createElement, useContext, useEffect, type ReactNode } from "react";
import { useStateField } from "@openuidev/react-lang";
import type { DefinedComponent } from "@openuidev/lang-core";
import { Callout as OpenUICallout, Steps as OpenUISteps, StepsItem as OpenUIStepsItem } from "@openuidev/react-ui";
import type { PowerMarkdownRenderRequest } from "@downcity/city/power/react";
import type { PresentationMarkdownProps } from "../types/Markdown.js";

/** 宿主 Markdown 渲染端口；由渲染入口从消息属性注入，未提供时为 undefined。 */
export const PresentationMarkdownContext = createContext<((request: PowerMarkdownRenderRequest) => ReactNode) | undefined>(undefined);

/** 上游 `TextContent` 的档位到宿主语义档位的映射。 */
const text_size_map: Record<string, PowerMarkdownRenderRequest["size"]> = {
  small: "small",
  "small-heavy": "small",
  default: "body",
  large: "large",
  "large-heavy": "large",
};

/** `Callout` 的 error 变体在上游并入 warning，迁移时保持同一映射。 */
const callout_variant_map: Record<string, "neutral" | "info" | "warning" | "success"> = {
  info: "info",
  warning: "warning",
  success: "success",
  error: "warning",
  neutral: "neutral",
};

/** 属性里的字符串；不是字符串时返回空串，交由调用方决定回退。 */
function read_text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 一步的详情：字符串走 Markdown，OpenUI 语句引用由上游 `renderNode` 处理。 */
export interface PresentationStepDetails {
  /** 详情原文；不是字符串时表示该位置引用另一段 OpenUI 语句。 */
  readonly text: string | null;
  /** 标题。 */
  readonly title: string;
  /** 未解析的原始详情值；`text` 为 null 时交给 `renderNode`。 */
  readonly raw: unknown;
}

/**
 * 计算某个上游组件应当交给宿主的 Markdown 请求。
 *
 * 返回 `null` 表示该组件不需要宿主渲染：不是消费 Markdown 的组件、文本为空，
 * 或文本位置实际上是 OpenUI 语句引用（由 `renderNode` 负责，不能当 Markdown 解析）。
 */
export function resolve_markdown_request(name: string, props: Record<string, unknown>): PowerMarkdownRenderRequest | null {
  /** 组装请求；文本为空或不是字符串时返回 null。 */
  const build = (value: unknown, size: PowerMarkdownRenderRequest["size"], heavy: boolean, variant: PowerMarkdownRenderRequest["variant"]) => {
    const text = read_text(value);
    return text.trim() ? { text, size, heavy, variant, streaming: false } : null;
  };

  if (name === "MarkDownRenderer") {
    const variant = props.variant;
    return build(props.textMarkdown, "body", false, variant === "card" || variant === "sunk" ? variant : "clear");
  }
  if (name === "TextContent") {
    const size = read_text(props.size) || "default";
    return build(props.text, text_size_map[size] ?? "body", size.endsWith("-heavy"), "clear");
  }
  if (name === "Callout") return build(props.description, "body", false, "clear");
  return null;
}

/** 读取 `Steps` 的每一项；非数组时返回空列表。 */
export function resolve_step_details(props: Record<string, unknown>): PresentationStepDetails[] {
  if (!Array.isArray(props.items)) return [];
  return props.items.map((item) => {
    const item_props = (item as { props?: Record<string, unknown> })?.props ?? {};
    return { text: typeof item_props.details === "string" ? item_props.details : null, title: read_text(item_props.title), raw: item_props.details };
  });
}

/** 上游 `Callout`：保留可见性绑定与自动消失，只替换说明的渲染方式。 */
function PresentationCallout(props_: PresentationMarkdownProps, render: (request: PowerMarkdownRenderRequest) => ReactNode) {
  const { props } = props_;
  const field = useStateField<unknown>("visible", props.visible);
  const is_visible = field.isReactive ? field.value === true || field.value === "true" : true;
  useEffect(() => {
    if (!field.isReactive || !is_visible) return;
    const timer = setTimeout(() => field.setValue(false), 3000);
    return () => clearTimeout(timer);
  }, [field.isReactive, is_visible, field]);
  if (!is_visible) return null;
  const request = resolve_markdown_request("Callout", props);
  return createElement(OpenUICallout, {
    variant: callout_variant_map[read_text(props.variant)] ?? "info",
    title: read_text(props.title),
    description: request ? render(request) : read_text(props.description),
    duration: field.isReactive ? 3000 : undefined,
  });
}

/** 上游 `Steps`：编号与连接线仍由上游维护，只替换每一步详情的渲染方式。 */
function PresentationSteps(props_: PresentationMarkdownProps, render: (request: PowerMarkdownRenderRequest) => ReactNode) {
  return createElement(OpenUISteps, null, ...resolve_step_details(props_.props).map((step, index) => {
    // 空字符串仍是文本（上游会把它当空 Markdown 渲染），只有非字符串才是语句引用。
    const request = step.text === null ? null : resolve_markdown_request("MarkDownRenderer", { textMarkdown: step.text });
    const details = step.text === null ? props_.renderNode(step.raw) : request ? render(request) : read_text("");
    return createElement(OpenUIStepsItem, { key: index, number: index + 1, title: step.title, details });
  }));
}

/** 消费 Markdown 文本、且文本属于块级正文的上游组件。 */
const markdown_targets = new Set(["MarkDownRenderer", "TextContent", "Callout", "Steps"]);

/**
 * 让消费 Markdown 的上游组件改用宿主方言；其余组件原样返回。
 *
 * 只在宿主提供端口时接管；没有端口就整体交给上游组件，避免同一份内容出现两种渲染路径。
 */
export function adapt_presentation_markdown<T extends DefinedComponent>(definition: T): T {
  if (!markdown_targets.has(definition.name)) return definition;
  const Original = definition.component as (props: PresentationMarkdownProps) => ReactNode;
  function PresentationMarkdown(props: PresentationMarkdownProps) {
    const render = useContext(PresentationMarkdownContext);
    if (!render) return Original(props);
    if (definition.name === "Callout") return PresentationCallout(props, render);
    if (definition.name === "Steps") return PresentationSteps(props, render);
    const request = resolve_markdown_request(definition.name, props.props);
    return request ? render(request) : Original(props);
  }
  return { ...definition, component: PresentationMarkdown };
}
