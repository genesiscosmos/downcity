/**
 * 首页 Hero 下方的 SDK 世界滚动叙事。
 *
 * 区块把完整滚动距离离散为十七个领域步骤，并把同一个步骤同时传给地图与代码，
 * 让 Agent、City、Federation 的世界生长和公开 API 展示保持严格同步。
 */

import { useScroll, useMotionValueEvent } from "framer-motion";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { HomeSdkCodePanel, home_sdk_file_for_step } from "@/components/sections/HomeSdkCodePanel";
import { HomeSdkWorldMap } from "@/components/sections/HomeSdkWorldMap";
import type { HomeSdkFileKey } from "@/types/home/HomeSdkWorld";

const story_step_count = 17;

/** 渲染从 Agent 连续生长到 Federation 的 SDK 世界。 */
export function HomeQuickstartSection() {
  const section_ref = useRef<HTMLElement>(null);
  const { i18n } = useTranslation("home");
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "home");
  const [active_step, set_active_step] = useState(0);
  const [active_file, set_active_file] = useState<HomeSdkFileKey>("agent");
  const { scrollYProgress: story_progress } = useScroll({
    target: section_ref,
    offset: ["start start", "end end"],
  });

  useMotionValueEvent(story_progress, "change", (latest_progress) => {
    const next_step = Math.min(story_step_count - 1, Math.floor(latest_progress * story_step_count));
    if (next_step === active_step) return;
    set_active_step(next_step);
    set_active_file(home_sdk_file_for_step(next_step));
  });

  const docs_prefix = locale === "zh" ? "/zh" : "/en";
  const docs_paths: Record<HomeSdkFileKey, string> = {
    agent: `${docs_prefix}/agent-sdk-docs/local-agent/quickstart`,
    city: `${docs_prefix}/city-sdk-docs/packages/city`,
    federation: `${docs_prefix}/city-sdk-docs/packages/federation`,
  };
  const map_labels = {
    agent: t("quickstart.map.labels.agent"),
    plugin: t("quickstart.map.labels.plugin"),
    workspace: t("quickstart.map.labels.workspace"),
    city: t("quickstart.map.labels.city"),
    neighbor_city: t("quickstart.map.labels.neighborCity"),
    third_city: t("quickstart.map.labels.thirdCity"),
    federation: t("quickstart.map.labels.federation"),
    database: t("quickstart.map.labels.database"),
    service: t("quickstart.map.labels.service"),
    model: t("quickstart.map.labels.model"),
    account: t("quickstart.map.labels.account"),
    payment: t("quickstart.map.labels.payment"),
    credits: t("quickstart.map.labels.credits"),
    embassy: t("quickstart.map.labels.embassy"),
    session: t("quickstart.map.labels.session"),
    user: t("quickstart.map.labels.user"),
    user_prompt: t("quickstart.map.labels.userPrompt"),
    agent_reply: t("quickstart.map.labels.agentReply"),
  };
  const stage_labels = [
    map_labels.agent,
    map_labels.agent,
    map_labels.workspace,
    `${map_labels.agent} · ${map_labels.workspace}`,
    `${map_labels.agent} · ${map_labels.workspace}`,
    map_labels.plugin,
    map_labels.city,
    map_labels.neighbor_city,
    map_labels.third_city,
    map_labels.embassy,
    map_labels.federation,
    map_labels.service,
    map_labels.federation,
    map_labels.model,
    map_labels.account,
    map_labels.payment,
    map_labels.credits,
    map_labels.embassy,
    `${map_labels.embassy} → ${map_labels.service}`,
    map_labels.session,
  ] as const;

  return (
    <section ref={section_ref} id="quickstart" data-active-step={active_step} className="relative h-[760svh] scroll-mt-16 border-t border-line bg-background">
      <div className="sticky top-0 h-svh overflow-hidden">
        <div className="grid h-full min-h-0 grid-rows-[minmax(18rem,52svh)_minmax(0,1fr)] lg:grid-cols-2 lg:grid-rows-1">
          <div className="flex min-h-0 flex-col overflow-hidden border-b border-line lg:border-b-0 lg:border-r">
            <div className="flex h-12 shrink-0 items-center gap-5 border-b border-line px-5 md:px-8">
              <p className="shrink-0 text-xs font-semibold text-foreground">{stage_labels[active_step]}</p>
              <div className="flex min-w-0 flex-1 gap-1" aria-hidden="true">
                {Array.from({ length: story_step_count }, (_, step_index) => (
                  <span key={step_index} className={`h-px flex-1 transition-colors duration-300 motion-reduce:transition-none ${step_index <= active_step ? "bg-[#b45d4c]" : "bg-line"}`} />
                ))}
              </div>
            </div>
            <div className="min-h-0 min-w-0 flex-1">
              <HomeSdkWorldMap active_step={active_step} active_file={active_file} aria_label={t("quickstart.map.ariaLabel")} labels={map_labels} />
            </div>
          </div>
          <HomeSdkCodePanel
              active_step={active_step}
              active_file={active_file}
              on_file_select={set_active_file}
              locale={locale}
              tabs_label={t("quickstart.filesLabel")}
              docs_path={docs_paths[active_file]}
              docs_label={t(`quickstart.entries.${active_file}.docsLink`)}
              copy_label={t("quickstart.copyCode")}
              copied_label={t("quickstart.copiedCode")}
          />
        </div>
      </div>
    </section>
  );
}

export default HomeQuickstartSection;
