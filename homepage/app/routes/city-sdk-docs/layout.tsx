/**
 * City SDK 文档布局路由模块。
 * 说明：
 * 1. `city-sdk-docs` 与 `docs`、`agent-sdk-docs`、`payments` 平级存在，单独承载City SDK 文档。
 * 2. 这里仅负责语言切换与 Fumadocs 布局装配，不承载业务逻辑。
 */
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { citySdkDocsSource } from "@/lib/city-sdk-docs-source";
import { Outlet, useLocation } from "react-router";
import type { Route } from "./+types/layout";
import type { Root as PageTreeRoot } from "fumadocs-core/page-tree";
import { i18n } from "@/lib/i18n";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const lang =
    url.pathname.startsWith("/zh/") || url.pathname === "/zh" ? "zh" : "en";

  return {
    tree: citySdkDocsSource.pageTree[lang],
    lang,
  };
}

export default function Layout({ loaderData }: Route.ComponentProps) {
  const location = useLocation();
  const { lang } = loaderData;

  return (
    <DocsLayout
      key={`${lang}:${location.pathname}`}
      tree={loaderData.tree as PageTreeRoot}
      nav={{
        title: (
          <div className="flex h-10 w-10 items-center justify-center">
            <img
              src="/icon-512.png"
              width={32}
              height={32}
              alt="Downcity"
              className="brand-logo h-8 w-8 object-contain"
            />
          </div>
        ),
      }}
      sidebar={{
        defaultOpenLevel: 0,
      }}
      i18n={i18n}
    >
      <Outlet />
    </DocsLayout>
  );
}
