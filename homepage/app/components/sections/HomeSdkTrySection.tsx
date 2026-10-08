/**
 * 首页 SDK 试驾区块。
 *
 * 位置在 Hero 之后、滚动叙事之前：首屏之后立刻给出可点击的真实 API 形状，
 * 让访问者不必先看完滚动动画就能判断这套 SDK 是否对得上自己的用法。
 */
import { useTranslation } from "react-i18next";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { HomeSdkTryPanel } from "@/components/sections/HomeSdkTryPanel";

/** 渲染 SDK 试驾区块。 */
export function HomeSdkTrySection() {
  const { i18n } = useTranslation("home");
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "home");

  return (
    <section className="border-t border-line bg-background py-16 md:py-20">
      <div className="mx-auto max-w-[1600px] px-5 md:px-8 lg:px-20">
        <div className="mb-10 max-w-2xl">
          <p className="mb-4 text-[0.78rem] font-medium uppercase tracking-[0.04em] text-text-soft">
            {t("sdkTry.label")}
          </p>
          <h2 className="font-serif text-[clamp(1.625rem,3vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
            {t("sdkTry.title")}
          </h2>
          <p className="mt-5 text-base leading-[1.65] text-text-soft">{t("sdkTry.description")}</p>
        </div>
        <HomeSdkTryPanel />
      </div>
    </section>
  );
}

export default HomeSdkTrySection;
