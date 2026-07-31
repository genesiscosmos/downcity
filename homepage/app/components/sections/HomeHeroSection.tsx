import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { IconArrowRight, IconBook } from "@tabler/icons-react";
import { HomeHeroCover } from "@/components/sections/HomeHeroCover";
import { homepage_positioning } from "@/lib/homepage-positioning";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";

/**
 * 首页主视觉模块。
 *
 * Hero 只负责建立 Downcity 的产品心智：多个 Agent 在各自 City 中协作，
 * 多座 City 通过 Federation 共享模型、服务和基础能力。具体功能与架构说明由
 * 后续独立区块承接，避免在首屏重复展示终端或 SDK 操作细节。
 */
export function HomeHeroSection() {
  const { i18n } = useTranslation("home");
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "home");
  const is_zh = locale === "zh";
  const positioning = homepage_positioning[locale];
  const start_path = is_zh ? "/zh/start" : "/start";
  const docs_path = is_zh ? "/zh/docs" : "/en/docs";

  return (
    <section className="relative overflow-hidden bg-background">
      <div className="mx-auto max-w-[1600px] px-5 pb-4 pt-10 md:px-8 md:pt-14 lg:px-20">
        <div className="relative z-10 mx-auto max-w-3xl text-center">
          <h1 className="font-serif text-[clamp(2.75rem,7vw,5.5rem)] font-bold leading-none text-foreground">
            {t("hero.title")}
          </h1>

          <p className="mx-auto mt-6 max-w-3xl text-[clamp(1.05rem,2vw,1.45rem)] font-medium leading-snug text-foreground">
            {positioning.hero_headline}
          </p>

          <p className="mx-auto mt-4 max-w-2xl text-sm leading-[1.75] text-text-soft md:text-base">
            {positioning.hero_description}
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              to={start_path}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("hero.start")}
              <IconArrowRight className="size-4" strokeWidth={1.7} />
            </Link>
            <Link
              to={docs_path}
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-background px-5 text-sm font-semibold text-foreground transition-colors duration-150 hover:border-line-strong hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <IconBook className="size-4" strokeWidth={1.6} />
              {t("hero.docs")}
            </Link>
          </div>
        </div>

        <HomeHeroCover />
      </div>
    </section>
  );
}

export default HomeHeroSection;
