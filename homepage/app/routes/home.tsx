import { HomeHeroWorldSection } from "@/components/sections/HomeHeroWorldSection";
import { HomeQuickstartSection } from "@/components/sections/HomeQuickstartSection";
import { HomeFeaturesSection } from "@/components/sections/HomeFeaturesSection";
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
 * 1. 完整首页：Hero / Quick Start / Features / Product Shapes / CTA / Footer。
 * 2. 文案基于对 Downcity 的准确理解：Agent Harness 负责运行 Agent，Productization Kits
 *    负责把 Agent 组织成可交付产品；City 与 Federation 是其中的产品化基础。
 * 3. 所有行动路径收敛到安装命令、Quick Start 与 GitHub。
 */
export function meta({ location }: Route.MetaArgs) {
  const positioning = homepage_positioning[get_path_locale(location.pathname)];

  return create_page_meta({
    title: positioning.meta_title,
    description: positioning.meta_description,
    pathname: location.pathname,
    keywords:
      "agent harness, agent productization, agent product kits, AI agents, agent runtime, Downcity",
    localized: true,
  });
}

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <HomeStructuredData />
      <main>
        <HomeHeroWorldSection />
        <HomeQuickstartSection />
        <HomeFeaturesSection />
        <HomeUseCasesSection />
        <HomeCTASection />
      </main>
      <Footer />
    </div>
  );
}
