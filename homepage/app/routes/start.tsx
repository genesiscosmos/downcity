import { StartGuideSection } from "@/components/sections/StartGuideSection";
import { Footer } from "@/components/sections/Footer";
import { create_page_meta, get_path_locale } from "@/lib/seo";
import type { Route } from "./+types/start";

export function meta({ location }: Route.MetaArgs) {
  const is_chinese = get_path_locale(location.pathname) === "zh";
  const title = is_chinese
    ? "Agent Harness 快速开始：运行你的第一个 Agent — Downcity"
    : "Agent Harness Quickstart: Run Your First Agent — Downcity";
  const description = is_chinese
    ? "安装 Downcity CLI，几分钟内跑起第一个 Agent：选择你的系统、启动本地 Agent Harness，并打开一个可用的 Session。"
    : "Install the Downcity CLI and run your first agent in minutes: choose your OS, start a local agent harness, and open a working session.";

  return create_page_meta({
    title,
    description,
    pathname: location.pathname,
    twitter_card: "summary_large_image",
    localized: true,
  });
}

export default function Start() {
  return (
    <div className="min-h-screen">
      <main>
        <StartGuideSection />
      </main>
      <Footer />
    </div>
  );
}
