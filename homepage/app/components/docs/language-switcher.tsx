/**
 * 文档语言切换控件。
 *
 * 切换到当前页面的另一种语言：目标 URL 由路由层传入（已按源文件存在性校验），
 * 不存在对应语言时按钮禁用，避免把用户带到 404。
 *
 * 为什么由调用方传目标路径：只有路由层知道当前是哪个文档空间、哪个 slug，以及
 * 另一种语言的对应页面是否真实存在。控件本身只负责交互与展示。
 */
import { IconLanguage } from "@tabler/icons-react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import type { DocsLocale } from "@/lib/docs/types";

/** 语言显示名。 */
const locale_labels: Record<DocsLocale, string> = {
  en: "English",
  zh: "中文",
};

/** 语言切换器。 */
export function LanguageSwitcher({
  locale,
  target_url,
  label,
}: {
  /** 当前语言。 */
  locale: DocsLocale;
  /** 另一种语言的对应 URL；不存在时为空。 */
  target_url?: string;
  /** 控件无障碍标签。 */
  label: string;
}) {
  const next_locale: DocsLocale = locale === "en" ? "zh" : "en";
  const base_class =
    "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[0.8125rem] text-text-soft transition-colors";

  if (!target_url) {
    return (
      <span
        aria-disabled="true"
        title={label}
        className={cn(base_class, "cursor-not-allowed opacity-45")}
      >
        <IconLanguage className="size-3.5" strokeWidth={1.8} />
        <span className="hidden sm:inline">{locale_labels[next_locale]}</span>
      </span>
    );
  }

  return (
    <Link
      to={target_url}
      title={label}
      className={cn(base_class, "hover:bg-foreground/[0.04] hover:text-foreground")}
    >
      <IconLanguage className="size-3.5" strokeWidth={1.8} />
      <span className="hidden sm:inline">{locale_labels[next_locale]}</span>
    </Link>
  );
}
