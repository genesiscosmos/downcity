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
    /**
     * 首页定义段。
     *
     * 为什么需要：首页原有可见正文约 476 词，且 `agent harness` 只出现 2 次。
     * 这个品类词是本项目最有价值的搜索入口（Microsoft / LangChain / Databricks /
     * n8n / DeepSeek 都在打），首页需要一段可被读取的定义型正文，同时为 AI 答案
     * 引擎提供可直接引用的句子。
     */
    definition_eyebrow: "What is an agent harness?",
    definition_body:
      "An agent harness is the runtime layer around a model: it owns the execution loop, tool calls, context and memory, permissions, and recovery. The model reasons; the harness makes that reasoning executable, observable, and repeatable. Downcity ships that harness together with the productization kits — City, Federation, SDKs, and UI — so a working agent can become a product that keeps running.",
    learn_title: "Go deeper",
    learn_description:
      "Long-form explanations of the agent runtime layer, and how it differs from the frameworks and protocols around it.",
    learn_links: {
      what_is_harness: {
        title: "What is an agent harness?",
        description:
          "The runtime layer that turns a language model into a working agent, and how it differs from a framework or MCP.",
      },
      anatomy: {
        title: "The anatomy of an agent harness",
        description:
          "One request traced end to end, the ten subsystems behind it, and a diagnostic table for production symptoms.",
      },
      vs_mcp: {
        title: "Agent harness vs MCP",
        description:
          "Why they are different layers rather than rivals, and how they compose for a single tool call.",
      },
      whitepaper: {
        title: "Agent Harness whitepaper",
        description:
          "When agents enter production: human control, collaboration, and context.",
      },
    },
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
    // 中文 title 必须与英文差异化：zh 页面沿用英文 title 会在中文搜索中失去品类词
    // 竞争力，并被判定为疑似重复内容。
    // 同时必须带上中文检索词：中文搜索生态用「智能体」，只用 Agent 无法进入中文长尾池。
    meta_title: "Downcity — 开源 Agent Harness（智能体运行时）与 Agent 产品化 Kit",
    meta_description:
      "Downcity 是一套开源 Agent Harness（智能体运行时）与 Agent 产品化 Kit，用于运行 Agent，并把 Agent 变成可持续交付的产品。",
    definition_eyebrow: "什么是 Agent Harness？",
    definition_body:
      "Agent Harness（智能体运行时）是包裹在模型外的那一层：它负责执行循环、工具调用、上下文与记忆、权限边界和失败恢复。模型负责推理，Harness 让推理变得可执行、可观测、可重复。Downcity 把这一层运行时和产品化 Kit —— City、Federation、SDK 与 UI —— 一起开源，让能跑起来的 Agent 真正成为可以持续运行的产品。",
    learn_title: "深入了解",
    learn_description:
      "关于 Agent 运行时层的长文说明，以及它和周边框架、协议之间的边界。",
    learn_links: {
      what_is_harness: {
        title: "什么是 Agent Harness？",
        description:
          "让语言模型变成可工作 Agent 的运行时层，以及它与框架、MCP 的区别。",
      },
      anatomy: {
        title: "Agent Harness 的解剖",
        description:
          "把一个请求从头到尾拆开：背后的十个子系统，以及生产环境症状的排查对照表。",
      },
      vs_mcp: {
        title: "Agent Harness 与 MCP 的区别",
        description:
          "它们为什么是不同层次而不是竞争关系，以及一次工具调用中如何协作。",
      },
      whitepaper: {
        title: "Agent Harness 白皮书",
        description: "当 Agent 进入生产环境：人的控制权、协作方式与上下文。",
      },
    },
  },
} as const;
