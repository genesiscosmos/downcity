import { ProductDetailSection, type ProductDetailContent } from "@/components/sections/ProductDetailSection";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { create_page_meta, get_path_locale } from "@/lib/seo";
import type { Route } from "./+types/ui-sdk";

/** 子路由独立 meta，避免四个 /product/* 页共用同一组 title 与 description。 */
export function meta({ location }: Route.MetaArgs) {
  const is_chinese = get_path_locale(location.pathname) === "zh";

  return create_page_meta({
    title: is_chinese
      ? "UI SDK：构建 Agent 工作台的可复用 UI 组件 — Downcity"
      : "UI SDK: Reusable Components for Agent Workspaces — Downcity",
    description: is_chinese
      ? "复用 Downcity 面向 Agent 工作台的交互语言与组件模式，让团队更快搭建视觉与体验一致的 Agent 控制台。"
      : "Reuse Downcity's agent workspace interaction language: component patterns derived from real product surfaces, so teams ship consistent agent consoles faster.",
    pathname: location.pathname,
    twitter_card: "summary_large_image",
    localized: true,
  });
}

const PAGE: Record<"zh" | "en", ProductDetailContent> = {
  zh: {
    title: "Product · Downcity UI SDK",
    subtitle: "把 Downcity 的交互语言复用到你的产品里，让 Agent 工作台搭建更快、更统一。",
    docsCtaLabel: "查看 UI SDK 文档",
    docsCtaHint: "接入方式、模块清单、开发指南都在独立的 ui-sdk-docs 中。",
    highlights: [
      {
        title: "统一视觉与交互",
        description: "继承 Downcity 面向 Agent 工作台的信息组织方式，保持团队界面体验一致。",
      },
      {
        title: "降低 UI 搭建成本",
        description: "围绕 Agent 场景复用组件模式，减少重复造轮子。",
      },
      {
        title: "从产品形态反推组件能力",
        description: "以真实 Agent 工作台场景沉淀可复用 UI 原语，而不是抽象空组件。",
      },
    ],
    scenesTitle: "典型场景",
    scenes: [
      "自研控制台：基于一致的组件模式快速搭建内部 Agent 面板。",
      "品牌化落地：在保留能力结构的同时做你自己的视觉包装。",
      "多产品统一：让多个团队产品共享同一套 Agent UI 语言。",
    ],
    factsTitle: "事实对齐",
    facts: [
      "包名：@downcity/ui",
      "源码目录：packages/ui/",
      "当前组件能力来源：packages/ui 与 homepage 的基础组件抽离",
    ],
  },
  en: {
    title: "Product · Downcity UI SDK",
    subtitle:
      "Reuse Downcity's interaction language in your own product and build agent workspaces with consistent UX.",
    docsCtaLabel: "Open UI SDK Docs",
    docsCtaHint: "Integration, modules, and implementation guidance live in the standalone ui-sdk-docs site.",
    highlights: [
      {
        title: "Consistent visual and interaction model",
        description: "Carry over agent workspace information architecture for predictable team experience.",
      },
      {
        title: "Lower UI build cost",
        description: "Reuse agent-focused component patterns instead of rebuilding every surface.",
      },
      {
        title: "Components shaped by real product use",
        description: "Patterns are derived from practical agent workspace workflows, not abstract-only UI demos.",
      },
    ],
    scenesTitle: "Typical Scenarios",
    scenes: [
      "Internal console: ship your own agent workspace faster with proven UI patterns.",
      "Brand adaptation: keep capability structure while applying your own visual identity.",
      "Multi-product consistency: share one agent UI language across teams.",
    ],
    factsTitle: "Facts",
    facts: [
      "Package name: @downcity/ui",
      "Source directory: packages/ui/",
      "Current capability source: shared primitives extracted from packages/ui and homepage",
    ],
  },
};

export default function ProductUiSdkPage() {
  // 语言必须来自 URL：i18next 单例在服务端固定为 en，用 i18n.language 会把 /zh/ 预渲染成英文正文。
  const locale = use_interface_locale();
  const isZh = locale === "zh";
  const content = isZh ? PAGE.zh : PAGE.en;
  const docsPath = isZh ? "/zh/ui-sdk-docs/" : "/en/ui-sdk-docs/";

  return <ProductDetailSection content={content} docsPath={docsPath} isZh={isZh} />;
}
