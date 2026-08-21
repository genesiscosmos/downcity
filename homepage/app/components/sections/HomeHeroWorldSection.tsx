/**
 * 首页静态 Hero 与六边形社区封面。
 *
 * 首页直接复用轻量的 HomeHeroCover，不接入 Product World 的滚动叙事、地图检查器
 * 或分阶段生长动画，使首屏只保留核心文案和可快速理解的社区关系图。
 */

import { Link } from "react-router";
import { IconArrowRight } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { HomeHeroCover } from "@/components/sections/HomeHeroCover";
import { homepage_positioning } from "@/lib/homepage-positioning";

/**
 * 渲染首页首屏 Hero。
 *
 * Product World 文件仍可被后续实验复用；本组件只使用简单六边形封面。
 */
export function HomeHeroWorldSection() {
  const { i18n } = useTranslation("home");
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "home");
  const positioning = homepage_positioning[locale];
  const learn_more_path = locale === "zh" ? "/zh/product" : "/product";

  return (
    <section className="relative min-h-[calc(100svh-60px)] overflow-hidden bg-background">
      <div className="relative mx-auto flex min-h-[calc(100svh-60px)] max-w-7xl flex-col px-5 pt-[12svh] md:px-8 md:pt-[14svh]">
        <div className="mx-auto w-full max-w-4xl text-center">
          <h1 className="font-serif text-[clamp(2.75rem,7vw,5.5rem)] font-bold leading-none text-foreground">{t("hero.title")}</h1>
          <p className="mx-auto mt-5 max-w-3xl text-[clamp(1.05rem,2vw,1.45rem)] font-medium leading-snug text-foreground">{positioning.hero_headline}</p>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-[1.75] text-text-soft md:text-base">{positioning.hero_description}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <a href="#quickstart" className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("hero.quickStart")}
              <IconArrowRight className="size-4" strokeWidth={1.7} />
            </a>
            <Link to={learn_more_path} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-background px-5 text-sm font-semibold text-foreground transition-colors duration-150 hover:border-line-strong hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("hero.learnMore")}
              <IconArrowRight className="size-4" strokeWidth={1.6} />
            </Link>
          </div>
        </div>
        <HomeHeroCover />
      </div>
    </section>
  );
}

export default HomeHeroWorldSection;
