import { ProductDetailSection, type ProductDetailContent } from "@/components/sections/ProductDetailSection";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { create_page_meta, get_path_locale } from "@/lib/seo";
import type { Route } from "./+types/federation-sdk";

/**
 * Federation SDK 产品页。
 *
 * 说明：
 * 1. 本页从原 /product/sdk/ 迁出。原页面正文写的是 Federation SDK（@downcity/federation），
 *    但导航把它标成 City SDK，导致 URL、导航与内容三者不一致；现在拆成独立页面对齐命名。
 * 2. 语言必须从 URL 推导（use_interface_locale），不能用 i18n.language：
 *    i18next 单例在服务端固定为 en，预渲染时拿不到路径语言，会把 /zh/ 页面渲染成英文正文。
 */
export function meta({ location }: Route.MetaArgs) {
  const is_chinese = get_path_locale(location.pathname) === "zh";

  return create_page_meta({
    title: is_chinese
      ? "Federation SDK：Agent 产品后端复用方案 — Downcity"
      : "Federation SDK: Reusable Agent Product Backend — Downcity",
    description: is_chinese
      ? "用 Federation SDK 在多个 Agent 产品间复用同一套后端：模型目录、Service 路由、身份、运行环境变量、用量、余额与支付。"
      : "Reuse one backend across agent products with the Federation SDK: model catalogs, service routing, auth, runtime env, usage, balance, and payment.",
    pathname: location.pathname,
    twitter_card: "summary_large_image",
    localized: true,
  });
}

const PAGE: Record<"zh" | "en", ProductDetailContent> = {
  zh: {
    title: "Federation SDK",
    subtitle: "用 Federation SDK 把模型目录、Service 路由、身份、环境变量、用量、余额和支付接入你的产品体系。",
    docsCtaLabel: "查看 Federation 文档",
    docsCtaHint: "Federation 是业务后端；Embassy 是 user 与 admin 的统一客户端入口。",
    highlights: [
      {
        title: "复用 Agent 产品后端能力",
        description: "围绕 Service、Action、auth、env 和访问边界组织能力，而不是每个 AI 产品重建一套后端。",
      },
      {
        title: "统一模型、账户、用量和支付",
        description: "让多个 Agent、产品或工作流复用同一套模型目录、账户服务、usage 记录和支付闭环。",
      },
      {
        title: "从本地验证到线上部署一致",
        description: "用同一套服务组合承接本地验证、Node 部署与 Edge 部署，不必维护多套基础设施。",
      },
    ],
    scenesTitle: "典型场景",
    scenes: [
      "多产品复用：让多个 Agent 产品连接同一套 Federation，复用账户、模型、用量和支付能力。",
      "Service 接入：前端、扩展或后端通过 SDK 调用 Federation 中的 Service，而不是直接耦合数据库。",
      "部署组合：用 templates/localfed 或 templates/edgefed 适配不同运行环境。",
    ],
    factsTitle: "事实对齐",
    facts: [
      "核心包名：@downcity/federation",
      "核心源码目录：packages/federation/",
      "管理入口：fed / downfed",
    ],
  },
  en: {
    title: "Federation SDK",
    subtitle:
      "Bring model catalogs, service routing, auth, runtime env, usage, balance, and payment capabilities into your agent product stack.",
    docsCtaLabel: "Open Federation Docs",
    docsCtaHint: "Federation owns the backend runtime; Embassy is the user and admin client entry.",
    highlights: [
      {
        title: "Reuse the agent product backend layer",
        description: "Organize services, actions, auth, env, and access boundaries once instead of rebuilding the backend for every AI product.",
      },
      {
        title: "Unify models, accounts, usage, and payments",
        description: "Let multiple agents, products, or workflows reuse one model catalog, account service, usage ledger, and payment flow.",
      },
      {
        title: "Keep local validation and deployment aligned",
        description: "Use one service composition across local validation, Node deployment, and edge deployment.",
      },
    ],
    scenesTitle: "Typical Scenarios",
    scenes: [
      "Multi-product reuse: let multiple agent products share accounts, models, usage, and payment services.",
      "Service access: call Service actions in Federation from frontend, extension, or backend code without coupling to database internals.",
      "Deployment composition: use templates/localfed or templates/edgefed for different runtime targets.",
    ],
    factsTitle: "Facts",
    facts: [
      "Core package: @downcity/federation",
      "Core source directory: packages/federation/",
      "Management entry: fed / downfed",
    ],
  },
};

export default function ProductFederationSdkPage() {
  const locale = use_interface_locale();
  const isZh = locale === "zh";
  const content = isZh ? PAGE.zh : PAGE.en;
  const docsPath = isZh ? "/zh/docs/federation/overview/" : "/en/docs/federation/overview/";

  return <ProductDetailSection content={content} docsPath={docsPath} isZh={isZh} />;
}
