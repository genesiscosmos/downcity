import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  IconAppWindow,
  IconArrowRight,
  IconBuildingSkyscraper,
  IconRobot,
} from "@tabler/icons-react";

const page_content = {
  zh: {
    badge: "Product",
    title: "给 AI builders 的 Agent 基础设施产品矩阵",
    subtitle:
      "Downcity 不是单点工具，而是一套可复用运行层：本地 Agent 宿主、Agent SDK、City SDK 与 UI SDK 共同支撑多个 Agent 产品和工作流。",
    logicBadge: "Product Logic",
    logicTitle: "Products、Agents 与 City Runtime",
    logicSubtitle:
      "产品负责真实体验，Agent 负责执行任务，Downcity runtime 负责模型、工具、任务、记忆、权限、用量、计费、服务和可观测性这类重复基础设施。",
    flow: [
      { title: "Products", desc: "AI 产品与工作流入口", icon: IconAppWindow },
      { title: "Agents", desc: "长期运行和执行任务", icon: IconRobot },
      { title: "City Runtime", desc: "模型 / 服务 / 权限 / 用量 / 计费", icon: IconBuildingSkyscraper },
    ],
    notes: [
      { title: "Products", desc: "可以是网页、扩展、桌面端、移动端、客户 Demo、内部工具或 API Host。" },
      { title: "Agents", desc: "在明确边界里运行，处理任务、上下文、工具调用和长期状态。" },
      { title: "City Runtime", desc: "把多个产品都会重复建设的 Agent 后端能力收束成可复用基础设施。" },
    ],
    cards: [
      {
        id: "cli",
        title: "Downcity CLI",
        desc: "官方命令行：初始化、启动、管理和调试本地 Agent runtime。",
        source: "packages/cli/",
      },
      {
        id: "sdk",
        title: "City SDK",
        desc: "把模型目录、Service 路由、身份、用量、余额和支付接入你的产品体系。",
        source: "packages/agent/",
      },
      {
        id: "agent-sdk",
        title: "Agent SDK",
        desc: "把本地 Agent、RemoteAgent、Session 与 Plugin 组合进你的应用流程。",
        source: "packages/agent/",
      },
      {
        id: "ui-sdk",
        title: "Downcity UI SDK",
        desc: "复用 Downcity 的 UI 组件思路，快速搭建你的 Agent 工作台。",
        source: "packages/ui/",
      },
    ],
    factsTitle: "产品事实",
    facts: [
      "Downcity 面向 AI builders：核心价值是让多个 Agent 产品复用同一套运行基础设施。",
      "Downcity CLI：官方命令行实现，目录为 packages/cli/。",
      "City SDK：核心 runtime 与服务访问方式位于 packages/agent/。",
      "Agent SDK：本地 Agent / RemoteAgent SDK 位于 packages/agent/。",
      "Downcity UI SDK：React + Tailwind 组件包目录为 packages/ui/。",
    ],
  },
  en: {
    badge: "Product",
    title: "Agent infrastructure products for AI builders",
    subtitle:
      "Downcity is not one tool. It is one reusable runtime layer across local agent hosting, Agent SDK, City SDK, and UI SDK for many agent products and workflows.",
    logicBadge: "Product Logic",
    logicTitle: "Products, Agents, and City Runtime",
    logicSubtitle:
      "Products own the real experience, agents execute the work, and Downcity runtime owns the repeated infrastructure: models, tools, tasks, memory, permissions, usage, billing, services, and observability.",
    flow: [
      { title: "Products", desc: "AI products and workflow entry points", icon: IconAppWindow },
      { title: "Agents", desc: "Run long-lived execution", icon: IconRobot },
      { title: "City Runtime", desc: "Models / services / auth / usage / billing", icon: IconBuildingSkyscraper },
    ],
    notes: [
      { title: "Products", desc: "Can be web apps, extensions, desktop apps, mobile apps, client demos, internal tools, or API hosts." },
      { title: "Agents", desc: "Run inside explicit boundaries and handle tasks, context, tool calls, and long-term state." },
      { title: "City Runtime", desc: "Centralizes the agent backend capabilities that every new AI product would otherwise rebuild." },
    ],
    cards: [
      {
        id: "cli",
        title: "Downcity CLI",
        desc: "The official CLI for initializing, starting, managing, and debugging local agent runtime.",
        source: "packages/cli/",
      },
      {
        id: "sdk",
        title: "City SDK",
        desc: "Bring model catalogs, service routing, auth, usage, balance, and payment capabilities into your product flow.",
        source: "packages/agent/",
      },
      {
        id: "agent-sdk",
        title: "Agent SDK",
        desc: "Embed local agents, RemoteAgent clients, sessions, and plugins into your application flow.",
        source: "packages/agent/",
      },
      {
        id: "ui-sdk",
        title: "Downcity UI SDK",
        desc: "Reuse Downcity UI patterns to build your own agent-facing workspace faster.",
        source: "packages/ui/",
      },
    ],
    factsTitle: "Product Facts",
    facts: [
      "Downcity is for AI builders: the core value is reusing one runtime infrastructure across many agent products.",
      "Downcity CLI is the official command-line implementation under packages/cli/.",
      "City SDK runtime and service access helpers live in packages/agent/.",
      "Agent SDK local Agent and RemoteAgent runtime are in packages/agent/.",
      "Downcity UI SDK is the React + Tailwind component package under packages/ui/.",
    ],
  },
} as const;

/**
 * Product 概览页（Vibecape 风格）。
 * 说明：
 * 1. 顶部标题与产品逻辑图。
 * 2. 产品卡片使用 1px 细线分隔 grid。
 * 3. 事实列表使用简洁面板。
 */
export default function ProductOverviewPage() {
  const { i18n } = useTranslation();
  const is_zh = i18n.language.toLowerCase().startsWith("zh");
  const content = is_zh ? page_content.zh : page_content.en;
  const base_path = is_zh ? "/zh/product" : "/product";

  return (
    <div className="mx-auto max-w-[1320px] px-5 py-16 md:px-8 md:py-24 lg:px-20">
      <div className="space-y-16 md:space-y-20">
        <section className="max-w-3xl space-y-5">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-text-soft">
            {content.badge}
          </span>
          <h1 className="font-serif text-[clamp(1.875rem,4vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
            {content.title}
          </h1>
          <p className="text-base leading-[1.65] text-text-soft">{content.subtitle}</p>
        </section>

        <ProductLogicSection content={content} />

        <section className="grid grid-cols-1 gap-px overflow-hidden rounded-[14px] bg-line sm:grid-cols-2">
          {content.cards.map((card) => (
            <Link
              key={card.id}
              to={`${base_path}/${card.id}`}
              className="group bg-card p-6 transition-colors hover:bg-background md:p-8"
            >
              <p className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-text-subtle">{card.source}</p>
              <h2 className="mt-4 text-lg font-semibold text-foreground">{card.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-text-soft">{card.desc}</p>
              <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                <span>{is_zh ? "了解更多" : "Learn more"}</span>
                <IconArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </div>
            </Link>
          ))}
        </section>

        <section className="rounded-[14px] border border-line bg-card p-6 shadow-sm md:p-8">
          <h3 className="text-[0.78rem] font-medium uppercase tracking-[0.04em] text-text-soft">{content.factsTitle}</h3>
          <ul className="mt-5 space-y-3 text-sm leading-relaxed text-text-soft">
            {content.facts.map((fact) => (
              <li key={fact} className="flex gap-3">
                <span className="mt-2 inline-flex size-1.5 shrink-0 rounded-full bg-text-subtle" />
                {fact}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

type ProductOverviewContent = (typeof page_content)[keyof typeof page_content];

function ProductLogicSection({ content }: { content: ProductOverviewContent }) {
  return (
    <section className="rounded-[14px] border border-line bg-card p-6 shadow-sm md:p-8">
      <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-text-soft">
        {content.logicBadge}
      </span>
      <div className="mt-6 grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
        <div>
          <h2 className="font-serif text-[clamp(1.5rem,3vw,2rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
            {content.logicTitle}
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-text-soft">{content.logicSubtitle}</p>
        </div>

        <div className="rounded-xl border border-line-soft bg-surface-muted p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
            {content.flow.map((item, index) => (
              <FlowNode key={item.title} item={item} show_arrow={index < content.flow.length - 1} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-px overflow-hidden rounded-[14px] bg-line sm:grid-cols-3">
        {content.notes.map((note) => (
          <div key={note.title} className="bg-surface-muted p-5">
            <p className="text-sm font-semibold text-foreground">{note.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-text-soft">{note.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

type FlowItem = ProductOverviewContent["flow"][number];

function FlowNode({ item, show_arrow }: { item: FlowItem; show_arrow: boolean }) {
  const Icon = item.icon;

  return (
    <>
      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            <Icon className="size-4" />
          </span>
          <span className="text-sm font-semibold text-foreground">{item.title}</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-text-soft">{item.desc}</p>
      </div>
      {show_arrow ? (
        <div className="flex items-center justify-center text-text-subtle">
          <IconArrowRight className="hidden size-5 md:block" />
          <span className="h-5 w-px bg-line-soft md:hidden" />
        </div>
      ) : null}
    </>
  );
}
