import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import { I18nextProvider } from "react-i18next";
import { useEffect } from "react";

import type { Route } from "./+types/root";
import stylesheet from "./app.css?url";
import { Toaster } from "@/components/ui/sonner";
import { Navbar } from "@/components/sections/navbar";
import { InterfaceLocaleProvider } from "@/components/providers/InterfaceLocaleProvider";
import {
  SiteThemeProvider,
  site_theme_bootstrap_script,
} from "@/components/docs/theme-provider";
import { homepage_positioning } from "@/lib/homepage-positioning";
import { docs_spaces } from "@/lib/docs/spaces";
import i18next from "@/lib/locales";
import {
  get_path_interface_locale,
  interface_locale_bootstrap_script,
  persist_interface_locale,
  should_persist_interface_locale,
} from "@/lib/interface-locale";
import { create_page_meta, get_path_locale } from "@/lib/seo";

const favicon_version = "20260804";

export const links: Route.LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
  // favicon 使用固定品牌资源，避免浏览器缓存旧版图标。
  {
    rel: "icon",
    href: `/icon-512.png?v=${favicon_version}`,
    type: "image/png",
    sizes: "512x512",
  },
  { rel: "icon", href: `/favicon-32x32.png?v=${favicon_version}`, type: "image/png", sizes: "32x32" },
  { rel: "icon", href: `/favicon-16x16.png?v=${favicon_version}`, type: "image/png", sizes: "16x16" },
  { rel: "shortcut icon", href: `/favicon.ico?v=${favicon_version}`, type: "image/x-icon" },
  { rel: "apple-touch-icon", href: "/icon-192.png", sizes: "180x180" },
  { rel: "manifest", href: "/site.webmanifest" },
  // RSS feed 自动发现：聚合器与部分 AI 抓取器靠这个 link 找到 feed。
  {
    rel: "alternate",
    type: "application/rss+xml",
    title: "Downcity Blog",
    href: "/feed.xml",
  },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap",
  },
];

export const meta: Route.MetaFunction = ({ location }) => {
  const positioning = homepage_positioning[get_path_locale(location.pathname)];

  return create_page_meta({
    title: positioning.meta_title,
    description: positioning.meta_description,
    pathname: location.pathname,
    // 路由未自定义 meta 时的兑底也要声明双语对，避免 zh 兑底页面丢失 hreflang。
    localized: true,
    keywords:
      "agent harness, agent productization, agent product kits, AI agents, agent runtime, developer tools",
  });
};

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const path = location.pathname;
  const locale = get_path_interface_locale(path);

  // 文档页自带完整外壳（头部、侧边栏、目录），不再叠加营销站导航。
  const isDocsPath = docs_spaces.some(
    (space) =>
      path === `/${space.id}` ||
      path.startsWith(`/${space.id}/`) ||
      path.startsWith(`/en/${space.id}`) ||
      path.startsWith(`/zh/${space.id}`),
  );
  const showGlobalChrome = !isDocsPath;

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    // favicon 保持固定品牌资源，不再跟随主题切换。
    const update_favicon = () => {
      const favicon_href = `/favicon-32x32.png?v=${favicon_version}`;
      let theme_favicon = document.querySelector<HTMLLinkElement>(
        'link[data-theme-favicon="true"]',
      );

      if (!theme_favicon) {
        theme_favicon = document.createElement("link");
        theme_favicon.rel = "icon";
        theme_favicon.type = "image/png";
        theme_favicon.sizes = "32x32";
        theme_favicon.dataset.themeFavicon = "true";
        document.head.appendChild(theme_favicon);
      }

      theme_favicon.href = favicon_href;
    };

    update_favicon();

    const observer = new MutationObserver(update_favicon);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  // URL 是当前语言的唯一事实源；i18next 与持久化偏好都只跟随 URL 更新。
  useEffect(() => {
    if (i18next.language !== locale) {
      void i18next.changeLanguage(locale);
    }

    if (should_persist_interface_locale(path)) {
      persist_interface_locale(locale);
    }
    document.documentElement.lang = locale;
  }, [locale, path]);

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <Meta />
        <Links />
        <script dangerouslySetInnerHTML={{ __html: interface_locale_bootstrap_script }} />
        {/* 主题必须在 React 渲染前确定，否则深色用户会先看到一帧浅色页面。 */}
        <script dangerouslySetInnerHTML={{ __html: site_theme_bootstrap_script }} />
        <script
          defer
          src="https://vibeloft.ai/telemetry/v1.js"
          data-vl-product-id="5fe9ff34-c0c0-44b7-a3b8-e62deea5030f"
          data-vl-auth-key="vl_web.6twI2Y29EoJ7Dq2pw6jK0XrN3wdh_-W0eyJYwcQgTyQ"
        />
      </head>
      <body className="flex min-h-screen flex-col antialiased">
        <InterfaceLocaleProvider locale={locale}>
          <I18nextProvider i18n={i18next}>
            <SiteThemeProvider>
              <div className="relative flex min-h-screen flex-col">
                <Toaster theme="system" richColors position="top-center" />
                {showGlobalChrome ? <Navbar /> : null}
                <div className="relative flex-1">{children}</div>
              </div>
            </SiteThemeProvider>
          </I18nextProvider>
        </InterfaceLocaleProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = i18next.t("errors.oops");
  let details = i18next.t("errors.unexpected");
  let stack: string | undefined;
  const homePath = i18next.language === "zh" ? "/zh" : "/";
  const heading =
    isRouteErrorResponse(error) && error.status === 404
      ? i18next.t("errors.pageNotFound")
      : i18next.t("errors.error");

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : i18next.t("errors.error");
    details =
      error.status === 404
        ? i18next.t("errors.notFoundDetails")
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <div
        aria-hidden
        className="marketing-backdrop-glow pointer-events-none absolute inset-0 -z-20"
      />
      <div
        aria-hidden
        className="marketing-backdrop-grid pointer-events-none absolute inset-0 -z-10"
      />
      <main className="flex flex-1 flex-col items-center justify-center p-4 text-center">
        <div className="mx-auto max-w-md space-y-6">
          <h1 className="select-none font-mono text-9xl tracking-[-0.08em] text-foreground/88">
            {message}
          </h1>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-[-0.04em]">
              {heading}
            </h2>
            <p className="text-muted-foreground text-lg">{details}</p>
          </div>
          <div className="pt-4">
            <Link
              to={homePath}
              className="inline-flex min-h-11 items-center gap-2 rounded-[0.38rem] border border-primary bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:opacity-88"
            >
              {i18next.t("errors.backToHome")}
            </Link>
          </div>
        </div>

        {stack && (
          <div className="mx-auto mt-12 w-full max-w-4xl overflow-x-auto rounded-[0.48rem] border border-border/80 bg-surface/78 p-4 text-left">
            <pre className="text-xs font-mono text-muted-foreground">
              {stack}
            </pre>
          </div>
        )}
      </main>
    </div>
  );
}
