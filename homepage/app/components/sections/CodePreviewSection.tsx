import type { FC } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { IconFileText, IconSettings } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const SKILL_CONTENT = `---
name: market-research
description: Research markets with verified sources
---

# Market Research

1. Gather primary and secondary sources.
2. Record citations for every material claim.
3. Compare competitors on one shared rubric.
4. Save the final report under ./reports/.
`;

const GLOBAL_CONFIG_CONTENT = `Global database
$DC_PLATFORM_ROOT/downcity.db

Agent
  id                research_agent
  project_root      /workspace/research
  execution.model   gpt-5

Chat Plugin
  telegram.enabled  true
  account_id        telegram-main`;

/**
 * 代码预览模块（Vibecape 风格）。
 * 说明：
 * 1. 左侧标题与切换按钮，右侧配置面板。
 * 2. 使用新主题变量，保持细边框与柔和背景。
 */
export const CodePreviewSection: FC = () => {
  const locale = use_interface_locale();
  const { i18n } = useTranslation();
  const t = i18n.getFixedT(locale);
  const [active_tab, set_active_tab] = useState<"skill" | "config">("skill");
  const is_zh = locale === "zh";
  const content = active_tab === "skill" ? SKILL_CONTENT : GLOBAL_CONFIG_CONTENT;

  return (
    <section className="bg-background py-20 md:py-28">
      <div className="mx-auto grid max-w-[1600px] gap-10 px-5 md:px-8 lg:grid-cols-[0.88fr_1.12fr] lg:items-start lg:gap-16 lg:px-20">
        <div className="space-y-5">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-text-soft">
            Config Surface
          </span>
          <h2 className="font-serif text-[clamp(1.625rem,3vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
            {t("features:features.repo.title")}
          </h2>
          <p className="text-base leading-[1.65] text-text-soft">{t("features:features.repo.description")}</p>
          <p className="text-sm leading-relaxed text-text-soft">
            {is_zh
              ? "项目只保留 Skills 与运行资产；Agent、模型和 Plugin 配置统一由全局数据库管理。"
              : "Projects keep Skills and runtime assets; Agent, model, and Plugin config is managed by one global database."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => set_active_tab("skill")}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[0.72rem] font-medium uppercase tracking-[0.06em] transition-colors",
                active_tab === "skill"
                  ? "border-line-strong bg-surface-soft text-foreground"
                  : "border-line bg-surface text-text-soft hover:bg-surface-soft hover:text-foreground"
              )}
            >
              <IconFileText className="size-3.5" />
              .agents/skills
            </button>
            <button
              type="button"
              onClick={() => set_active_tab("config")}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[0.72rem] font-medium uppercase tracking-[0.06em] transition-colors",
                active_tab === "config"
                  ? "border-line-strong bg-surface-soft text-foreground"
                  : "border-line bg-surface text-text-soft hover:bg-surface-soft hover:text-foreground"
              )}
            >
              <IconSettings className="size-3.5" />
              downcity.db
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-[14px] border border-line bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-5 py-4 md:px-6">
            <div>
              <p className="text-[0.7rem] font-medium uppercase tracking-[0.06em] text-text-subtle">
                {active_tab === "skill" ? "Project Asset" : "Global Config"}
              </p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {active_tab === "skill" ? t("features:codePreview.skillDesc") : t("features:codePreview.configDesc")}
              </p>
            </div>
            <span className="inline-flex items-center rounded-full border border-line bg-surface px-2.5 py-1 text-[0.72rem] text-text-soft">
              {active_tab === "skill" ? "SKILL.md" : "downcity.db"}
            </span>
          </div>
          <div className="p-4 md:p-5">
            <pre className="block overflow-x-auto rounded-xl border border-line bg-surface-soft px-4 py-3 font-mono text-[0.78rem] leading-6 text-foreground">
              <code>{content}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CodePreviewSection;
