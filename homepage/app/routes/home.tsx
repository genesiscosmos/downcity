import { HomeHeroSection } from "@/components/sections/HomeHeroSection";
import { HomeFeaturesSection } from "@/components/sections/HomeFeaturesSection";
import { HomeArchitectureDiagram } from "@/components/sections/HomeArchitectureDiagram";
import { HomePhilosophySection } from "@/components/sections/HomePhilosophySection";
import { HomeUseCasesSection } from "@/components/sections/HomeUseCasesSection";
import { HomeCTASection } from "@/components/sections/HomeCTASection";
import { Footer } from "@/components/sections/Footer";
import { HomeStructuredData } from "@/components/seo/home-structured-data";
import { product } from "@/lib/product";
import { create_page_meta, get_path_locale } from "@/lib/seo";
import type { Route } from "./+types/home";

/**
 * 首页营销落地页路由。
 * 说明：
 * 1. 完整首页：Hero / Features / Architecture / Philosophy / Use Cases / CTA / Footer。
 * 2. 文案基于对 Downcity 的准确理解：Federation 连接多座 City，每座 City 组织多个 Agent。
 * 3. 所有行动路径收敛到安装命令、Quick Start 与 GitHub。
 */
export function meta({ location }: Route.MetaArgs) {
  const is_chinese = get_path_locale(location.pathname) === "zh";
  const title = is_chinese
    ? `${product.productName} — 面向 AI 开发者的 Agent 基础设施`
    : `${product.productName} — Agent Infrastructure for AI Builders`;
  const description = is_chinese
    ? "Downcity 为多个 Agent 产品和工作流提供可复用的运行时、模型、工具、任务、记忆、权限、用量和服务基础设施。"
    : product.description;

  return create_page_meta({
    title,
    description,
    pathname: location.pathname,
    keywords:
      "AI agents, agent collaboration, agent management, multi-agent workflow, task automation, chat-driven execution, Downcity",
    localized: true,
  });
}

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <HomeStructuredData />
      <main>
        <HomeHeroSection />
        <HomeFeaturesSection />
        <HomeArchitectureDiagram />
        <HomePhilosophySection />
        <HomeUseCasesSection />
        <HomeCTASection />
      </main>
      <Footer />
    </div>
  );
}
