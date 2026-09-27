import type { FC } from "react";
import { Link } from "react-router";
import { IconArrowUpRight } from "@tabler/icons-react";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { homepage_positioning } from "@/lib/homepage-positioning";
import type { InterfaceLocale } from "@/types/interface-locale";

/**
 * 首页「深入了解」区块。
 *
 * 为什么需要：
 * 首页是全站唯一有外链的页面，但此前没有任何指向 blog 与 whitepaper 的链接，
 * 导致 /en/blog/ 与 /zh/blog/ 的站内入链数为 0（孤岛），承载 `agent harness`
 * 信息型长尾词的文章拿不到首页权重。
 *
 * 这里用关键词本身作为锚文本，把首页权重直接导向信息型内容。
 * 只链接中英文都存在的文章，避免出现单语死链。
 */
const learn_entries = [
  {
    key: "what_is_harness",
    path: { en: "/en/blog/what-is-an-agent-harness/", zh: "/zh/blog/what-is-an-agent-harness/" },
  },
  {
    key: "anatomy",
    path: {
      en: "/en/blog/the-anatomy-of-an-agent-harness/",
      zh: "/zh/blog/the-anatomy-of-an-agent-harness/",
    },
  },
  {
    key: "vs_mcp",
    path: { en: "/en/blog/agent-harness-vs-mcp/", zh: "/zh/blog/agent-harness-vs-mcp/" },
  },
  {
    key: "whitepaper",
    path: { en: "/whitepaper/", zh: "/zh/whitepaper/" },
  },
] as const;

export const HomeLearnSection: FC = () => {
  const locale = use_interface_locale();
  const positioning = homepage_positioning[locale];
  const links = positioning.learn_links as Record<
    (typeof learn_entries)[number]["key"],
    { title: string; description: string }
  >;

  return (
    <section className="border-t border-line bg-background py-20 md:py-28">
      <div className="mx-auto max-w-[1600px] px-5 md:px-8 lg:px-20">
        <div className="mb-12 max-w-2xl md:mb-16">
          <h2 className="font-serif text-[clamp(1.625rem,3vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
            {positioning.learn_title}
          </h2>
          <p className="mt-5 text-base leading-[1.65] text-text-soft">
            {positioning.learn_description}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[14px] bg-line sm:grid-cols-2">
          {learn_entries.map((entry) => {
            const copy = links[entry.key];
            const path = entry.path[locale as InterfaceLocale];

            return (
              <Link
                key={entry.key}
                to={path}
                className="group flex flex-col justify-between gap-6 bg-card p-7 transition-colors duration-150 hover:bg-background md:p-8"
              >
                <div>
                  <h3 className="text-lg font-semibold leading-snug text-foreground">
                    {copy.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-text-soft">
                    {copy.description}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-text-soft transition-colors group-hover:text-foreground">
                  {locale === "zh" ? "阅读全文" : "Read"}
                  <IconArrowUpRight
                    className="size-4 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    strokeWidth={1.6}
                  />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default HomeLearnSection;
