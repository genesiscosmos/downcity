import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { IconArrowUpRight, IconHelp, IconMap2, IconMessageCircle } from "@tabler/icons-react";
import { COMMUNITY_LINKS } from "@/lib/community-links";

const communityLinks = [
  {
    titleKey: "community:faq.title",
    descriptionKey: "community:faq.description",
    icon: IconHelp,
    path: "/faq",
  },
  {
    titleKey: "community:roadmap.title",
    descriptionKey: "community:roadmap.description",
    icon: IconMap2,
    path: "/roadmap",
  },
  {
    titleKey: "community:discussions.title",
    descriptionKey: "community:discussions.description",
    icon: IconMessageCircle,
    href: COMMUNITY_LINKS.telegram,
    external: true,
  },
] as const;

/**
 * 社区首页模块（Vibecape 风格）。
 * 说明：
 * 1. 用 1px 细线 grid 把 FAQ、Roadmap、Discussions 组织成同一张卡片。
 * 2. 视觉上与资源页保持同构，减少页面切换的断裂感。
 */
export const CommunitySection: FC = () => {
  // 语言必须来自 URL：i18next 单例在服务端固定为 en，用 i18n.language 会把 /zh/ 预渲染成英文正文。
  const locale = use_interface_locale();
  const { i18n } = useTranslation();
  const t = i18n.getFixedT(locale);
  const basePath = locale === "zh" ? "/zh/community" : "/community";

  return (
    <section className="mx-auto max-w-[1320px] px-5 py-16 md:px-8 md:py-24 lg:px-20">
      <header className="space-y-4">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-text-soft">
          Community
        </span>
        <h1 className="font-serif text-[clamp(1.875rem,4vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
          {t("community:title")}
        </h1>
        <p className="max-w-2xl text-base leading-[1.65] text-text-soft">{t("community:subtitle")}</p>
      </header>

      <div className="mt-8 grid gap-px overflow-hidden rounded-[14px] bg-line">
        {communityLinks.map((item, index) => {
          const isExternal = "external" in item && item.external === true;
          const href = "href" in item ? item.href : `${basePath}${item.path}`;

          return (
            <a
              key={item.titleKey}
              href={href}
              target={isExternal ? "_blank" : undefined}
              rel={isExternal ? "noopener noreferrer" : undefined}
              className="grid gap-4 bg-card px-5 py-5 transition-colors hover:bg-background md:grid-cols-[3rem_minmax(0,1fr)_auto] md:items-center md:px-7"
            >
              <div className="flex items-center gap-2 md:block">
                <p className="text-[0.78rem] font-medium uppercase tracking-[0.04em] text-text-soft">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <item.icon className="size-4 text-text-subtle md:mt-3" />
              </div>
              <div>
                <h2 className="font-serif text-[1.35rem] font-semibold tracking-[-0.035em] text-foreground">
                  {t(item.titleKey)}
                </h2>
                <p className="mt-2 text-sm leading-7 text-text-soft">{t(item.descriptionKey)}</p>
              </div>
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                {locale === "zh" ? "进入" : "Open"}
                <IconArrowUpRight className="size-4" />
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
};

export default CommunitySection;
