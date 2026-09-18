import { ProductDetailSection, type ProductDetailContent } from "@/components/sections/ProductDetailSection";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { create_page_meta, get_path_locale } from "@/lib/seo";
import type { Route } from "./+types/city-sdk";

/**
 * City SDK 产品页（新增）。
 *
 * 说明：
 * 1. 与 Federation SDK 拆分的另一半：City 是本地 Agent 宿主容器，Federation 是服务端运行时，
 *    两者边界不同，因此不能共用一个 /product/sdk/ 页面。
 * 2. 事实依据：packages/city/（包名 @downcity/city）、docs City overview（City owns Agent
 *    collection / HTTP+RPC forwarding / host lifecycle；模型目录、身份、用量、计费属于
 *    Federation 与 Embassy）。文案不得偏离这些事实。
 * 3. 语言从 URL 推导，理由同 federation-sdk.tsx。
 */
export function meta({ location }: Route.MetaArgs) {
  const is_chinese = get_path_locale(location.pathname) === "zh";

  return create_page_meta({
    title: is_chinese
      ? "City SDK：本地 Agent 宿主与 Service 边界 — Downcity"
      : "City SDK: Local Agent Host and Service Boundary — Downcity",
    description: is_chinese
      ? "用 City SDK 托管本地 Agent 实例，并通过稳定的 Service、Action 与 AIService 边界，把同一套 AI 后端复用到多个产品客户端。"
      : "Host local Agent instances with the City SDK and expose them to many product clients through a stable Service, Action, and AIService boundary.",
    pathname: location.pathname,
    twitter_card: "summary_large_image",
    localized: true,
  });
}

const PAGE: Record<"zh" | "en", ProductDetailContent> = {
  zh: {
    title: "City SDK",
    subtitle:
      "用 City SDK 创建、部署并调用 City：把 Agent 实例托管进本地运行环境，再通过稳定的 Service 边界把能力开放给多个产品客户端。",
    docsCtaLabel: "查看 City SDK 文档",
    docsCtaHint: "Federation 是服务端运行时；Embassy 是 user 与 admin 的统一客户端入口。",
    highlights: [
      {
        title: "本地 Agent 宿主",
        description: "City 在内存中持有 Agent 实例，并拥有两个 HTTP/RPC 传输端口，按 agent_id 把请求转发给对应的 Agent。",
      },
      {
        title: "稳定的产品侧边界",
        description: "对内把能力组织成 Service、Action 与 AIService，对外只暴露 text()、stream()、image() 这类服务调用，而不是原始厂商 API。",
      },
      {
        title: "一座 City 服务多个产品",
        description: "一个 Federation 可以同时服务 Web、扩展、桌面端与内部工具，让每个产品不必重建同一套 AI 后端。",
      },
    ],
    scenesTitle: "典型场景",
    scenes: [
      "托管 Agent：调用 city.agents.add(agent) 把已有 Agent 纳入 City，统一通过 HTTP/RPC 转发。",
      "产品客户端接入：通过 Embassy User 与 user_token（内含 bureau_id）调用 City 中的服务。",
      "边界清晰：模型目录、身份、用量与计费属于 Federation 与 Embassy，City 只负责宿主与请求转发。",
    ],
    factsTitle: "事实对齐",
    facts: [
      "核心包名：@downcity/city",
      "核心源码目录：packages/city/",
      "客户端入口：City / Embassy User",
    ],
  },
  en: {
    title: "City SDK",
    subtitle:
      "Create, deploy, and call City with the City SDK: host Agent instances inside a local runtime, then expose them to many product clients behind a stable service boundary.",
    docsCtaLabel: "Open City SDK Docs",
    docsCtaHint: "Federation owns the server-side runtime; Embassy is the unified user and admin client entry.",
    highlights: [
      {
        title: "Local Agent host",
        description: "City keeps Agent instances in memory and owns two HTTP/RPC transport ports, forwarding requests to the right Agent by agent_id.",
      },
      {
        title: "A stable product-facing boundary",
        description: "Internally capabilities are organized as Service, Action, and AIService; product clients only call text(), stream(), and image() instead of raw provider APIs.",
      },
      {
        title: "One City, many products",
        description: "A single Federation can serve web apps, extensions, desktop tools, and internal tools, so each product stops rebuilding the same AI backend.",
      },
    ],
    scenesTitle: "Typical Scenarios",
    scenes: [
      "Hosting agents: call city.agents.add(agent) to admit an existing Agent and route it through City's HTTP/RPC forwarding.",
      "Product client access: reach services in City through Embassy User and a user_token that carries bureau_id.",
      "Clear boundaries: model catalogs, identity, usage, and billing belong to Federation and Embassy; City owns the host and forwarding.",
    ],
    factsTitle: "Facts",
    facts: [
      "Core package: @downcity/city",
      "Core source directory: packages/city/",
      "Client entry: City / Embassy User",
    ],
  },
};

export default function ProductCitySdkPage() {
  const locale = use_interface_locale();
  const isZh = locale === "zh";
  const content = isZh ? PAGE.zh : PAGE.en;
  const docsPath = isZh ? "/zh/city-sdk-docs/" : "/en/city-sdk-docs/";

  return <ProductDetailSection content={content} docsPath={docsPath} isZh={isZh} />;
}
