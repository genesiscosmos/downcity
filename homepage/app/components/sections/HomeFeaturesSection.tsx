import type { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  IconArrowUpRight,
  IconGitBranch,
  IconMessages,
  IconTools,
  IconClockPlay,
  IconUsersGroup,
  IconAppWindow,
} from "@tabler/icons-react";
import { homepage_positioning } from "@/lib/homepage-positioning";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";

const features = [
  {
    key: "workspace",
    icon: IconGitBranch,
  },
  {
    key: "session",
    icon: IconMessages,
  },
  {
    key: "actions",
    icon: IconTools,
  },
  {
    key: "continuity",
    icon: IconClockPlay,
  },
  {
    key: "collaboration",
    icon: IconUsersGroup,
  },
  {
    key: "control",
    icon: IconAppWindow,
  },
] as const;

/**
 * 首页功能预览模块（Vibecape 编号卡片风格）。
 * 说明：
 * 1. 6 张卡片描述创作者构建 Agent 产品所需的完整能力闭环。
 * 2. 使用 home 命名空间文案，与 features 页面解耦。
 * 3. 1px 细线分隔的网格，hover 背景变化。
 */
export const HomeFeaturesSection: FC = () => {
  const { i18n } = useTranslation("home");
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "home");
  const positioning = homepage_positioning[locale];

  return (
    <section className="border-t border-line bg-background py-20 md:py-28">
      <div className="mx-auto max-w-[1600px] px-5 md:px-8 lg:px-20">
        <div className="mb-12 max-w-2xl md:mb-16">
          <p className="mb-4 text-[0.78rem] font-medium uppercase tracking-[0.04em] text-text-soft">
            {t("features.sectionLabel")}
          </p>
          <h2 className="font-serif text-[clamp(1.625rem,3vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
            {positioning.features_title}{" "}
            <span className="text-foreground/70">{positioning.features_title_emphasis}</span>
          </h2>
          <p className="mt-5 text-base leading-[1.65] text-text-soft">
            {positioning.features_description}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[14px] bg-line sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            const number = String(index + 1).padStart(2, "0");
            return (
              <article
                key={feature.key}
                className="group min-h-[260px] bg-card p-7 transition-colors duration-150 hover:bg-background md:p-8"
              >
                <div className="flex items-start justify-between">
                  <span className="font-mono text-[0.7rem] font-medium text-text-subtle">{number}</span>
                  <IconArrowUpRight className="size-4 text-text-subtle transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={1.5} />
                </div>
                <div className="mt-6 inline-flex items-center justify-center rounded-lg bg-surface-soft p-2.5 text-foreground">
                  <Icon className="size-5" strokeWidth={1.4} />
                </div>
                <h3 className="mt-5 text-lg font-semibold leading-snug text-foreground">
                  {t(`features.cards.${feature.key}.title`)}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-text-soft">
                  {t(`features.cards.${feature.key}.description`)}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default HomeFeaturesSection;
