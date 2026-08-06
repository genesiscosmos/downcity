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
import { RootProvider } from "fumadocs-ui/provider/react-router";
import { I18nextProvider } from "react-i18next";
import { defineI18nUI } from "fumadocs-ui/i18n";
import { useEffect } from "react";

import type { Route } from "./+types/root";
import stylesheet from "./app.css?url";
import { Toaster } from "@/components/ui/sonner";
import { Navbar } from "@/components/sections/navbar";
import { InterfaceLocaleProvider } from "@/components/providers/InterfaceLocaleProvider";
import { homepage_positioning } from "@/lib/homepage-positioning";
import i18next from "@/lib/locales"; // naming conflict with fumadocs i18n
import { i18n } from "@/lib/i18n";
import {
  get_path_interface_locale,
  interface_locale_bootstrap_script,
  persist_interface_locale,
  should_persist_interface_locale,
} from "@/lib/interface-locale";
import { create_page_meta, get_path_locale } from "@/lib/seo";

const favicon_version = "20260804";

const { provider } = defineI18nUI(i18n, {
  translations: {
    en: {
      search: "Search",
      toc: "Table of Contents",
      lastUpdate: "Last updated on",
      chooseLanguage: "Choose a language",
      nextPage: "Next",
      previousPage: "Previous",
    },
    zh: {
      search: "搜索文档",
      toc: "目录",
      lastUpdate: "最后更新于",
      chooseLanguage: "选择语言",
      nextPage: "下一页",
      previousPage: "上一页",
    },
  },
});

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
    keywords:
      "agent harness, agent productization, agent product kits, AI agents, agent runtime, developer tools",
  });
};

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const path = location.pathname;
  const locale = get_path_interface_locale(path);

  // 文档页使用 fumadocs 自身导航，不展示站点全局 Header。
  const isDocsPath =
    path === "/docs" ||
    path === "/city-sdk-docs" ||
    path === "/agent-sdk-docs" ||
    path === "/payments" ||
    path === "/plugins-docs" ||
    path === "/ui-sdk-docs" ||
    path.startsWith("/docs/") ||
    path.startsWith("/city-sdk-docs/") ||
    path.startsWith("/agent-sdk-docs/") ||
    path.startsWith("/payments/") ||
    path.startsWith("/plugins-docs/") ||
    path.startsWith("/ui-sdk-docs/") ||
    path.startsWith("/en/docs") ||
    path.startsWith("/zh/docs") ||
    path.startsWith("/en/city-sdk-docs") ||
    path.startsWith("/zh/city-sdk-docs") ||
    path.startsWith("/en/agent-sdk-docs") ||
    path.startsWith("/zh/agent-sdk-docs") ||
    path.startsWith("/en/payments") ||
    path.startsWith("/zh/payments") ||
    path.startsWith("/en/plugins-docs") ||
    path.startsWith("/zh/plugins-docs") ||
    path.startsWith("/en/ui-sdk-docs") ||
    path.startsWith("/zh/ui-sdk-docs");
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
            <RootProvider i18n={provider(locale)}>
              <div className="relative flex min-h-screen flex-col">
                <Toaster theme="system" richColors position="top-center" />
                {showGlobalChrome ? <Navbar /> : null}
                <div className="relative flex-1">{children}</div>
              </div>
            </RootProvider>
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
