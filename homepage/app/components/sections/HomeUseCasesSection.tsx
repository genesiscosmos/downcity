import type { FC } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { IconTerminal2, IconBrowser, IconCode, IconBuildingSkyscraper } from "@tabler/icons-react";
import { resolve_interface_locale } from "@/lib/interface-locale";

const cases = [
  { key: "cli", icon: IconTerminal2 },
  { key: "browser", icon: IconBrowser },
  { key: "sdk", icon: IconCode },
  { key: "backend", icon: IconBuildingSkyscraper },
] as const;

/**
 * 首页产品形态模块。
 * 说明：
 * 1. 展示同一套 Downcity 后端可以支撑的四种产品表面。
 * 2. 使用 home 命名空间文案。
 * 3. 两列编号卡片，与 Features 区块保持同构。
 */
export const HomeUseCasesSection: FC = () => {
  const { i18n } = useTranslation("home");
  const location = useLocation();
  const locale = resolve_interface_locale(location.pathname, i18n.resolvedLanguage ?? i18n.language);
  const t = i18n.getFixedT(locale, "home");

  return (
    <section className="border-t border-line bg-background py-20 md:py-28">
      <div className="mx-auto max-w-[1600px] px-5 md:px-8 lg:px-20">
        <div className="mb-12 max-w-2xl md:mb-16">
          <p className="mb-4 text-[0.78rem] font-medium uppercase tracking-[0.04em] text-text-soft">
            {t("useCases.sectionLabel")}
          </p>
          <h2 className="font-serif text-[clamp(1.625rem,3vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
            {t("useCases.title")}
          </h2>
          <p className="mt-5 text-base leading-[1.65] text-text-soft">{t("useCases.description")}</p>
        </div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[14px] bg-line sm:grid-cols-2">
          {cases.map((item, index) => {
            const Icon = item.icon;
            const number = String(index + 1).padStart(2, "0");
            return (
              <article
                key={item.key}
                className="flex items-start gap-5 bg-card p-6 transition-colors hover:bg-background md:p-8"
              >
                <span className="font-mono text-[0.7rem] font-medium text-text-subtle">{number}</span>
                <div>
                  <div className="mb-3 inline-flex items-center justify-center rounded-lg bg-surface-soft p-2.5 text-foreground">
                    <Icon className="size-5" strokeWidth={1.4} />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {t(`useCases.cases.${item.key}.title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-soft">
                    {t(`useCases.cases.${item.key}.description`)}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default HomeUseCasesSection;
