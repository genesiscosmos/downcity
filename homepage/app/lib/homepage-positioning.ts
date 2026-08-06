/**
 * Downcity Homepage 核心定位文案。
 *
 * Hero、能力区、Footer、SEO 与结构化数据共享同一份定位来源，确保搜索引擎读取的
 * 品类定义与用户在首页看到的品牌表达保持一致。
 */
export const homepage_positioning = {
  en: {
    hero_headline: "Build worlds where agents live, work, and collaborate.",
    hero_description:
      "Downcity is a set of open-source kits for running agents and turning them into products. Agent Harness provides the runtime; City, Federation, SDKs, and UI kits make products easy to package, operate, and scale.",
    features_title: "From agent runtime",
    features_title_emphasis: "to product.",
    features_description:
      "Compose the harness and productization kits around your use case: give agents a reliable runtime, then add the product boundary, shared services, and interfaces your users need.",
    footer_tagline:
      "Open-source kits for running agents and shipping agent products.",
    meta_title: "Downcity — Agent Harness + Agent Productization Kits",
    meta_description:
      "Downcity is a set of open-source Agent Harness and Agent Productization Kits for running agents and shipping reliable agent products.",
  },
  zh: {
    hero_headline: "创造 Agent 居住、工作与协作的世界。",
    hero_description:
      "Downcity 是一套开源 Kit：用 Agent Harness 运行 Agent，再用 City、Federation、SDK 与 UI 等 Agent Productization Kits，把 Agent 变成可交付、可运营、可扩展的产品。",
    features_title: "从 Agent 运行时",
    features_title_emphasis: "到产品化交付。",
    features_description:
      "按你的场景组合这些 Kit：先给 Agent 一个可靠的运行时，再补上产品边界、共享服务与用户界面，让它真正成为可以交付和持续运营的产品。",
    footer_tagline: "一套用于运行 Agent、交付 Agent 产品的开源 Kits。",
    meta_title: "Downcity — Agent Harness + Agent Productization Kits",
    meta_description:
      "Downcity 是一套开源 Agent Harness 与 Agent Productization Kits，用于运行 Agent，并将其产品化交付。",
  },
} as const;
