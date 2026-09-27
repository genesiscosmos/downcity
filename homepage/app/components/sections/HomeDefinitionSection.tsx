import type { FC } from "react";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { homepage_positioning } from "@/lib/homepage-positioning";

/**
 * 首页品类定义区块。
 *
 * 为什么需要：
 * 1. 首页原有可见正文约 476 词，`agent harness` 仅出现 2 次，不足以支撑品类词排名。
 * 2. 定义型首句是 AI 答案引擎（AI Overviews、Perplexity、ChatGPT）最常直接引用的
 *    句式，放在 Features 之前可以同时服务传统搜索与 AI 检索。
 *
 * 文案来源统一走 homepage_positioning，保证中英文与 SEO meta 使用同一份定位。
 */
export const HomeDefinitionSection: FC = () => {
  const locale = use_interface_locale();
  const positioning = homepage_positioning[locale];

  return (
    <section className="border-t border-line bg-background py-16 md:py-20">
      <div className="mx-auto max-w-[1600px] px-5 md:px-8 lg:px-20">
        <div className="max-w-3xl">
          <h2 className="font-serif text-[clamp(1.5rem,2.6vw,2rem)] font-bold leading-[1.15] tracking-[-0.02em] text-foreground">
            {positioning.definition_eyebrow}
          </h2>
          <p className="mt-5 text-base leading-[1.75] text-text-soft md:text-lg">
            {positioning.definition_body}
          </p>
        </div>
      </div>
    </section>
  );
};

export default HomeDefinitionSection;
