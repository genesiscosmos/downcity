import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { product } from "@/lib/product";
import { marketingTheme } from "@/lib/marketing-theme";
import {
  MarketingPanel,
  marketingTagClass,
} from "@/components/shared/marketing-elements";
import { create_page_meta, get_path_locale } from "@/lib/seo";
import type { Route } from "./+types/resources.examples";

/**
 * 示例页元信息。
 *
 * 必须走 create_page_meta：Footer 全站链接到本页，早期只返回裸 title/description，
 * 会让页面丢失 canonical 与 hreflang。
 */
export function meta({ location }: Route.MetaArgs) {
  const is_chinese = get_path_locale(location.pathname) === "zh";

  return create_page_meta({
    title: is_chinese
      ? "Agent 示例项目与 Starter — Downcity"
      : "Agent Examples and Starters — Downcity",
    description: is_chinese
      ? "浏览可运行的 Downcity 示例项目与 Starter：交互式 CLI Agent，以及带 cron、Webhooks 与审批的 Server Agent。"
      : "Explore runnable Downcity example projects and starters, including an interactive CLI agent and a server agent with cron, webhooks, and approvals.",
    pathname: location.pathname,
    twitter_card: "summary_large_image",
    localized: true,
  });
}

const examples = [
  {
    id: "cliInteractive",
    slug: "cli-interactive",
    featureKeys: ["status", "execute", "tasks", "approval", "files", "logs"],
    tech: ["@clack/prompts", "Hono", "Bun"],
  },
  {
    id: "serverAgent",
    slug: "server-agent",
    featureKeys: ["cron", "webhooks", "approvals", "logs", "multiChannel"],
    tech: ["Hono", "node-cron", "Telegram Bot"],
  },
] as const;

export default function Examples() {
  // 语言必须来自 URL：i18next 单例在服务端固定为 en，用 useTranslation() 的 t 会把 /zh/ 预渲染成英文正文。
  const locale = use_interface_locale();
  const { i18n } = useTranslation();
  const t = i18n.getFixedT(locale);
  const repoUrl =
    product.homepage?.includes("github.com") === true
      ? product.homepage
      : "https://github.com/genesiscosmos/downcity";

  return (
    <div className={marketingTheme.pageNarrow}>
      <header className="space-y-3">
        <span className={marketingTheme.badge}>
          Examples
        </span>
        <h1 className={marketingTheme.pageTitle}>{t("nav.examples")}</h1>
        <p className={marketingTheme.lead}>
          {t("resources:examplesPage.subtitle")}
        </p>
      </header>

      <section className="mt-8 space-y-4">
        {examples.map((example, index) => (
          <MarketingPanel key={example.id} className="p-5 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className={marketingTheme.eyebrow}>
                  Example {String(index + 1).padStart(2, "0")}
                </p>
                <h2 className="mt-2 font-serif text-[1.5rem] font-semibold tracking-[-0.03em] text-foreground">
                  {t(`resources:examplesPage.examplesList.${example.id}.title`)}
                </h2>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  {t(`resources:examplesPage.examplesList.${example.id}.description`)}
                </p>
              </div>
              <a
                href={`${repoUrl}/tree/main/examples/${example.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className={marketingTheme.secondaryButton}
              >
                {t("resources:examplesPage.viewCode")}
              </a>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
              <div>
                <h3 className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {t("resources:examplesPage.featuresHeading")}
                </h3>
                <ul className="mt-2 space-y-1.5">
                  {example.featureKeys.map((featureKey) => (
                    <li key={featureKey} className="flex items-start gap-2 text-sm leading-7 text-muted-foreground">
                      <span className="mt-2 inline-flex size-1.5 rounded-full bg-foreground/50" />
                      {t(`resources:examplesPage.examplesList.${example.id}.features.${featureKey}`)}
                    </li>
                  ))}
                </ul>
              </div>

              <MarketingPanel tone="inset" className="px-3 py-3">
                <h3 className={marketingTheme.eyebrow}>Tech</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {example.tech.map((tech) => (
                    <span
                      key={tech}
                      className={marketingTagClass({ tone: "soft" })}
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              </MarketingPanel>
            </div>
          </MarketingPanel>
        ))}
      </section>

      <MarketingPanel className="mt-8 p-6">
        <h3 className="text-lg font-semibold">{t("resources:examplesPage.contribute.title")}</h3>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          {t("resources:examplesPage.contribute.description")}
        </p>
        <a
          href={repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`mt-4 ${marketingTheme.primaryButton}`}
        >
          {t("resources:examplesPage.contribute.button")}
        </a>
      </MarketingPanel>
    </div>
  );
}
