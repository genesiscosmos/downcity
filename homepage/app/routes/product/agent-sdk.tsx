import { ProductDetailSection, type ProductDetailContent } from "@/components/sections/ProductDetailSection";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { create_page_meta, get_path_locale } from "@/lib/seo";
import type { Route } from "./+types/agent-sdk";

/** 子路由独立 meta，避免四个 /product/* 页共用同一组 title 与 description。 */
export function meta({ location }: Route.MetaArgs) {
  const is_chinese = get_path_locale(location.pathname) === "zh";

  return create_page_meta({
    title: is_chinese
      ? "Agent SDK：把本地与远程 Agent 嵌入你的应用 — Downcity"
      : "Agent SDK: Embed Local and Remote Agents — Downcity",
    description: is_chinese
      ? "用同一个 SDK 嵌入本地 Agent 或调用远程 HTTP Agent：以 Session 组织 run、stream、history、fork，并显式组合 Plugin 与 Tool。"
      : "Embed local Agents or call remote HTTP Agents with one SDK: sessions for run, stream, history and fork, plus explicit plugin and tool composition.",
    pathname: location.pathname,
    twitter_card: "summary_large_image",
    localized: true,
  });
}

const PAGE: Record<"zh" | "en", ProductDetailContent> = {
  zh: {
    title: "Product · Agent SDK",
    subtitle:
      "把本地 Agent、RemoteAgent、Session 与 Plugin 组合进你的应用流程，让 Agent 真正成为可嵌入的执行层。",
    docsCtaLabel: "查看 Agent SDK 文档",
    docsCtaHint: "接入方式、Session、Plugin 与 API 说明都已经拆到独立的 agent-sdk-docs 中。",
    highlights: [
      {
        title: "本地 Agent 与远程 Agent 双入口",
        description: "同一套 SDK 既支持本地嵌入式 Agent，也支持通过 RemoteAgent 调用远程 HTTP Agent。",
      },
      {
        title: "围绕 Session 组织执行",
        description: "把 run、stream、history、fork 这些核心执行面稳定收束到 Session 模型上，方便应用侧持续集成。",
      },
      {
        title: "显式组合 Plugin 与 Tool",
        description: "让调用方自己决定要注入哪些 plugin 和 tool，而不是依赖平台自动装配。",
      },
    ],
    scenesTitle: "典型场景",
    scenes: [
      "本地嵌入：在 Node 应用里直接 new Agent，把能力嵌进已有业务流。",
      "远程调用：用 RemoteAgent 连接已经暴露 HTTP 接口的 Agent 服务。",
      "能力编排：围绕 Session、Plugin 与 Tool 组合你自己的执行壳。",
    ],
    factsTitle: "事实对齐",
    facts: [
      "包名：@downcity/agent",
      "核心源码目录：packages/agent/",
      "核心入口：Agent / RemoteAgent / Session",
    ],
  },
  en: {
    title: "Product · Agent SDK",
    subtitle:
      "Compose local Agents, RemoteAgent clients, sessions, and plugins into your application flow so the agent becomes an embeddable execution layer.",
    docsCtaLabel: "Open Agent SDK Docs",
    docsCtaHint: "Integration, sessions, plugins, and API guidance now live in the standalone agent-sdk-docs site.",
    highlights: [
      {
        title: "Two entry points: local and remote",
        description: "Use the same SDK for an embedded local Agent or for a RemoteAgent HTTP client that talks to another runtime.",
      },
      {
        title: "Execution organized around Session",
        description: "Keep run, stream, history, and fork centered on the Session model so application integration stays stable.",
      },
      {
        title: "Explicit plugin and tool composition",
        description: "Let the caller decide which plugins and tools are mounted instead of relying on automatic platform assembly.",
      },
    ],
    scenesTitle: "Typical Scenarios",
    scenes: [
      "Local embedding: instantiate Agent inside a Node app and wire it into an existing business flow.",
      "Remote calling: use RemoteAgent against an HTTP-exposed agent runtime.",
      "Capability composition: shape your own execution shell with sessions, plugins, and tools.",
    ],
    factsTitle: "Facts",
    facts: [
      "Package name: @downcity/agent",
      "Core source directory: packages/agent/",
      "Core entry points: Agent / RemoteAgent / Session",
    ],
  },
};

export default function ProductAgentSdkPage() {
  // 语言必须来自 URL：i18next 单例在服务端固定为 en，用 i18n.language 会把 /zh/ 预渲染成英文正文。
  const locale = use_interface_locale();
  const isZh = locale === "zh";
  const content = isZh ? PAGE.zh : PAGE.en;
  const docsPath = isZh ? "/zh/agent-sdk-docs/" : "/en/agent-sdk-docs/";

  return <ProductDetailSection content={content} docsPath={docsPath} isZh={isZh} />;
}
