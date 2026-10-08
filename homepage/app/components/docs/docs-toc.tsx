/**
 * 文档右侧目录模块。
 *
 * 目录项来自 MDX 编译期生成的标题树。滚动时高亮当前可见标题，点击跳转到对应锚点。
 *
 * 为什么用 IntersectionObserver 而不是滚动位置计算：标题高度不固定（含代码块与表格
 * 的章节差异很大），按固定偏移量推算会在长章节里失准。观察器直接以「哪个标题已经
 * 进入视口上方」为准，长章节滚动过程也不会丢失高亮。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { DocsTocItem } from "@/lib/docs/types";

/** 提取标题的纯文本，用于计算锚点 id。 */
function toc_item_label(item: DocsTocItem): string {
  const raw = typeof item.title === "string" ? item.title : undefined;

  return raw ?? "";
}

/**
 * 文档目录。
 *
 * 只展示二级与三级标题：一级标题就是页面标题本身，四级及以下在正文中已经足够
 * 轻量，放进目录会让侧栏失去可扫读性。
 */
export function DocsTableOfContents({
  items,
  title,
}: {
  /** 正文标题树。 */
  items: DocsTocItem[];
  /** 目录标题文案。 */
  title: string;
}) {
  const visible_items = useMemo(
    () => items.filter((item) => item.depth >= 2 && item.depth <= 3),
    [items],
  );
  const [active_id, set_active_id] = useState<string>("");
  const container_ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible_items.length === 0) return undefined;

    const heading_elements = visible_items
      .map((item) => item.url.replace(/^#/, ""))
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);

    if (heading_elements.length === 0) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        // 取最后一个已经越过视口顶部的标题，作为当前章节。
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => entry.target.id);

        if (visible.length > 0) {
          set_active_id(visible[0]);
          return;
        }

        // 全部标题都不在视口内时，回退到最后一个位于视口上方的标题，
        // 避免长章节滚动中目录高亮整体消失。
        const passed = heading_elements.filter(
          (element) => element.getBoundingClientRect().top < 120,
        );
        if (passed.length > 0) set_active_id(passed[passed.length - 1].id);
      },
      // 顶部留出固定导航高度，底部收窄，使高亮切换发生在标题接近顶部时。
      { rootMargin: "-88px 0px -70% 0px", threshold: [0, 1] },
    );

    for (const element of heading_elements) observer.observe(element);

    return () => observer.disconnect();
  }, [visible_items]);

  if (visible_items.length === 0) return null;

  return (
    <nav aria-label={title} className="space-y-2" ref={container_ref}>
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-text-subtle">
        {title}
      </p>
      <ul className="space-y-1 border-l border-line">
        {visible_items.map((item) => {
          const id = item.url.replace(/^#/, "");
          const is_active = active_id === id;
          const label = toc_item_label(item);

          return (
            <li key={item.url}>
              <a
                href={item.url}
                data-active={is_active ? "true" : "false"}
                className={cn(
                  "-ml-px block border-l py-1 text-[0.8125rem] leading-snug transition-colors",
                  item.depth === 3 ? "pl-6" : "pl-4",
                  is_active
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-text-soft hover:text-foreground",
                )}
              >
                {label || id}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
