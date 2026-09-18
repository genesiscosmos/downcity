import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import {
  BotIcon,
  BrainIcon,
  FileTextIcon,
  HammerIcon,
  LayersIcon,
  ShieldIcon,
  ArrowUpRightIcon,
} from "lucide-react";

const features = [
  {
    titleKey: "features:cards.agent.title",
    descriptionKey: "features:cards.agent.description",
    icon: BotIcon,
    number: "01",
  },
  {
    titleKey: "features:cards.knowledge.title",
    descriptionKey: "features:cards.knowledge.description",
    icon: BrainIcon,
    number: "02",
  },
  {
    titleKey: "features:cards.runtime.title",
    descriptionKey: "features:cards.runtime.description",
    icon: LayersIcon,
    number: "03",
  },
  {
    titleKey: "features:cards.tools.title",
    descriptionKey: "features:cards.tools.description",
    icon: HammerIcon,
    number: "04",
  },
  {
    titleKey: "features:cards.ownership.title",
    descriptionKey: "features:cards.ownership.description",
    icon: ShieldIcon,
    number: "05",
  },
  {
    titleKey: "features:cards.surface.title",
    descriptionKey: "features:cards.surface.description",
    icon: FileTextIcon,
    number: "06",
  },
] as const;

const architecture = [
  { titleKey: "features:architecture.knowledge.title", descriptionKey: "features:architecture.knowledge.description" },
  { titleKey: "features:architecture.agent.title", descriptionKey: "features:architecture.agent.description" },
  { titleKey: "features:architecture.action.title", descriptionKey: "features:architecture.action.description" },
] as const;

const scenarios = [
  { titleKey: "features:scenarios.research.title", descriptionKey: "features:scenarios.research.description" },
  { titleKey: "features:scenarios.report.title", descriptionKey: "features:scenarios.report.description" },
  { titleKey: "features:scenarios.learning.title", descriptionKey: "features:scenarios.learning.description" },
  { titleKey: "features:scenarios.knowledgeBase.title", descriptionKey: "features:scenarios.knowledgeBase.description" },
  { titleKey: "features:scenarios.publishing.title", descriptionKey: "features:scenarios.publishing.description" },
] as const;

/**
 * 功能页特性模块（Vibecape 风格）。
 * 说明：
 * 1. 顶部为 eyebrow + 标题 + 描述。
 * 2. 3 列特性卡片使用 1px 细线分隔，hover 背景变化。
 * 3. 下方为场景列表与架构三栏说明。
 */
export const FeaturesSection: FC = () => {
  // 语言必须来自 URL：i18next 单例在服务端固定为 en，用 useTranslation() 的 t 会把 /zh/ 预渲染成英文正文。
  const locale = use_interface_locale();
  const { i18n } = useTranslation();
  const t = i18n.getFixedT(locale);

  return (
    <section className="border-b border-line bg-background py-20 md:py-28">
      <div className="mx-auto max-w-[1600px] px-5 md:px-8 lg:px-20">
        <div className="mb-14 max-w-2xl md:mb-16">
          <p className="mb-4 text-[0.78rem] font-medium uppercase tracking-[0.04em] text-text-soft">
            {t("features:sectionLabel")}
          </p>
          <h1 className="font-serif text-[clamp(1.625rem,3vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
            {t("features:title")}{" "}
            <span className="text-foreground/70">{t("features:titleItalic")}</span>
          </h1>
          <p className="mt-5 text-base leading-[1.65] text-text-soft">{t("features:description")}</p>
        </div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[14px] bg-line sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <article
              key={feature.number}
              className="min-h-[260px] bg-card p-8 transition-colors duration-150 hover:bg-background md:min-h-[300px] md:p-10"
            >
              <div className="flex items-center justify-between text-text-subtle">
                <span className="font-mono text-[0.7rem] font-medium">{feature.number}</span>
                <ArrowUpRightIcon className="size-4" strokeWidth={1.5} />
              </div>
              <div className="mt-8 text-foreground">
                <feature.icon className="size-6" strokeWidth={1.4} />
              </div>
              <h3 className="mt-6 text-lg font-semibold leading-snug text-foreground">{t(feature.titleKey as never)}</h3>
              <p className="mt-3 text-sm leading-relaxed text-text-soft">{t(feature.descriptionKey as never)}</p>
            </article>
          ))}
        </div>

        <div className="mt-20 grid gap-12 md:mt-28 lg:grid-cols-[320px_1fr] lg:gap-20">
          <div>
            <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.06em] text-text-subtle">
              {t("features:scenarios.kicker")}
            </p>
            <h3 className="mt-4 font-serif text-[clamp(1.375rem,2.5vw,1.75rem)] font-bold leading-[1.16] tracking-[-0.02em] text-foreground">
              {t("features:scenarios.title")}
            </h3>
          </div>

          <div className="grid border-t border-line">
            {scenarios.map((item, index) => (
              <article
                key={item.titleKey}
                className="grid grid-cols-[40px_minmax(140px,220px)_1fr] items-baseline gap-6 border-b border-line py-6 md:gap-8 md:py-7"
              >
                <span className="font-mono text-[0.7rem] text-text-subtle">{String(index + 1).padStart(2, "0")}</span>
                <h4 className="text-base font-semibold text-foreground">{t(item.titleKey as never)}</h4>
                <p className="text-sm leading-relaxed text-text-soft">{t(item.descriptionKey as never)}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="mt-20 grid gap-10 border-t border-line pt-10 md:mt-28 md:grid-cols-3 md:gap-20 md:pt-12">
          {architecture.map((item, index) => (
            <section key={item.titleKey} className="relative">
              <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-foreground">
                {t(item.titleKey as never)}
              </h3>
              <p className="mt-6 text-base font-medium leading-[1.7] text-foreground">
                {t(item.descriptionKey as never)}
              </p>
              <span className="absolute right-0 top-0 font-mono text-[0.7rem] text-text-subtle">
                {String(index + 1).padStart(2, "0")}
              </span>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
