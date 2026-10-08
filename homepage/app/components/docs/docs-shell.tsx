/**
 * 文档版式外壳模块。
 *
 * 一个外壳服务全部文档空间：顶部固定头部（空间切换、搜索、语言、主题），左侧导航树，
 * 中间正文，右侧目录。原先每个空间各写一份 `layout.tsx`，重复度高且难以统一，
 * 现在改为由本模块接收空间与语言参数统一渲染。
 *
 * 布局约定：
 * 1. 头部与侧边栏在滚动时保持固定，正文独立滚动，长文档不会丢失导航。
 * 2. 右侧目录只在宽屏显示：窄屏下它与正文争夺宽度，收益为负。
 * 3. 窄屏隐藏侧边栏，由头部按钮唤起抽屉式导航。
 */
import { Link, useLocation } from "react-router";
import { IconMenu2, IconX } from "@tabler/icons-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { DocsSearch } from "@/components/docs/docs-search";
import { ThemeSwitcher } from "@/components/docs/theme-switcher";
import { LanguageSwitcher } from "@/components/docs/language-switcher";
import { docs_spaces } from "@/lib/docs/spaces";
import type { DocsLocale, DocsNavNode } from "@/lib/docs/types";

/** 头部与侧边栏共享的文案集合。 */
export type DocsShellLabels = {
  /** 搜索按钮与对话框标题。 */
  search: string;
  /** 搜索输入框占位文字。 */
  search_placeholder: string;
  /** 搜索无结果提示。 */
  search_empty: string;
  /** 搜索结果分组标题。 */
  search_results: string;
  /** 右侧目录标题。 */
  toc: string;
  /** 主题切换器无障碍标签。 */
  switch_theme: string;
  /** 语言切换器无障碍标签。 */
  switch_language: string;
  /** 移动端导航开关标签。 */
  toggle_navigation: string;
  /** 当前空间显示名。 */
  space_label: string;
};

/**
 * 文档外壳。
 *
 * 侧边栏与目录由调用方传入，外壳只负责布局与共享控件，避免把数据获取塞进版式层。
 */
export function DocsShell({
  space_id,
  locale,
  tree,
  current_url,
  alternate_url,
  labels,
  children,
}: {
  /** 当前文档空间标识，用于空间切换。 */
  space_id: string;
  /** 当前界面语言。 */
  locale: DocsLocale;
  /** 当前空间的导航树。 */
  tree: DocsNavNode[];
  /** 当前页面公开 URL，用于高亮与展开。 */
  current_url: string;
  /** 另一种语言下的对应页面 URL，不存在时隐藏语言入口。 */
  alternate_url?: string;
  /** 外壳文案。 */
  labels: DocsShellLabels;
  /** 正文区域，通常是右上角带目录的文档内容。 */
  children: ReactNode;
}) {
  const location = useLocation();
  const [mobile_nav_open, set_mobile_nav_open] = useState(false);

  // 路由变化后关闭移动端导航，避免遮挡新页面。
  useEffect(() => {
    set_mobile_nav_open(false);
  }, [location.pathname]);

  const sidebar_content = (
    <DocsSidebar tree={tree} current_path={current_url} title={labels.space_label} />
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-line bg-background/88 backdrop-blur-[16px]">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 md:px-6">
          <button
            type="button"
            aria-label={labels.toggle_navigation}
            onClick={() => set_mobile_nav_open(true)}
            className="inline-flex size-8 items-center justify-center rounded-md text-text-soft transition-colors hover:bg-foreground/[0.04] hover:text-foreground lg:hidden"
          >
            <IconMenu2 className="size-4" strokeWidth={1.8} />
          </button>

          <Link
            to={locale === "zh" ? "/zh" : "/"}
            className="inline-flex items-center gap-2 text-[0.9375rem] font-semibold text-foreground"
          >
            <img
              src="/icon-512.png"
              alt="Downcity"
              className="brand-logo block size-6 shrink-0 object-contain"
            />
            <span className="hidden sm:inline">Downcity</span>
          </Link>

          {/* 空间切换直接暴露同级文档空间，避免用户被迫回到首页再进入。 */}
          <nav aria-label={labels.space_label} className="hidden items-center gap-0.5 md:flex">
            {docs_spaces
              .filter((space) => space.uses_docs_layout)
              .map((space) => {
                const is_current = space.id === space_id;

                return (
                  <Link
                    key={space.id}
                    to={`/${locale}/${space.id}/`}
                    data-active={is_current ? "true" : "false"}
                    className={cn(
                      "inline-flex h-8 items-center rounded-md px-2.5 text-[0.8125rem] font-medium transition-colors",
                      is_current
                        ? "bg-foreground/[0.05] text-foreground"
                        : "text-text-soft hover:bg-foreground/[0.04] hover:text-foreground",
                    )}
                  >
                    {space.label[locale]}
                  </Link>
                );
              })}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <DocsSearch
              locale={locale}
              trigger_label={labels.search}
              placeholder={labels.search_placeholder}
              empty_label={labels.search_empty}
              recent_hint={labels.search_results}
            />
            <LanguageSwitcher
              locale={locale}
              target_url={alternate_url}
              label={labels.switch_language}
            />
            <ThemeSwitcher label={labels.switch_theme} />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px] gap-8 px-4 md:px-6">
        {/* 左侧导航：宽屏常驻，窄屏由头部按钮唤起。 */}
        <aside className="hidden w-60 shrink-0 border-r border-line py-8 lg:block">
          <div className="sticky top-22 max-h-[calc(100svh-6rem)] overflow-y-auto pr-4">
            {sidebar_content}
          </div>
        </aside>

        {mobile_nav_open ? (
          <div className="fixed inset-0 z-100 lg:hidden">
            <div
              className="absolute inset-0 bg-background/60 backdrop-blur-sm"
              role="presentation"
              onClick={() => set_mobile_nav_open(false)}
            />
            <div className="relative h-full w-72 max-w-[80vw] overflow-y-auto border-r border-line bg-surface px-4 py-6">
              <button
                type="button"
                aria-label={labels.toggle_navigation}
                onClick={() => set_mobile_nav_open(false)}
                className="mb-4 inline-flex size-8 items-center justify-center rounded-md text-text-soft hover:text-foreground"
              >
                <IconX className="size-4" strokeWidth={1.8} />
              </button>
              {sidebar_content}
            </div>
          </div>
        ) : null}

        <main className="min-w-0 flex-1 py-8">{children}</main>
      </div>
    </div>
  );
}

/**
 * 文档正文区域外壳。
 *
 * 正文与右侧目录并排；目录在窄屏隐藏。宽屏下正文宽度被限制在舒适阅读区间，
 * 避免超宽屏幕上行长过长。
 */
export function DocsContentLayout({
  toc,
  children,
}: {
  /** 右侧目录区域。 */
  toc: ReactNode;
  /** 正文内容。 */
  children: ReactNode;
}) {
  return (
    <div className="flex gap-10">
      <div className="min-w-0 flex-1">{children}</div>
      {toc ? (
        <aside className="hidden w-52 shrink-0 xl:block">
          <div className="sticky top-22 max-h-[calc(100svh-6rem)] overflow-y-auto">{toc}</div>
        </aside>
      ) : null}
    </div>
  );
}
