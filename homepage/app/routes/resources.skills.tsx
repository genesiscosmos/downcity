import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { IconExternalLink } from "@tabler/icons-react";
import { create_page_meta, get_path_locale } from "@/lib/seo";
import type { Route } from "./+types/resources.skills";

export function meta({ location }: Route.MetaArgs) {
  const is_chinese = get_path_locale(location.pathname) === "zh";
  const title = is_chinese
    ? "Agent Skills 目录：可复用的 Agent 能力 — Downcity"
    : "Agent Skills Directory: Reusable Capabilities — Downcity";
  const description = is_chinese
    ? "浏览用于扩展 Downcity Agent Harness 的 Skill 目录与插件资源，按需挂载可复用的能力。"
    : "Browse skill directories and plugin resources that extend a Downcity agent harness with reusable, mountable capabilities.";
  return create_page_meta({
    title,
    description,
    pathname: location.pathname,
    localized: true,
  });
}

const skillDirectories = [
  {
    id: "skillsSh",
    url: "https://skills.sh",
  },
  {
    id: "skillsmp",
    url: "https://skillsmp.com",
  },
  {
    id: "smitherySkills",
    url: "https://smithery.ai/skills",
  },
] as const;

/**
 * Skills 资源页（Vibecape 风格）。
 * 说明：
 * 1. 简洁列表，每个 skill 一项。
 * 2. 使用细线分隔卡片与柔和 hover 反馈。
 */
export default function Skills() {
  // 语言必须来自 URL：i18next 单例在服务端固定为 en，用 useTranslation() 的 t 会把 /zh/ 预渲染成英文正文。
  const locale = use_interface_locale();
  const { i18n } = useTranslation();
  const t = i18n.getFixedT(locale);

  return (
    <div className="mx-auto max-w-[1320px] px-5 py-16 md:px-8 md:py-24 lg:px-20">
      <header className="space-y-4">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-text-soft">
          Resources
        </span>
        <h1 className="font-serif text-[clamp(1.875rem,4vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
          {t("nav.skills")}
        </h1>
        <p className="max-w-2xl text-base leading-[1.65] text-text-soft">{t("resources:skillsPage.subtitle")}</p>
      </header>

      <section className="mt-8 grid gap-px overflow-hidden rounded-[14px] bg-line">
        {skillDirectories.map((item, index) => (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start justify-between gap-4 bg-card px-5 py-5 transition-colors hover:bg-background md:px-7 md:py-6"
          >
            <div className="grid gap-1">
              <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.06em] text-text-subtle">
                {String(index + 1).padStart(2, "0")}
              </p>
              <p className="text-base font-semibold text-foreground">
                {t(`resources:skillsPage.links.${item.id}.title`)}
              </p>
              <p className="text-sm leading-relaxed text-text-soft">
                {t(`resources:skillsPage.links.${item.id}.description`)}
              </p>
              <p className="truncate text-xs text-text-subtle">{item.url}</p>
            </div>
            <IconExternalLink className="mt-1 size-4 shrink-0 text-text-subtle transition-colors group-hover:text-foreground" />
          </a>
        ))}
      </section>
    </div>
  );
}
