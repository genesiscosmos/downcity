import { HomeHeroWorldSection } from "@/components/sections/HomeHeroWorldSection";
import { HomeFeaturesSection } from "@/components/sections/HomeFeaturesSection";
import { HomeArchitectureDiagram } from "@/components/sections/HomeArchitectureDiagram";
import { HomeUseCasesSection } from "@/components/sections/HomeUseCasesSection";
import { HomeCTASection } from "@/components/sections/HomeCTASection";
import { Footer } from "@/components/sections/Footer";
import { HomeStructuredData } from "@/components/seo/home-structured-data";
import { homepage_positioning } from "@/lib/homepage-positioning";
import { create_page_meta, get_path_locale } from "@/lib/seo";
import type { Route } from "./+types/home";

/**
 * 首页营销落地页路由。
 * 说明：
 * 1. 完整首页：Hero / Product World / Architecture / Features / Product Shapes / CTA / Footer。
 * 2. 文案基于对 Downcity 的准确理解：Federation 连接多座 City，每座 City 组织多个 Agent。
 * 3. 所有行动路径收敛到安装命令、Quick Start 与 GitHub。
 */
export function meta({ location }: Route.MetaArgs) {
  const positioning = homepage_positioning[get_path_locale(location.pathname)];

  return create_page_meta({
    title: positioning.meta_title,
    description: positioning.meta_description,
    pathname: location.pathname,
    keywords:
      "agentic product environment, agent creators, AI agents, agent collaboration, agent runtime, agent product platform, Downcity",
    localized: true,
  });
}

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <HomeStructuredData />
      <main>
        <HomeHeroWorldSection />
        <HomeArchitectureDiagram />
        <HomeFeaturesSection />
        <HomeUseCasesSection />
        <HomeCTASection />
      </main>
      <Footer />
    </div>
  );
}
