"use client";

import * as React from "react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useTheme } from "fumadocs-ui/provider/base";
import { setLang } from "@/lib/locales";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  IconArrowUpRight,
  IconBook,
  IconBox,
  IconBrandGithub,
  IconBrandX,
  IconCheck,
  IconChevronDown,
  IconDeviceDesktop,
  IconLanguage,
  IconLayoutDashboard,
  IconMenu2,
  IconMoon,
  IconPuzzle,
  IconRobot,
  IconServer,
  IconSun,
  IconSunMoon,
  IconTerminal,
} from "@tabler/icons-react";

/**
 * 顶部导航模块（Vibecape 式极简）。
 * 说明：
 * 1. 粘性毛玻璃导航，60px 高度，信息密度低。
 * 2. Product / Quick Start / Agent SDK / City SDK / Docs / GitHub 使用稳定直链。
 * 3. 其余产品和社区入口收纳到一个次级菜单，保持核心路径权重清晰。
 * 4. 移动端同样先展示核心入口，再展示完整次级入口。
 */

type NavLinkItem =
  | { label: string; description: string; path: string; icon: typeof IconBook }
  | { label: string; description: string; href: string; external: true; icon: typeof IconBook };

type NavGroup = {
  label: string;
  activePaths: readonly string[];
  items: readonly NavLinkItem[];
};

const GITHUB_URL = "https://github.com/wangenius/downcity";
const TWITTER_URL = "https://x.com/downcity_ai";

export function Navbar() {
  const { t } = useTranslation("common");
  const location = useLocation();
  const isZh = location.pathname === "/zh" || location.pathname.startsWith("/zh/");

  const [scrolled, set_scrolled] = useState(false);
  useEffect(() => {
    const handle_scroll = () => set_scrolled(window.scrollY > 0);
    handle_scroll();
    window.addEventListener("scroll", handle_scroll, { passive: true });
    return () => window.removeEventListener("scroll", handle_scroll);
  }, []);

  const homePath = isZh ? "/zh" : "/";
  const productPath = isZh ? "/zh/product" : "/product";
  const productUiSdkPath = isZh ? "/zh/product/ui-sdk" : "/product/ui-sdk";
  const startPath = isZh ? "/zh/start" : "/start";
  const featuresPath = isZh ? "/zh/features" : "/features";
  const docsPath = isZh ? "/zh/docs" : "/en/docs";
  const citySdkDocsPath = isZh ? "/zh/city-sdk-docs" : "/en/city-sdk-docs";
  const agentSdkDocsPath = isZh ? "/zh/agent-sdk-docs" : "/en/agent-sdk-docs";
  const pluginsDocsPath = isZh ? "/zh/plugins-docs" : "/en/plugins-docs";
  const uiSdkDocsPath = isZh ? "/zh/ui-sdk-docs" : "/en/ui-sdk-docs";
  const paymentsPath = isZh ? "/zh/payments" : "/en/payments";
  const cliDocsPath = isZh ? "/zh/docs/cli/cli" : "/en/docs/cli/cli";
  const communityPath = isZh ? "/zh/community" : "/community";
  const faqPath = isZh ? "/zh/community/faq" : "/community/faq";
  const roadmapPath = isZh ? "/zh/community/roadmap" : "/community/roadmap";
  const showcasePath = isZh ? "/zh/community/showcase" : "/community/showcase";

  const moreGroup: NavGroup = {
    label: isZh ? "更多" : "More",
    activePaths: [featuresPath, productUiSdkPath, cliDocsPath, pluginsDocsPath, uiSdkDocsPath, paymentsPath, communityPath, faqPath, roadmapPath, showcasePath],
    items: [
      { label: t("nav.features"), description: isZh ? "完整能力总览" : "Complete capability overview", path: featuresPath, icon: IconLayoutDashboard },
      { label: "CLI Docs", description: isZh ? "CLI 使用文档" : "CLI documentation", path: cliDocsPath, icon: IconTerminal },
      { label: "UI SDK", description: isZh ? "UI 组件与文档" : "UI components and docs", path: uiSdkDocsPath, icon: IconLayoutDashboard },
      { label: "Plugins", description: isZh ? "插件系统文档" : "Plugin system docs", path: pluginsDocsPath, icon: IconPuzzle },
      { label: "Services", description: isZh ? "服务与支付基础设施" : "Services and payment infrastructure", path: paymentsPath, icon: IconServer },
      { label: t("nav.community"), description: isZh ? "社区入口" : "Community overview", path: communityPath, icon: IconBox },
      { label: t("nav.faq"), description: isZh ? "常见问题" : "Frequently asked questions", path: faqPath, icon: IconBook },
      { label: t("nav.roadmap"), description: isZh ? "产品路线图" : "Product roadmap", path: roadmapPath, icon: IconBook },
      { label: isZh ? "案例" : "Showcase", description: isZh ? "使用 Downcity 构建的产品" : "Products built with Downcity", path: showcasePath, icon: IconBox },
      { label: "X", description: isZh ? "官方账号" : "Official account", href: TWITTER_URL, external: true, icon: IconBrandX },
    ],
  };

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);
  const isAnyActive = (paths: readonly string[]) => paths.some((path) => isActive(path));

  const linkBaseClass =
    "inline-flex h-8 items-center rounded-md px-2.5 text-[0.8125rem] font-medium transition-colors";
  const linkInactiveClass = "text-text-soft hover:bg-foreground/[0.04] hover:text-foreground";
  const linkActiveClass = "bg-foreground/[0.04] text-foreground";

  const iconButtonClass =
    "inline-flex size-8 items-center justify-center rounded-md text-text-soft transition-colors hover:bg-foreground/[0.04] hover:text-foreground";

  const dropdownContentClass =
    "rounded-[18px] border border-line bg-surface-overlay p-1 shadow-none backdrop-blur-xl";
  const dropdownItemClass =
    "group/dropdown-menu-item relative flex items-start gap-3 rounded-lg px-3 py-2 text-[0.8125rem] font-medium text-foreground outline-none transition-colors hover:!bg-surface-muted focus:!bg-surface-muted data-[highlighted]:!bg-surface-muted";
  const dropdownItemIconClass =
    "inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.12] text-foreground";
  const dropdownItemTitleClass =
    "text-[0.8125rem] font-semibold text-foreground";
  const dropdownItemDescClass =
    "mt-1 text-[0.75rem] leading-[1.45] !text-text-soft";
  const dropdownSeparatorClass = "bg-border -mx-1 my-1.5 h-px";
  const menuSelectItemClass =
    "flex h-9 items-center justify-between rounded-lg px-2.5 text-[0.8125rem] font-medium text-text-soft outline-none transition-colors hover:!bg-surface-muted hover:text-foreground focus:!bg-surface-muted focus:text-foreground data-[highlighted]:!bg-surface-muted";

  return (
    <header className={cn("sticky top-0 z-50 w-full bg-background/[0.86] backdrop-blur-[16px]", scrolled && "border-b border-line/60")}>
      <div className="mx-auto flex h-[60px] max-w-[1320px] items-center justify-between gap-4 px-5 md:px-8 lg:px-20">
        <Link to={homePath} className="inline-flex items-center gap-2.5 text-[0.9375rem] font-semibold text-foreground">
          <img src="/icon.svg" alt="Downcity" className="brand-logo block h-6 w-6 shrink-0 object-contain" />
          <span>Downcity</span>
        </Link>

        <nav className="hidden items-center gap-0.5 lg:flex">
          <Link
            to={productPath}
            className={cn(linkBaseClass, isActive(productPath) ? linkActiveClass : linkInactiveClass)}
          >
            {t("nav.product")}
          </Link>
          <Link
            to={startPath}
            className={cn(linkBaseClass, isActive(startPath) ? linkActiveClass : linkInactiveClass)}
          >
            {isZh ? "快速开始" : "Quick Start"}
          </Link>
          <Link
            to={agentSdkDocsPath}
            className={cn(linkBaseClass, isActive(agentSdkDocsPath) ? linkActiveClass : linkInactiveClass)}
          >
            Agent SDK
          </Link>
          <Link
            to={citySdkDocsPath}
            className={cn(linkBaseClass, isActive(citySdkDocsPath) ? linkActiveClass : linkInactiveClass)}
          >
            City SDK
          </Link>
          <Link
            to={docsPath}
            className={cn(linkBaseClass, isActive(docsPath) ? linkActiveClass : linkInactiveClass)}
          >
            {t("nav.docs")}
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "group inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[0.8125rem] font-medium outline-none transition-colors",
                isAnyActive(moreGroup.activePaths) ? linkActiveClass : linkInactiveClass,
              )}
            >
              <span>{moreGroup.label}</span>
              <IconChevronDown className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              sideOffset={8}
              className={cn(dropdownContentClass, "w-[22rem]")}
            >
              <DropdownMenuGroup className="grid gap-1">
                {moreGroup.items.map((item) => {
                  const Icon = item.icon;
                  return "path" in item ? (
                    <DropdownMenuItem
                      key={item.path}
                      className={dropdownItemClass}
                      render={(itemProps: React.ComponentPropsWithoutRef<"a">) => (
                        <Link {...itemProps} to={item.path} className={cn("flex items-start gap-3", itemProps.className)}>
                          <span className={dropdownItemIconClass}>
                            <Icon className="size-4" strokeWidth={1.5} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className={dropdownItemTitleClass}>{item.label}</span>
                            </div>
                            <p className={dropdownItemDescClass}>{item.description}</p>
                          </div>
                        </Link>
                      )}
                    />
                  ) : (
                    <DropdownMenuItem
                      key={item.href}
                      className={dropdownItemClass}
                      render={(itemProps: React.ComponentPropsWithoutRef<"a">) => (
                        <a {...itemProps} href={item.href} target="_blank" rel="noreferrer" className={cn("flex items-start gap-3", itemProps.className)}>
                          <span className={dropdownItemIconClass}>
                            <Icon className="size-4" strokeWidth={1.5} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className={dropdownItemTitleClass}>{item.label}</span>
                              <IconArrowUpRight className="size-3.5 text-text-subtle" />
                            </div>
                            <p className={dropdownItemDescClass}>{item.description}</p>
                          </div>
                        </a>
                      )}
                    />
                  );
                })}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className={cn(linkBaseClass, linkInactiveClass, "gap-1.5")}
          >
            <IconBrandGithub className="size-4" />
            <span>GitHub</span>
          </a>
        </nav>

        <div className="hidden items-center gap-0.5 lg:flex">
          <a href={TWITTER_URL} target="_blank" rel="noreferrer" aria-label="X" title="X" className={iconButtonClass}>
            <IconBrandX className="size-4" />
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="GitHub" title="GitHub" className={iconButtonClass}>
            <IconBrandGithub className="size-4" />
          </a>
          <ThemeSwitcher is_zh={isZh} button_class={iconButtonClass} dropdown_content_class={dropdownContentClass} dropdown_item_class={menuSelectItemClass} />
          <LanguageSwitcher is_zh={isZh} button_class={iconButtonClass} dropdown_content_class={dropdownContentClass} dropdown_item_class={menuSelectItemClass} />
        </div>

        <div className="flex items-center justify-end lg:hidden">
          <MobileMenu
            is_zh={isZh}
            product_path={productPath}
            start_path={startPath}
            agent_sdk_docs_path={agentSdkDocsPath}
            city_sdk_docs_path={citySdkDocsPath}
            docs_path={docsPath}
            more_group={moreGroup}
            github_url={GITHUB_URL}
            icon_button_class={iconButtonClass}
            dropdown_content_class={dropdownContentClass}
            dropdown_item_class={dropdownItemClass}
            dropdown_separator_class={dropdownSeparatorClass}
            menu_select_item_class={menuSelectItemClass}
          />
        </div>
      </div>
    </header>
  );
}

function LanguageSwitcher({
  is_zh,
  button_class,
  dropdown_content_class,
  dropdown_item_class,
}: {
  is_zh: boolean;
  button_class: string;
  dropdown_content_class: string;
  dropdown_item_class: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={is_zh ? "切换语言" : "Switch language"} title={is_zh ? "切换语言" : "Switch language"} className={button_class}>
        <IconLanguage className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className={dropdown_content_class}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-3 py-2 text-[0.65rem] uppercase tracking-[0.12em] text-text-soft">
            {is_zh ? "语言" : "Language"}
          </DropdownMenuLabel>
          <DropdownMenuItem className={dropdown_item_class} onClick={() => setLang("en")}>
            <span>English</span>
            {!is_zh ? <IconCheck className="size-4 text-text-soft" /> : <span className="size-4" />}
          </DropdownMenuItem>
          <DropdownMenuItem className={dropdown_item_class} onClick={() => setLang("zh")}>
            <span>中文</span>
            {is_zh ? <IconCheck className="size-4 text-text-soft" /> : <span className="size-4" />}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const theme_options = [
  { value: "light", icon: IconSun, en_label: "Light", zh_label: "Light" },
  { value: "dark", icon: IconMoon, en_label: "Dark", zh_label: "Dark" },
  { value: "system", icon: IconDeviceDesktop, en_label: "System", zh_label: "System" },
] as const;

type ThemeMode = (typeof theme_options)[number]["value"];

function ThemeSwitcher({
  is_zh,
  button_class,
  dropdown_content_class,
  dropdown_item_class,
}: {
  is_zh: boolean;
  button_class: string;
  dropdown_content_class: string;
  dropdown_item_class: string;
}) {
  const { theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={is_zh ? "切换主题" : "Switch theme"} title={is_zh ? "切换主题" : "Switch theme"} className={button_class}>
        {mounted && resolvedTheme === "dark" ? (
          <IconMoon className="size-4" />
        ) : mounted && resolvedTheme === "light" ? (
          <IconSun className="size-4" />
        ) : (
          <IconSunMoon className="size-4" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className={dropdown_content_class}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-3 py-2 text-[0.65rem] uppercase tracking-[0.12em] text-text-soft">
            {is_zh ? "主题" : "Theme"}
          </DropdownMenuLabel>
          <ThemeMenuItems is_zh={is_zh} item_class={dropdown_item_class} />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeMenuItems({ is_zh, item_class }: { is_zh: boolean; item_class: string }) {
  const { setTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const current_theme = isThemeMode(theme) ? theme : "system";

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      {theme_options.map((option) => {
        const Icon = option.icon;
        const selected = mounted && current_theme === option.value;
        return (
          <DropdownMenuItem key={option.value} className={item_class} onClick={() => setTheme(option.value)}>
            <span className="flex items-center gap-2">
              <Icon className="size-4 text-text-soft" />
              <span>{is_zh ? option.zh_label : option.en_label}</span>
            </span>
            {selected ? <IconCheck className="size-4 text-text-soft" /> : <span className="size-4" />}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

function isThemeMode(value: string | undefined): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

function MobileMenu({
  is_zh,
  product_path,
  start_path,
  agent_sdk_docs_path,
  city_sdk_docs_path,
  docs_path,
  more_group,
  github_url,
  icon_button_class,
  dropdown_content_class,
  dropdown_item_class,
  dropdown_separator_class,
  menu_select_item_class,
}: {
  is_zh: boolean;
  product_path: string;
  start_path: string;
  agent_sdk_docs_path: string;
  city_sdk_docs_path: string;
  docs_path: string;
  more_group: NavGroup;
  github_url: string;
  icon_button_class: string;
  dropdown_content_class: string;
  dropdown_item_class: string;
  dropdown_separator_class: string;
  menu_select_item_class: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={is_zh ? "菜单" : "Menu"} title={is_zh ? "菜单" : "Menu"} className={icon_button_class}>
        <IconMenu2 className="size-[1.125rem]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={dropdown_content_class}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-3 pb-1 pt-2 text-[0.65rem] uppercase tracking-[0.1em] text-text-soft">
            {is_zh ? "核心入口" : "Core"}
          </DropdownMenuLabel>
          {[
            { label: is_zh ? "产品" : "Product", path: product_path },
            { label: is_zh ? "快速开始" : "Quick Start", path: start_path },
            { label: "Agent SDK", path: agent_sdk_docs_path },
            { label: "City SDK", path: city_sdk_docs_path },
            { label: is_zh ? "文档" : "Docs", path: docs_path },
          ].map((item) => (
            <DropdownMenuItem
              key={item.path}
              className={dropdown_item_class}
              render={(itemProps: React.ComponentPropsWithoutRef<"a">) => (
                <Link {...itemProps} to={item.path}>{item.label}</Link>
              )}
            />
          ))}
          <DropdownMenuItem
            className={dropdown_item_class}
            render={(itemProps: React.ComponentPropsWithoutRef<"a">) => (
              <a {...itemProps} href={github_url} target="_blank" rel="noreferrer">GitHub</a>
            )}
          />
        </DropdownMenuGroup>
        <DropdownMenuSeparator className={dropdown_separator_class} />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-3 pb-1 pt-2 text-[0.65rem] uppercase tracking-[0.1em] text-text-soft">
            {more_group.label}
          </DropdownMenuLabel>
          {more_group.items.map((item) =>
            "path" in item ? (
              <DropdownMenuItem
                key={item.path}
                className={dropdown_item_class}
                render={(itemProps: React.ComponentPropsWithoutRef<"a">) => (
                  <Link {...itemProps} to={item.path}>{item.label}</Link>
                )}
              />
            ) : (
              <DropdownMenuItem
                key={item.href}
                className={dropdown_item_class}
                render={(itemProps: React.ComponentPropsWithoutRef<"a">) => (
                  <a {...itemProps} href={item.href} target="_blank" rel="noreferrer" className={cn("flex items-center justify-between gap-2", itemProps.className)}>
                    <span>{item.label}</span>
                    <IconArrowUpRight className="size-3 text-text-subtle" />
                  </a>
                )}
              />
            )
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator className={dropdown_separator_class} />
        <DropdownMenuItem className={dropdown_item_class} onClick={() => setLang(is_zh ? "en" : "zh")}>
          {is_zh ? "Switch to English" : "切换到中文"}
        </DropdownMenuItem>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-3 pb-1 pt-2 text-[0.65rem] uppercase tracking-[0.1em] text-text-soft">
            {is_zh ? "主题" : "Theme"}
          </DropdownMenuLabel>
          <ThemeMenuItems is_zh={is_zh} item_class={menu_select_item_class} />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
