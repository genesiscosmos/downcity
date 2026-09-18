
import { FeaturesSection } from "@/components/sections/FeaturesSection";
import { CodePreviewSection } from "@/components/sections/CodePreviewSection";
import { CTASection } from "@/components/sections/CTASection";
import { Footer } from "@/components/sections/Footer";
import { create_page_meta, get_path_locale } from "@/lib/seo";
import type { Route } from "./+types/features";

export function meta({ location }: Route.MetaArgs) {
  const is_chinese = get_path_locale(location.pathname) === "zh";
  const title = is_chinese
    ? "Agent Harness 功能：运行时、记忆、工具与权限 — Downcity"
    : "Agent Harness Features: Runtime, Memory, Tools — Downcity";
  const description = is_chinese
    ? "了解 Downcity Agent Harness 的功能：运行时、Session、记忆、工具、插件、权限、用量与多端部署。"
    : "Explore Downcity agent harness features: runtime, sessions, memory, tools, plugins, permissions, usage, and multi-surface deployment.";

  return create_page_meta({
    title,
    description,
    pathname: location.pathname,
    twitter_card: "summary_large_image",
    localized: true,
  });
}

export default function Features() {
  return (
    <div className="min-h-screen">
      <main>
        <FeaturesSection />
        <CodePreviewSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
