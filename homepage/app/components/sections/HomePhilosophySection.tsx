import type { FC } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { resolve_interface_locale } from "@/lib/interface-locale";

const principles = [
  { key: "runtime" },
  { key: "repo" },
  { key: "city" },
] as const;

/**
 * 首页产品哲学模块。
 * 说明：
 * 1. 左侧标题与描述，右侧三条原则卡片。
 * 2. 使用 home 命名空间文案，准确表达项目哲学。
 * 3. 使用 1px 细线分隔的 grid，与首页功能区块保持同构。
 */
export const HomePhilosophySection: FC = () => {
  const { i18n } = useTranslation("home");
  const location = useLocation();
  const locale = resolve_interface_locale(location.pathname, i18n.resolvedLanguage ?? i18n.language);
  const t = i18n.getFixedT(locale, "home");

  return (
    <section className="border-t border-line bg-background py-20 md:py-28">
      <div className="mx-auto max-w-[1600px] px-5 md:px-8 lg:px-20">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <div className="max-w-md">
            <p className="mb-4 text-[0.78rem] font-medium uppercase tracking-[0.04em] text-text-soft">
              {t("philosophy.sectionLabel")}
            </p>
            <h2 className="font-serif text-[clamp(1.625rem,3vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
              {t("philosophy.title")}
            </h2>
            <p className="mt-5 text-base leading-[1.65] text-text-soft">{t("philosophy.description")}</p>
          </div>

          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[14px] bg-line">
            {principles.map((item, index) => (
              <article
                key={item.key}
                className="flex items-start gap-5 bg-card p-6 transition-colors hover:bg-background md:p-8"
              >
                <span className="font-mono text-[0.7rem] font-medium text-text-subtle">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {t(`philosophy.items.${item.key}.title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-soft">
                    {t(`philosophy.items.${item.key}.description`)}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default HomePhilosophySection;
