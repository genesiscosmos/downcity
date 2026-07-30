import type { FC } from "react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { IconPlayerPlayFilled, IconBrandGithub } from "@tabler/icons-react";
import { resolve_interface_locale } from "@/lib/interface-locale";

const GITHUB_URL = "https://github.com/genesiscosmos/downcity";

/**
 * 首页收尾 CTA 模块。
 * 说明：
 * 1. 居中大标题 + 副标题。
 * 2. 平台安装入口 + GitHub 按钮。
 * 3. 使用 home 命名空间文案。
 */
export const HomeCTASection: FC = () => {
  const { i18n } = useTranslation("home");
  const location = useLocation();
  const locale = resolve_interface_locale(location.pathname, i18n.resolvedLanguage ?? i18n.language);
  const t = i18n.getFixedT(locale, "home");
  const isZh = locale === "zh";
  const startPath = isZh ? "/zh/start" : "/start";

  return (
    <section className="border-t border-line bg-background py-20 md:py-28">
      <div className="mx-auto max-w-[1600px] px-5 text-center md:px-8 lg:px-20">
        <h2 className="mx-auto max-w-2xl font-serif text-[clamp(1.625rem,3vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
          {t("cta.title")}
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-base leading-[1.65] text-text-soft">
          {t("cta.description")}
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to={startPath}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-76"
          >
            <IconPlayerPlayFilled className="size-3.5" />
            {t("cta.install")}
          </Link>

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-foreground/[0.05] px-5 text-sm font-semibold text-foreground transition-colors hover:bg-foreground/[0.08]"
          >
            <IconBrandGithub className="size-4" />
            {t("cta.github")}
          </a>
        </div>
      </div>
    </section>
  );
};

export default HomeCTASection;
