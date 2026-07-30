import { useTranslation } from "react-i18next";
import { product } from "@/lib/product";
import { cn } from "@/lib/utils";
import { create_page_meta, get_path_locale } from "@/lib/seo";
import type { Route } from "./+types/community.roadmap";

export function meta({ location }: Route.MetaArgs) {
  const is_chinese = get_path_locale(location.pathname) === "zh";
  const title = `${product.productName} — ${is_chinese ? "路线图" : "Roadmap"}`;
  const description = is_chinese
    ? "了解 Downcity 接下来正在建设的产品和生态能力。"
    : "See what we are building next";
  return create_page_meta({
    title,
    description,
    pathname: location.pathname,
    localized: true,
  });
}

export default function Roadmap() {
  const { t } = useTranslation();
  const repoUrl =
    product.homepage?.includes("github.com") === true
      ? product.homepage
      : "https://github.com/genesiscosmos/downcity";
  const issuesUrl = `${repoUrl}/issues`;

  return (
    <div className="mx-auto max-w-[1320px] px-5 py-16 md:px-8 md:py-24 lg:px-20">
      <header className="max-w-2xl space-y-4">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-text-soft">
          Roadmap
        </span>
        <h1 className="font-serif text-[clamp(1.875rem,4vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
          {t("nav.roadmap")}
        </h1>
        <p className="text-base leading-[1.65] text-text-soft">
          {t("community:roadmapPage.description")}
        </p>
      </header>

      <section className="mt-14 grid gap-6 md:mt-20 lg:grid-cols-2">
        <article className="flex flex-col rounded-[14px] border border-line bg-card p-8 shadow-sm md:p-10">
          <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.06em] text-text-subtle">
            01
          </span>
          <h2 className="mt-4 font-serif text-[clamp(1.5rem,3vw,2rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
            {t("community:roadmapPage.product.title")}
          </h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-text-soft">
            {t("community:roadmapPage.product.description")}
          </p>

          <div className="mt-8 grid gap-px overflow-hidden rounded-[14px] bg-line">
            <div className="bg-card p-5 transition-colors hover:bg-background md:p-6">
              <h3 className="text-sm font-semibold text-foreground">
                {t("community:roadmapPage.product.items.agentHarness.title")}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-text-soft">
                {t("community:roadmapPage.product.items.agentHarness.desc")}
              </p>
            </div>
            <div className="bg-card p-5 transition-colors hover:bg-background md:p-6">
              <h3 className="text-sm font-semibold text-foreground">
                {t("community:roadmapPage.product.items.cityInfra.title")}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-text-soft">
                {t("community:roadmapPage.product.items.cityInfra.desc")}
              </p>
            </div>
          </div>
        </article>

        <article className="flex flex-col rounded-[14px] border border-line bg-card p-8 shadow-sm md:p-10">
          <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.06em] text-text-subtle">
            02
          </span>
          <h2 className="mt-4 font-serif text-[clamp(1.5rem,3vw,2rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
            {t("community:roadmapPage.ecosystem.title")}
          </h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-text-soft">
            {t("community:roadmapPage.ecosystem.description")}
          </p>

          <div className="mt-8 flex flex-1 items-center rounded-[14px] border border-line bg-surface-soft p-5 md:p-6">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t("community:roadmapPage.ecosystem.items.enterprise.title")}
              </h3>
              <p className="mt-2 max-w-sm text-xs leading-relaxed text-text-soft">
                {t("community:roadmapPage.ecosystem.items.enterprise.desc")}
              </p>
            </div>
          </div>
        </article>
      </section>

      <section className="mt-12 rounded-[14px] border border-line bg-card p-6 shadow-sm md:mt-16 md:p-8">
        <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              {t("community:roadmapPage.cta.title")}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-text-soft">
              {t("community:roadmapPage.cta.description")}
            </p>
          </div>
          <a
            href={issuesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold transition-opacity hover:opacity-76",
              "bg-primary text-primary-foreground"
            )}
          >
            {t("community:roadmapPage.cta.button")}
          </a>
        </div>
      </section>
    </div>
  );
}
