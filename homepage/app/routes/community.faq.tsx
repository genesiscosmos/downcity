import { useState } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { COMMUNITY_LINKS } from "@/lib/community-links";
import { cn } from "@/lib/utils";
import { create_page_meta, get_path_locale } from "@/lib/seo";
import {
  create_faq_structured_data,
  serialize_structured_data,
} from "@/lib/structured-data";
import type { Route } from "./+types/community.faq";

export function meta({ location }: Route.MetaArgs) {
  const is_chinese = get_path_locale(location.pathname) === "zh";
  const title = is_chinese
    ? "Agent Harness 常见问题：模型、记忆与部署 — Downcity"
    : "Agent Harness FAQ: Models, Memory, Deployment — Downcity";
  const description = is_chinese
    ? "关于 Downcity 的常见问题解答：可用模型、Agent 记忆如何工作、权限边界、多 Agent 协作与部署方式。"
    : "Answers to common questions about Downcity: which models you can use, how agent memory works, permissions, multi-agent setups, and deployment.";
  return create_page_meta({
    title,
    description,
    pathname: location.pathname,
    localized: true,
  });
}

const faqs = [
  { id: "modify-code", category: "security" },
  { id: "llm-models", category: "technical" },
  { id: "remote-deployment", category: "deployment" },
  { id: "comparison-copilot", category: "general" },
  { id: "memory", category: "features" },
  { id: "multi-agent", category: "features" },
  { id: "custom-services", category: "features" },
  { id: "pricing", category: "general" },
] as const;

const categories = [...new Set(faqs.map((faq) => faq.category))];

export default function FAQ() {
  const location = useLocation();
  const is_chinese = get_path_locale(location.pathname) === "zh";
  const lng = is_chinese ? "zh" : "en";
  const { t } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const docsPath = is_chinese ? "/zh/docs" : "/en/docs";
  const discussionsUrl = COMMUNITY_LINKS.telegram;
  const page_title = is_chinese ? "常见问题" : "Frequently Asked Questions";

  // SSR 阶段 i18next 单例固定初始化为 en，URL 才是语言的事实源；
  // 所有文案必须显式传 lng，否则 /zh/ 页面会预渲染出英文内容。
  const translate = (key: string) => t(`community:faqPage.${key}`, { lng });

  const filteredFAQs = selectedCategory
    ? faqs.filter((faq) => faq.category === selectedCategory)
    : faqs;

  // JSON-LD 与页面可见文本必须同源同语言，否则不符合 FAQ 富结果规范。
  const faq_structured_data = create_faq_structured_data(
    faqs.map((faq) => ({
      question: t(`community:faqPage.items.${faq.id}.question`, { lng }),
      answer: t(`community:faqPage.items.${faq.id}.answer`, { lng }),
    })),
  );

  return (
    <div className="mx-auto max-w-[1320px] px-5 py-16 md:px-8 md:py-24 lg:px-20">
      <script
        type="application/ld+json"
        data-downcity-structured-data="faq"
        dangerouslySetInnerHTML={{
          __html: serialize_structured_data(faq_structured_data),
        }}
      />
      <header className="space-y-4">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-text-soft">
          FAQ
        </span>
        <h1 className="font-serif text-[clamp(1.875rem,4vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
          {page_title}
        </h1>
        <p className="max-w-2xl text-base leading-[1.65] text-text-soft">
          {translate("subtitle")}
        </p>
      </header>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedCategory(null)}
          className={cn(
            "inline-flex h-9 items-center rounded-full border px-3 text-sm transition-colors",
            selectedCategory === null
              ? "border-line-strong bg-surface-soft text-foreground"
              : "border-line bg-surface text-text-soft hover:bg-surface-soft hover:text-foreground",
          )}
        >
          {translate("all")}
        </button>
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setSelectedCategory(category)}
            className={cn(
              "inline-flex h-9 items-center rounded-full border px-3 text-sm transition-colors",
              selectedCategory === category
                ? "border-line-strong bg-surface-soft text-foreground"
                : "border-line bg-surface text-text-soft hover:bg-surface-soft hover:text-foreground",
            )}
          >
            {t(`community:faqPage.categories.${category}`, { lng })}
          </button>
        ))}
      </div>

      <section className="mt-6 space-y-3">
        {filteredFAQs.map((faq, index) => (
          <article
            key={faq.id}
            className="overflow-hidden rounded-[14px] border border-line bg-card shadow-sm"
          >
            <button
              onClick={() => setOpenId(openId === faq.id ? null : faq.id)}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
            >
              <span className="flex items-center gap-3">
                <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.06em] text-text-subtle">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="text-sm font-semibold text-foreground md:text-base">
                  {t(`community:faqPage.items.${faq.id}.question`, { lng })}
                </span>
              </span>
              <span className="font-mono text-xs text-text-subtle">
                {openId === faq.id ? "close" : "open"}
              </span>
            </button>
            {/*
              答案始终渲染进 DOM，收起态只用 hidden 类切换可见性：
              预渲染 HTML 必须包含完整答案文本，搜索引擎才能抓取问答内容，
              同时与 FAQPage JSON-LD 保持一致。
            */}
            <div
              className={cn(
                "border-t border-line px-5 pb-4 pt-3 text-sm leading-7 text-text-soft",
                openId === faq.id ? "block" : "hidden",
              )}
            >
              {t(`community:faqPage.items.${faq.id}.answer`, { lng })}
            </div>
          </article>
        ))}
      </section>

      <section className="mt-8 rounded-[14px] border border-line bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-foreground">{translate("callout.title")}</h3>
        <p className="mt-2 text-sm leading-relaxed text-text-soft">
          {translate("callout.description")}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a
            href={discussionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-76"
          >
            {translate("callout.askGithub")}
          </a>
          <a
            href={docsPath}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-foreground/[0.05] px-5 text-sm font-semibold text-foreground transition-colors hover:bg-foreground/[0.08]"
          >
            {translate("callout.readDocs")}
          </a>
        </div>
      </section>
    </div>
  );
}
