import { useTranslation } from "react-i18next";
import { ProductDetailSection, type ProductDetailContent } from "@/components/sections/ProductDetailSection";

const PAGE: Record<"zh" | "en", ProductDetailContent> = {
  zh: {
    title: "Product · City SDK",
    subtitle: "用 City SDK 把模型目录、Service 路由、身份、环境变量、用量、余额和支付接入你的产品体系。",
    docsCtaLabel: "查看 City SDK 文档",
    docsCtaHint: "City 是产品和 SDK 名称；Service 是 City 里的能力组织单位。",
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
      "多产品复用：让多个 Agent 产品连接同一套 City，复用账户、模型、用量和支付能力。",
      "Service 接入：前端、扩展或后端通过 SDK 调用 City 中的 Service，而不是直接耦合数据库。",
      "部署组合：用 templates/localfed 或 templates/edgefed 适配不同运行环境。",
    ],
    factsTitle: "事实对齐",
    facts: [
      "核心包名：@downcity/city",
      "核心源码目录：packages/city/",
      "管理入口：city manage",
    ],
  },
  en: {
    title: "Product · City SDK",
    subtitle:
      "Bring model catalogs, service routing, auth, runtime env, usage, balance, and payment capabilities into your agent product stack.",
    docsCtaLabel: "Open City SDK Docs",
    docsCtaHint: "City remains the current SDK and package name, so implementation docs keep that name.",
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
      "Service access: call Service actions in City from frontend, extension, or backend code without coupling to database internals.",
      "Deployment composition: use templates/localfed or templates/edgefed for different runtime targets.",
    ],
    factsTitle: "Facts",
    facts: [
      "Core package: @downcity/city",
      "Core source directory: packages/city/",
      "Management entry: city manage",
    ],
  },
};

export default function ProductSdkPage() {
  const { i18n } = useTranslation();
  const isZh = i18n.language.toLowerCase().startsWith("zh");
  const content = isZh ? PAGE.zh : PAGE.en;
  const docsPath = isZh ? "/zh/city-sdk-docs" : "/en/city-sdk-docs";

  return <ProductDetailSection content={content} docsPath={docsPath} isZh={isZh} />;
}
