"use client";

import * as React from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useTheme } from "fumadocs-ui/provider/base";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { use_auto_hide_header } from "@/hooks/use-auto-hide-header";
import { create_interface_locale_path, persist_interface_locale } from "@/lib/interface-locale";
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
 * 2. 桌面端使用 Product / Docs / Community 三个分类下拉，并保留 Features 与 GitHub 直达。
 * 3. Docs 内继续按 Overview、City、Agent 与 UI 分组，维持清晰的信息架构。
 * 4. 移动端按照相同分类合并到一个菜单中。
 */

type NavLinkItem =
  | { label: string; description: string; path: string; icon: typeof IconBook }
  | { label: string; description: string; href: string; external: true; icon: typeof IconBook };

type NavGroup = {
  label: string;
  activePaths: readonly string[];
  items: readonly NavLinkItem[];
};

const GITHUB_URL = "https://github.com/genesiscosmos/downcity";
const TWITTER_URL = "https://x.com/downcity_ai";

export function Navbar() {
  const { i18n } = useTranslation("common");
  const location = useLocation();
  const navigate = useNavigate();
  const locale = use_interface_locale();
  const t = i18n.getFixedT(locale, "common");
  const isZh = locale === "zh";

  const change_language = (next_locale: "en" | "zh") => {
    persist_interface_locale(next_locale);
    const next_path = create_interface_locale_path(location.pathname, next_locale);

    if (next_path !== location.pathname) {
      navigate({ pathname: next_path, search: location.search, hash: location.hash });
    }
  };

  const { header_visible, scrolled } = use_auto_hide_header();

  const homePath = isZh ? "/zh" : "/";
  const productPath = isZh ? "/zh/product" : "/product";
  const productSdkPath = isZh ? "/zh/product/sdk" : "/product/sdk";
  const productAgentSdkPath = isZh ? "/zh/product/agent-sdk" : "/product/agent-sdk";
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

  const productGroup: NavGroup = {
    label: t("nav.product"),
    activePaths: [productPath, startPath, productSdkPath, productAgentSdkPath, productUiSdkPath, pluginsDocsPath, paymentsPath],
    items: [
      { label: t("nav.productOverview"), description: isZh ? "完整产品矩阵" : "Full product index", path: productPath, icon: IconLayoutDashboard },
      { label: "CLI", description: isZh ? "命令行工具" : "Command-line interface", path: startPath, icon: IconTerminal },
      { label: "City SDK", description: isZh ? "城市运行时 SDK" : "City runtime SDK", path: productSdkPath, icon: IconServer },
      { label: "Agent SDK", description: isZh ? "Agent 嵌入 SDK" : "Agent embedding SDK", path: productAgentSdkPath, icon: IconRobot },
      { label: "UI SDK", description: isZh ? "UI 组件 SDK" : "UI component SDK", path: productUiSdkPath, icon: IconLayoutDashboard },
      { label: "Plugins", description: isZh ? "插件系统" : "Plugin system", path: pluginsDocsPath, icon: IconPuzzle },
      { label: "Services", description: isZh ? "服务与支付基础设施" : "Services & payment infrastructure", path: paymentsPath, icon: IconServer },
    ],
  };

  const docsGroup: NavGroup = {
    label: t("nav.docs"),
    activePaths: [docsPath, cliDocsPath, citySdkDocsPath, agentSdkDocsPath, pluginsDocsPath, uiSdkDocsPath, paymentsPath],
    items: [
      { label: "Overview", description: isZh ? "核心文档" : "Core docs", path: docsPath, icon: IconBook },
      { label: "CLI Docs", description: isZh ? "CLI 文档" : "CLI docs", path: cliDocsPath, icon: IconTerminal },
      { label: "City SDK", description: isZh ? "City SDK 文档" : "City SDK docs", path: citySdkDocsPath, icon: IconServer },
      { label: "Agent SDK", description: isZh ? "Agent SDK 文档" : "Agent SDK docs", path: agentSdkDocsPath, icon: IconRobot },
      { label: "Plugins", description: isZh ? "Plugins 文档" : "Plugins docs", path: pluginsDocsPath, icon: IconPuzzle },
      { label: "UI SDK", description: isZh ? "UI SDK 文档" : "UI SDK docs", path: uiSdkDocsPath, icon: IconLayoutDashboard },
      { label: "Services Docs", description: isZh ? "Services 文档" : "Services docs", path: paymentsPath, icon: IconLayoutDashboard },
    ],
  };

  const communityGroup: NavGroup = {
    label: t("nav.community"),
    activePaths: [communityPath, faqPath, roadmapPath, showcasePath],
    items: [
      { label: t("nav.faq"), description: isZh ? "常见问题" : "Frequently asked questions", path: faqPath, icon: IconBook },
      { label: t("nav.roadmap"), description: isZh ? "产品路线图" : "Product roadmap", path: roadmapPath, icon: IconBook },
      { label: isZh ? "案例" : "Showcase", description: isZh ? "使用 Downcity 构建的产品" : "Products built with Downcity", path: showcasePath, icon: IconBox },
      { label: "GitHub", description: isZh ? "源码与 Issues" : "Source & issues", href: GITHUB_URL, external: true, icon: IconBrandGithub },
      { label: "X", description: isZh ? "官方账号" : "Official account", href: TWITTER_URL, external: true, icon: IconBrandX },
    ],
  };

  const groups = [productGroup, docsGroup, communityGroup] as const;

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
    <header
      className={cn(
        "sticky top-0 z-50 w-full bg-background/[0.86] backdrop-blur-[16px] transition-transform focus-within:translate-y-0 motion-reduce:transition-none",
        header_visible
          ? "translate-y-0 duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
          : "-translate-y-full duration-150 ease-[cubic-bezier(0.55,0,1,0.45)]",
        scrolled && "border-b border-line/60",
      )}
    >
      <div className="mx-auto flex h-[60px] max-w-[1320px] items-center justify-between gap-4 px-5 md:px-8 lg:px-20">
        <Link to={homePath} className="inline-flex items-center gap-2.5 text-[0.9375rem] font-semibold text-foreground">
          <img src="/icon-512.png" alt="Downcity" className="brand-logo block h-7 w-7 shrink-0 object-contain" />
          <span>Downcity</span>
        </Link>

        <nav className="hidden items-center gap-0.5 lg:flex">
          {groups.map((group) => {
            const active = isAnyActive(group.activePaths);
            return (
              <React.Fragment key={group.label}>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className={cn(
                      "group inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[0.8125rem] font-medium outline-none transition-colors",
                      active ? linkActiveClass : linkInactiveClass,
                    )}
                  >
                    <span>{group.label}</span>
                    <IconChevronDown className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    sideOffset={8}
                    className={cn(dropdownContentClass, group.items.length > 4 ? "w-[22rem]" : "w-[18rem]")}
                  >
                    {group === docsGroup ? (
                      <DocsDropdownGroups
                        is_zh={isZh}
                        docs_path={docsPath}
                        cli_docs_path={cliDocsPath}
                        city_sdk_docs_path={citySdkDocsPath}
                        services_path={paymentsPath}
                        agent_sdk_docs_path={agentSdkDocsPath}
                        plugins_docs_path={pluginsDocsPath}
                        ui_sdk_docs_path={uiSdkDocsPath}
                        dropdown_item_class={dropdownItemClass}
                        dropdown_item_icon_class={dropdownItemIconClass}
                        dropdown_item_title_class={dropdownItemTitleClass}
                        dropdown_item_desc_class={dropdownItemDescClass}
                        dropdown_separator_class={dropdownSeparatorClass}
                      />
                    ) : (
                      <DropdownMenuGroup className="grid gap-1">
                        {group.items.map((item) => {
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
                                    <span className={dropdownItemTitleClass}>{item.label}</span>
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
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                {group === productGroup ? (
                  <Link
                    to={featuresPath}
                    className={cn(linkBaseClass, isActive(featuresPath) ? linkActiveClass : linkInactiveClass)}
                  >
                    {t("nav.features")}
                  </Link>
                ) : null}
              </React.Fragment>
            );
          })}

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
          <LanguageSwitcher is_zh={isZh} button_class={iconButtonClass} dropdown_content_class={dropdownContentClass} dropdown_item_class={menuSelectItemClass} on_language_change={change_language} />
        </div>

        <div className="flex items-center justify-end lg:hidden">
          <MobileMenu
            is_zh={isZh}
            groups={groups}
            features_path={featuresPath}
            github_url={GITHUB_URL}
            twitter_url={TWITTER_URL}
            icon_button_class={iconButtonClass}
            dropdown_content_class={dropdownContentClass}
            dropdown_item_class={dropdownItemClass}
            dropdown_separator_class={dropdownSeparatorClass}
            menu_select_item_class={menuSelectItemClass}
            on_language_change={change_language}
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
  on_language_change,
}: {
  is_zh: boolean;
  button_class: string;
  dropdown_content_class: string;
  dropdown_item_class: string;
  /** 用户选择目标语言时同步更新翻译状态与公开页面路径。 */
  on_language_change: (locale: "en" | "zh") => void;
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
          <DropdownMenuItem className={dropdown_item_class} onClick={() => on_language_change("en")}>
            <span>English</span>
            {!is_zh ? <IconCheck className="size-4 text-text-soft" /> : <span className="size-4" />}
          </DropdownMenuItem>
          <DropdownMenuItem className={dropdown_item_class} onClick={() => on_language_change("zh")}>
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

/**
 * 文档导航按 Overview、City、Agent 与 UI 四组展示，保留原有信息架构。
 */
function DocsDropdownGroups({
  is_zh,
  docs_path,
  cli_docs_path,
  city_sdk_docs_path,
  services_path,
  agent_sdk_docs_path,
  plugins_docs_path,
  ui_sdk_docs_path,
  dropdown_item_class,
  dropdown_item_icon_class,
  dropdown_item_title_class,
  dropdown_item_desc_class,
  dropdown_separator_class,
}: {
  is_zh: boolean;
  docs_path: string;
  cli_docs_path: string;
  city_sdk_docs_path: string;
  services_path: string;
  agent_sdk_docs_path: string;
  plugins_docs_path: string;
  ui_sdk_docs_path: string;
  dropdown_item_class: string;
  dropdown_item_icon_class: string;
  dropdown_item_title_class: string;
  dropdown_item_desc_class: string;
  dropdown_separator_class: string;
}) {
  type DocsItem = { label: string; description: string; path: string; icon: typeof IconBook };

  const overview_group: readonly DocsItem[] = [
    { label: "Overview", description: is_zh ? "核心文档" : "Core docs", path: docs_path, icon: IconBook },
    { label: "CLI Docs", description: is_zh ? "CLI 文档" : "CLI docs", path: cli_docs_path, icon: IconTerminal },
  ];
  const city_group: readonly DocsItem[] = [
    { label: "City SDK", description: is_zh ? "City SDK 文档" : "City SDK docs", path: city_sdk_docs_path, icon: IconServer },
    { label: "Services Docs", description: is_zh ? "Services 文档" : "Services docs", path: services_path, icon: IconLayoutDashboard },
  ];
  const agent_group: readonly DocsItem[] = [
    { label: "Agent SDK", description: is_zh ? "Agent SDK 文档" : "Agent SDK docs", path: agent_sdk_docs_path, icon: IconRobot },
    { label: "Plugins", description: is_zh ? "Plugins 文档" : "Plugins docs", path: plugins_docs_path, icon: IconPuzzle },
  ];
  const ui_group: readonly DocsItem[] = [
    { label: "UI SDK", description: is_zh ? "UI SDK 文档" : "UI SDK docs", path: ui_sdk_docs_path, icon: IconLayoutDashboard },
  ];

  const sections = [overview_group, city_group, agent_group, ui_group] as const;

  return (
    <>
      {sections.map((section, index) => (
        <React.Fragment key={section[0].label}>
          <DropdownMenuGroup className="grid gap-1">
            {section.map((item) => {
              const Icon = item.icon;
              return (
                <DropdownMenuItem
                  key={item.path}
                  className={dropdown_item_class}
                  render={(itemProps: React.ComponentPropsWithoutRef<"a">) => (
                    <Link {...itemProps} to={item.path} className={cn("flex items-start gap-3", itemProps.className)}>
                      <span className={dropdown_item_icon_class}>
                        <Icon className="size-4" strokeWidth={1.5} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className={dropdown_item_title_class}>{item.label}</span>
                        <p className={dropdown_item_desc_class}>{item.description}</p>
                      </div>
                    </Link>
                  )}
                />
              );
            })}
          </DropdownMenuGroup>
          {index < sections.length - 1 ? <DropdownMenuSeparator className={dropdown_separator_class} /> : null}
        </React.Fragment>
      ))}
    </>
  );
}

function MobileMenu({
  is_zh,
  groups,
  features_path,
  github_url,
  twitter_url,
  icon_button_class,
  dropdown_content_class,
  dropdown_item_class,
  dropdown_separator_class,
  menu_select_item_class,
  on_language_change,
}: {
  is_zh: boolean;
  groups: readonly NavGroup[];
  features_path: string;
  github_url: string;
  twitter_url: string;
  icon_button_class: string;
  dropdown_content_class: string;
  dropdown_item_class: string;
  dropdown_separator_class: string;
  menu_select_item_class: string;
  /** 用户选择目标语言时同步更新翻译状态与公开页面路径。 */
  on_language_change: (locale: "en" | "zh") => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={is_zh ? "菜单" : "Menu"} title={is_zh ? "菜单" : "Menu"} className={icon_button_class}>
        <IconMenu2 className="size-[1.125rem]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={dropdown_content_class}>
        {groups.map((group) => (
          <DropdownMenuGroup key={group.label}>
            <DropdownMenuLabel className="px-3 pb-1 pt-2 text-[0.65rem] uppercase tracking-[0.1em] text-text-soft">
              {group.label}
            </DropdownMenuLabel>
            {group.items.map((item) =>
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
            <DropdownMenuSeparator className={dropdown_separator_class} />
          </DropdownMenuGroup>
        ))}
        <DropdownMenuItem
          className={dropdown_item_class}
          render={(itemProps: React.ComponentPropsWithoutRef<"a">) => (
            <Link {...itemProps} to={features_path}>{is_zh ? "功能" : "Features"}</Link>
          )}
        />
        <DropdownMenuSeparator className={dropdown_separator_class} />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-3 pb-1 pt-2 text-[0.65rem] uppercase tracking-[0.1em] text-text-soft">
            {is_zh ? "链接" : "Links"}
          </DropdownMenuLabel>
          <DropdownMenuItem
            className={dropdown_item_class}
            render={(itemProps: React.ComponentPropsWithoutRef<"a">) => (
              <a {...itemProps} href={github_url} target="_blank" rel="noreferrer">GitHub</a>
            )}
          />
          <DropdownMenuItem
            className={dropdown_item_class}
            render={(itemProps: React.ComponentPropsWithoutRef<"a">) => (
              <a {...itemProps} href={twitter_url} target="_blank" rel="noreferrer">X</a>
            )}
          />
        </DropdownMenuGroup>
        <DropdownMenuSeparator className={dropdown_separator_class} />
        <DropdownMenuItem className={dropdown_item_class} onClick={() => on_language_change(is_zh ? "en" : "zh")}>
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
