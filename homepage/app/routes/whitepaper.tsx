import { Footer } from "@/components/sections/Footer";
import { WhitepaperSection } from "@/components/sections/WhitepaperSection";
import { create_page_meta, get_path_locale } from "@/lib/seo";
import type { Route } from "./+types/whitepaper";

/**
 * 白皮书独立页面路由。
 * 说明：
 * 1. 承载完整白皮书正文，避免与首页营销信息混杂。
 * 2. 保持与全站一致的 SEO 元信息与页面结构。
 */
export function meta({ location }: Route.MetaArgs) {
  const is_chinese = get_path_locale(location.pathname) === "zh";
  const title = is_chinese
    ? "Agent Harness 白皮书：生产级 Agent 架构 — Downcity"
    : "Agent Harness Whitepaper: Production Agents — Downcity";
  const description = is_chinese
    ? "阅读 Downcity 白皮书：生产级 Agent 架构、治理边界与人机协作，以及一套可长期运行的 Agent Harness 应当负责什么。"
    : "The Downcity whitepaper on production agent architecture: governance boundaries, human-agent collaboration, and what a durable agent harness must own.";

  return create_page_meta({
    title,
    description,
    pathname: location.pathname,
    open_graph_type: "article",
    twitter_card: "summary_large_image",
    localized: true,
  });
}

export default function WhitepaperPage() {
  return (
    <div className="min-h-screen">
      <main>
        <WhitepaperSection />
      </main>
      <Footer />
    </div>
  );
}
