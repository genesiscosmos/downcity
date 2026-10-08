/**
 * 文档侧边栏导航模块。
 *
 * 渲染当前文档空间的导航树，并高亮当前页面。树结构由文档索引提供（顺序与
 * `meta.json` 声明一致），本模块只负责展开状态、层级缩进与可访问性标记。
 *
 * 交互约定：
 * 1. 当前页面所在的分支默认展开，其余目录默认收起。
 * 2. 目录节点自身也有页面时（目录 index），标题可点击直达，同时提供展开按钮。
 * 3. 当前项输出 `aria-current="page"`，供测试与辅助技术识别。
 */
import { Link } from "react-router";
import { IconChevronRight } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { DocsNavNode } from "@/lib/docs/types";

/** 判断某个 URL 是否属于当前路径。 */
function is_current_path(current_path: string, url: string | undefined): boolean {
  if (!url) return false;

  return current_path === url || current_path.startsWith(url);
}

/**
 * 收集需要默认展开的目录 key。
 *
 * 当前页面自身及其祖先链上的目录都应展开，否则用户看不到自己在树中的位置。
 */
function collect_open_keys(nodes: readonly DocsNavNode[], current_path: string): Set<string> {
  const open_keys = new Set<string>();

  const visit = (node: DocsNavNode): boolean => {
    const children = node.children ?? [];
    const contains_current =
      children.some((child) => visit(child)) || is_current_path(current_path, node.url);

    if (contains_current && children.length > 0) open_keys.add(node.key);

    return contains_current;
  };

  nodes.forEach(visit);

  return open_keys;
}

/** 单个导航节点及其子树。 */
function NavTreeItem({
  node,
  depth,
  current_path,
  open_keys,
  on_toggle,
}: {
  /** 当前节点。 */
  node: DocsNavNode;
  /** 层级深度，0 为顶层。 */
  depth: number;
  /** 当前页面路径，用于高亮与展开判定。 */
  current_path: string;
  /** 处于展开状态的目录 key 集合。 */
  open_keys: ReadonlySet<string>;
  /** 切换目录展开状态。 */
  on_toggle: (key: string) => void;
}) {
  const children = node.children ?? [];
  const has_children = children.length > 0;
  const is_open = open_keys.has(node.key);
  const is_current = current_path === node.url;

  const item_class = cn(
    "group flex min-h-8 w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-[0.8125rem] leading-snug transition-colors",
    is_current
      ? "bg-foreground/[0.055] font-medium text-foreground"
      : "text-text-soft hover:bg-foreground/[0.035] hover:text-foreground",
  );
  // 层级缩进按深度递增，保持与目录标题的视觉从属关系。
  const indent_style = { paddingLeft: `${0.5 + depth * 0.75}rem` };

  return (
    <li>
      <div className="flex items-center">
        {has_children ? (
          <button
            type="button"
            aria-label={is_open ? "Collapse section" : "Expand section"}
            aria-expanded={is_open}
            onClick={() => on_toggle(node.key)}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded text-text-subtle transition-colors hover:text-foreground"
          >
            <IconChevronRight
              className={cn(
                "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
                is_open && "rotate-90",
              )}
              strokeWidth={1.8}
            />
          </button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden="true" />
        )}

        {node.url ? (
          <Link
            to={node.url}
            data-active={is_current ? "true" : "false"}
            aria-current={is_current ? "page" : undefined}
            className={item_class}
            style={indent_style}
          >
            <span className="truncate">{node.label}</span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => on_toggle(node.key)}
            aria-expanded={is_open}
            className={cn(item_class, "text-left")}
            style={indent_style}
          >
            <span className="truncate">{node.label}</span>
          </button>
        )}
      </div>

      {has_children && is_open ? (
        <ul className="mt-0.5 space-y-0.5">
          {children.map((child) => (
            <NavTreeItem
              key={child.key}
              node={child}
              depth={depth + 1}
              current_path={current_path}
              open_keys={open_keys}
              on_toggle={on_toggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * 文档侧边栏。
 *
 * 树来自文档索引，当前页所在分支默认展开；用户的手动展开状态在同一个页面生命周期内
 * 会被保留，切换到新页面时按新位置重新计算。
 */
export function DocsSidebar({
  tree,
  current_path,
  title,
}: {
  /** 当前空间的导航树。 */
  tree: DocsNavNode[];
  /** 当前页面的公开 URL。 */
  current_path: string;
  /** 侧边栏顶部标题，通常是空间显示名。 */
  title: string;
}) {
  const default_open_keys = useMemo(
    () => collect_open_keys(tree, current_path),
    [tree, current_path],
  );
  const [open_keys, set_open_keys] = useState<Set<string>>(default_open_keys);

  // 切换页面后按新位置重置展开状态，避免上一个页面的展开分支残留。
  useEffect(() => {
    set_open_keys(default_open_keys);
  }, [default_open_keys]);

  const toggle = (key: string) => {
    set_open_keys((previous) => {
      const next = new Set(previous);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  };

  return (
    <nav aria-label={title} className="space-y-1">
      <p className="px-2 pb-2 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-text-subtle">
        {title}
      </p>
      <ul className="space-y-0.5">
        {tree.map((node) => (
          <NavTreeItem
            key={node.key}
            node={node}
            depth={0}
            current_path={current_path}
            open_keys={open_keys}
            on_toggle={toggle}
          />
        ))}
      </ul>
    </nav>
  );
}
