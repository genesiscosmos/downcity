import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { COMMUNITY_LINKS } from "@/lib/community-links";
import { create_page_meta, get_path_locale } from "@/lib/seo";
import type { Route } from "./+types/resources.hosting";

export function meta({ location }: Route.MetaArgs) {
  const is_chinese = get_path_locale(location.pathname) === "zh";
  const title = is_chinese
    ? "托管 Agent 运行：让 Agent 持续在线 — Downcity"
    : "Managed Agent Hosting: Run Agents Continuously — Downcity";
  const description = is_chinese
    ? "Downcity Agent 的托管方案：无需自建运行基础设施，也能让 Agent Harness 持续在线运行。"
    : "Managed hosting for Downcity agents: keep an agent harness running continuously without operating your own runtime infrastructure.";
  return create_page_meta({
    title,
    description,
    pathname: location.pathname,
    localized: true,
  });
}

const hostingFeatures = [
  { id: "deploy" },
  { id: "updates" },
  { id: "observability" },
  { id: "security" },
] as const;

/**
 * Hosting 资源页（Vibecape 风格）。
 * 说明：
 * 1. 简洁预告页，四列特性卡片。
 * 2. 使用统一页面容器、细线卡片与柔和 hover。
 */
export default function Hosting() {
  // 语言必须来自 URL：i18next 单例在服务端固定为 en，用 useTranslation() 的 t 会把 /zh/ 预渲染成英文正文。
  const locale = use_interface_locale();
  const { i18n } = useTranslation();
  const t = i18n.getFixedT(locale);
  const discussionsUrl = COMMUNITY_LINKS.telegram;

  return (
    <div className="mx-auto max-w-[1320px] px-5 py-16 md:px-8 md:py-24 lg:px-20">
      <header className="space-y-4">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-text-soft">
          {t("resources:hostingPage.badge")}
        </span>
        <h1 className="font-serif text-[clamp(1.875rem,4vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
          {t("nav.hosting")}
        </h1>
        <p className="max-w-2xl text-base leading-[1.65] text-text-soft">
          {t("resources:hostingPage.subtitle")}
        </p>
      </header>

      <section className="mt-8 grid gap-px overflow-hidden rounded-[14px] bg-line sm:grid-cols-2 lg:grid-cols-4">
        {hostingFeatures.map((feature, index) => (
          <article
            key={feature.id}
            className="min-h-[180px] bg-card p-5 transition-colors hover:bg-background md:p-6"
          >
            <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.06em] text-text-subtle">
              {String(index + 1).padStart(2, "0")}
            </p>
            <h2 className="mt-3 font-serif text-[1.25rem] font-semibold tracking-[-0.03em] text-foreground">
              {t(`resources:hostingPage.features.${feature.id}.title`)}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-text-soft">
              {t(`resources:hostingPage.features.${feature.id}.description`)}
            </p>
          </article>
        ))}
      </section>

      <section className="mt-8 rounded-[14px] border border-line bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-foreground">
          {t("resources:hostingPage.cta.title")}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-text-soft">
          {t("resources:hostingPage.cta.description")}
        </p>
        <a
          href={discussionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-76"
        >
          {t("resources:hostingPage.cta.button")}
        </a>
      </section>
    </div>
  );
}
