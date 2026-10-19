/** Presentation 图片适配：允许的资源协议、宿主路径解析及图片失败回退。 */
import { createContext, createElement, useContext, useState, type ComponentType } from "react";
import type { DefinedComponent } from "@openuidev/lang-core";
import type { PresentationMediaProps } from "../types/Media.js";

/** 宿主只负责地址映射，真实本地文件权限仍由文件协议处理器检查。 */
export const PresentationResourceContext = createContext<((source: string) => string | null) | undefined>(undefined);
const media_components = new Set(["Image", "ImageBlock", "ImageGallery", "ImageText", "ImageTextLarge", "VisualCardItem", "VisualCardBlock", "ContextCardItem", "ContextCardBlock", "ListItem", "ListBlock", "IconText", "SnippetCardItem", "SnippetCardBlock", "OverviewCardItem", "OverviewCardBlock", "CompositeCardItem", "CompositeCardBlock", "OptionCard", "OptionCards"]);

/** 只允许 Web 图片、内联位图和宿主支持的本地资源，禁止任意脚本协议。 */
export function resolve_presentation_resource(source: string, resolver?: (source: string) => string | null): string {
  const value = source.trim();
  if (!value || value.startsWith("//")) return "";
  if (/^https?:\/\//i.test(value) || /^data:image\/(png|jpeg|gif|webp|avif);base64,/i.test(value)) return value;
  if (/^(\/|file:|downcity-file:)/i.test(value) || !/^[a-z][a-z\d+.-]*:/i.test(value)) {
    const resolved = resolver?.(value);
    return resolved && /^(https?:\/\/|downcity-file:\/\/)/i.test(resolved) ? resolved : "";
  }
  return "";
}

/** 仅映射图片属性；不改写其他字段或改变 OpenUI 子节点结构。 */
function map_sources(value: unknown, resolver: ((source: string) => string | null) | undefined): unknown {
  if (Array.isArray(value)) return value.map((item) => map_sources(item, resolver));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    ["src", "bgImageSrc"].includes(key) && typeof child === "string"
      ? resolve_presentation_resource(child, resolver) : map_sources(child, resolver),
  ]));
}

/** 保留上游 Schema，稳定包装图片消费组件；错误隔离在该内容块。 */
export function adapt_presentation_media<T extends DefinedComponent>(definition: T): T {
  if (!media_components.has(definition.name)) return definition;
  const Original = definition.component as ComponentType<PresentationMediaProps>;
  function PresentationMedia(props: PresentationMediaProps) {
    const resolver = useContext(PresentationResourceContext);
    const [failed, set_failed] = useState(false);
    return createElement("div", { className: "downcity-presentation-media", onErrorCapture: () => set_failed(true) },
      createElement(Original, { ...props, props: map_sources(props.props, resolver) as Record<string, unknown> }),
      failed ? createElement("p", { role: "status", className: "downcity-presentation-media-error" }, "部分图片无法加载，文字内容仍可查看。") : null,
    );
  }
  return { ...definition, component: PresentationMedia };
}
