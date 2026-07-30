import type { FC } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { IconArrowRight } from "@tabler/icons-react";

const GITHUB_URL = "https://github.com/genesiscosmos/downcity";

/**
 * 功能页收尾 CTA 模块（Vibecape 风格）。
 * 说明：
 * 1. 左右分栏：左侧文案，右侧按钮。
 * 2. 使用新的暖色主题与圆角按钮。
 */
export const CTASection: FC = () => {
  const { i18n, t } = useTranslation();
  const isZh = i18n.language === "zh";
  const docsPath = isZh ? "/zh/docs" : "/en/docs";

  return (
    <section className="border-t border-line bg-background py-16 md:py-20">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-8 px-5 md:px-8 lg:flex-row lg:items-end lg:justify-between lg:gap-16 lg:px-20">
        <div className="max-w-xl space-y-4">
          <p className="text-[0.78rem] font-medium uppercase tracking-[0.04em] text-text-soft">Builder Decision</p>
          <h2 className="font-serif text-[clamp(1.625rem,3vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
            {t("common:ctaSection.titlePrefix")}{" "}
            <span className="text-foreground/70">{t("common:ctaSection.titleItalic")}</span>
          </h2>
          <p className="text-base leading-[1.65] text-text-soft">
            {isZh
              ? "先用一套可复用运行层跑通一个真实 Agent 产品，再把它扩展到更多工作流和产品入口。"
              : "Close one real agent product loop on a reusable runtime, then expand it into more workflows and product surfaces."}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            to={GITHUB_URL}
            target="_blank"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-foreground/[0.05] px-5 text-sm font-semibold text-foreground transition-colors hover:bg-foreground/[0.08]"
          >
            {t("common:getStarted")}
            <IconArrowRight className="size-4" />
          </Link>
          <Link
            to={docsPath}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-76"
          >
            {t("common:readDocs")}
          </Link>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
