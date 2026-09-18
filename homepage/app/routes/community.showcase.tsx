import * as React from "react";
import { useLoaderData } from "react-router";
import { use_interface_locale } from "@/components/providers/InterfaceLocaleProvider";
import { IconArrowUpRight, IconBox } from "@tabler/icons-react";
import { product } from "@/lib/product";
import { fetch_webcap_metadata, type WebCapMetadata } from "@/lib/webcap";
import { create_page_meta, get_path_locale } from "@/lib/seo";
import type { Route } from "./+types/community.showcase";

export function meta({ location }: Route.MetaArgs) {
  const is_chinese = get_path_locale(location.pathname) === "zh";
  const title = `${product.productName} — ${is_chinese ? "案例" : "Showcase"}`;
  const description = is_chinese
    ? "查看使用 Downcity 构建的真实产品与 Agent 体验。"
    : "Products and experiences built with Downcity";
  return create_page_meta({
    title,
    description,
    pathname: location.pathname,
    localized: true,
  });
}

/**
 * Showcase 页面数据加载器。
 *
 * 关键说明（中文）
 * - 通过 WebCap 实时解析 Vibecape 官网的公开元数据（title、description、logo）。
 * - 解析失败时回退到本地默认数据，避免页面报错。
 */
export async function loader(): Promise<WebCapMetadata> {
  const fallback: WebCapMetadata = {
    url: "https://vibecape.com",
    title: "Vibecape",
    description: "SaaS Builder AI CLI. Build complete SaaS apps with a single command, integrating auth, payments, database, and more.",
    image: null,
    favicon: null,
  };

  try {
    const metadata = await fetch_webcap_metadata("https://vibecape.com");
    return {
      ...fallback,
      ...metadata,
      description: metadata.description || fallback.description,
      title: metadata.title || fallback.title,
    };
  } catch {
    return fallback;
  }
}

/**
 * 社区 Showcase 页面。
 *
 * 关键说明（中文）
 * - 展示使用 Downcity 构建的真实产品与案例。
 * - Vibecape 的标题、描述、图标通过 WebCap 实时解析官网获得。
 */
export default function Showcase() {
  // 语言必须来自 URL：i18next 单例在服务端固定为 en，用 i18n.language 会把 /zh/ 预渲染成英文正文。
  const locale = use_interface_locale();
  const metadata = useLoaderData<typeof loader>();
  const is_zh = locale === "zh";
  const [image_error, set_image_error] = React.useState(false);
  const [favicon_error, set_favicon_error] = React.useState(false);

  return (
    <div className="mx-auto max-w-[1320px] px-5 py-16 md:px-8 md:py-24 lg:px-20">
      <header className="max-w-2xl space-y-4">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.12em] text-text-soft">
          {is_zh ? "案例" : "Showcase"}
        </span>
        <h1 className="font-serif text-[clamp(1.875rem,4vw,2.25rem)] font-bold leading-[1.12] tracking-[-0.02em] text-foreground">
          {is_zh ? "使用 Downcity 构建的产品" : "Products built with Downcity"}
        </h1>
        <p className="text-base leading-[1.65] text-text-soft">
          {is_zh
            ? "看看社区和团队如何使用 Downcity runtime 构建真实 AI 产品。"
            : "See how the community and teams use the Downcity runtime to ship real AI products."}
        </p>
      </header>

      <section className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <a
          href={metadata.url}
          target="_blank"
          rel="noreferrer"
          className="group relative overflow-hidden rounded-[14px] border border-line bg-card transition-colors hover:bg-surface-muted"
        >
          {metadata.image && !image_error ? (
            <img
              src={metadata.image}
              alt=""
              className="h-40 w-full object-cover"
              onError={() => set_image_error(true)}
            />
          ) : (
            <span className="flex h-40 w-full items-center justify-center bg-surface-muted text-foreground">
              {metadata.favicon && !favicon_error ? (
                <img
                  src={metadata.favicon}
                  alt=""
                  className="size-10 object-contain"
                  onError={() => set_favicon_error(true)}
                />
              ) : (
                <IconBox className="size-10" strokeWidth={1.5} />
              )}
            </span>
          )}
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold text-foreground">{metadata.title}</h2>
              <IconArrowUpRight className="size-4 shrink-0 text-text-subtle transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-text-soft">{metadata.description}</p>
          </div>
        </a>
      </section>
    </div>
  );
}
