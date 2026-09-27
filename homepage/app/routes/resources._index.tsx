import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { IconArrowUpRight } from "@tabler/icons-react";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { create_page_meta, get_path_locale } from "@/lib/seo";
import type { Route } from "./+types/resources._index";

/**
 * Resources 索引页。
 *
 * 为什么需要：该路由此前只是一个客户端 `<Navigate to="skills">` 跳转壳，
 * 预渲染产物没有 H1、也没有可索引正文，却仍被标记为 index,follow——
 * 既浪费抓取预算，又与「不放入 sitemap」的处理自相矛盾。
 *
 * 现在改为真正的导航页：输出唯一 H1 与四个子板块入口，文案复用既有的
 * resources i18n 命名空间，不新增未翻译内容。
 */
export function meta({ location }: Route.MetaArgs) {
  const is_chinese = get_path_locale(location.pathname) === "zh";
  const title = is_chinese
    ? "Downcity 资源：Skills、Agent 市场与托管 — Downcity"
    : "Downcity Resources: Skills, Marketplace, and Hosting — Downcity";
  const description = is_chinese
    ? "查找用于扩展 Downcity Agent Harness 的 Skill、Agent 市场条目、托管方式与示例项目。"
    : "Find skills, marketplace entries, hosting options, and example projects for building with a Downcity agent harness.";

  return create_page_meta({
    title,
    description,
    pathname: location.pathname,
    localized: true,
  });
}

const sections = [
  { id: "skills", path: "/resources/skills", key: "skills" },
  { id: "marketplace", path: "/resources/marketplace", key: "marketplace" },
  { id: "hosting", path: "/resources/hosting", key: "hosting" },
  { id: "examples", path: "/resources/examples", key: "examples" },
] as const;

export default function ResourcesIndex() {
  const locale = use_interface_locale();
  const { i18n } = useTranslation("resources");
  // 语言必须来自 URL：i18next 单例在服务端固定为 en，直接用 t 会把 /zh/ 预渲染成英文正文。
  const t = i18n.getFixedT(locale, "resources");
  const is_zh = locale === "zh";

  return (
    <section className="mx-auto max-w-[1600px] px-5 py-16 md:px-8 md:py-24 lg:px-20">
      <header className="max-w-2xl">
        <h1 className="font-serif text-[clamp(2rem,4.5vw,3rem)] font-bold leading-[1.1] tracking-[-0.03em] text-foreground">
          {t("title")}
        </h1>
        <p className="mt-5 text-base leading-[1.65] text-text-soft md:text-lg">
          {t("subtitle")}
        </p>
      </header>

      <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-[14px] bg-line sm:grid-cols-2 md:mt-16">
        {sections.map((section) => (
          <Link
            key={section.id}
            to={is_zh ? `/zh${section.path}` : section.path}
            className="group flex flex-col justify-between gap-6 bg-card p-7 transition-colors duration-150 hover:bg-background md:p-8"
          >
            <div>
              <h2 className="text-lg font-semibold leading-snug text-foreground">
                {t(`${section.key}.title`)}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-text-soft">
                {t(`${section.key}.description`)}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-text-soft transition-colors group-hover:text-foreground">
              {is_zh ? "查看" : "Browse"}
              <IconArrowUpRight
                className="size-4 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                strokeWidth={1.6}
              />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
