import { useState, type FC } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { IconPlayerPlayFilled, IconBrandGithub, IconCheck, IconCopy } from "@tabler/icons-react";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";

const github_url = "https://github.com/genesiscosmos/downcity";
const quick_start_commands = `npm install -g downcity

downcity agent create ./my-city
downcity federation use
downcity start
downcity agent start`;

/**
 * 首页收尾 CTA 模块。
 * 说明：
 * 1. 左侧说明产品启动路径，右侧展示可以直接复制的核心 CLI 示例。
 * 2. 行动入口收敛到快速开始与 GitHub。
 * 3. 示例只描述创建与启动，不绑定已有仓库或迁移场景。
 */
export const HomeCTASection: FC = () => {
  const { i18n } = useTranslation("home");
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "home");
  const [is_copied, set_is_copied] = useState(false);
  const is_zh = locale === "zh";
  const start_path = is_zh ? "/zh/start" : "/start";

  const copy_commands = async () => {
    await navigator.clipboard.writeText(quick_start_commands);
    set_is_copied(true);
    window.setTimeout(() => set_is_copied(false), 1600);
  };

  return (
    <section className="border-t border-line bg-background py-20 md:py-28">
      <div className="mx-auto grid max-w-[1600px] gap-12 px-5 md:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:gap-20 lg:px-20">
        <div className="max-w-xl">
          <h2 className="font-serif text-[clamp(1.625rem,3vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
            {t("cta.title")}
          </h2>
          <p className="mt-5 text-base leading-[1.65] text-text-soft">
            {t("cta.description")}
          </p>

          <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row">
            <Link
              to={start_path}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-76"
            >
              <IconPlayerPlayFilled className="size-3.5" />
              {t("cta.start")}
            </Link>

            <a
              href={github_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-foreground/[0.05] px-5 text-sm font-semibold text-foreground transition-colors hover:bg-foreground/[0.08]"
            >
              <IconBrandGithub className="size-4" />
              {t("cta.github")}
            </a>
          </div>
        </div>

        <div className="overflow-hidden rounded-[14px] border border-line bg-[#11130f] text-[#f3f1e8] shadow-[0_24px_80px_rgba(24,28,21,0.12)]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 md:px-5">
            <span className="font-mono text-[0.72rem] text-white/55">{t("cta.codeLabel")}</span>
            <button
              type="button"
              onClick={copy_commands}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[0.68rem] text-white/55 transition-colors hover:bg-white/5 hover:text-white"
              aria-label={is_copied ? t("cta.copiedCode") : t("cta.copyCode")}
            >
              {is_copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
              {is_copied ? t("cta.copiedCode") : t("cta.copyCode")}
            </button>
          </div>
          <pre className="overflow-x-auto p-5 text-left font-mono text-[0.78rem] leading-7 md:p-7 md:text-[0.84rem]">
            <code>{quick_start_commands}</code>
          </pre>
        </div>
      </div>
    </section>
  );
};

export default HomeCTASection;
