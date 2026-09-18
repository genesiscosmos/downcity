/**
 * Desktop 命令面板。
 *
 * 职责边界：
 * - 拥有面板瞬时状态（当前页面、查询、高亮项），不写入任何 domain store；
 * - 把领域快照投影成 CommandContext，命令本身不读 store；
 * - 独占面板打开期间的键盘处理，包括 IME 组合期与 Esc 的两级语义。
 *
 * 不依赖 Base UI Dialog：面板需要「子页面按 Esc 返回而不是关闭」，
 * 而通用 Dialog 在 Esc 时无条件关闭，两者组合会产生脆弱的顺序依赖。
 * 面板只有 1–2 个可聚焦元素，自建的焦点约束比复用 Dialog 更小也更可读。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TbArrowLeft, TbCheck, TbSearch } from "react-icons/tb";
import { use_desktop_selector } from "@/app/use_desktop";
import { get_session_key } from "@/features/chat/lib/chat_cache_key";
import { order_rail_powers } from "@/features/navigation/lib/sidebar_shortcut";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";
import { is_chat_busy, type DesktopController, type NavigationTarget } from "@/types/DesktopView";
import { command_page_item_trailing, use_command_page_items } from "./CommandPageList.tsx";
import { command_result_limit } from "./filter.ts";
import {
  command_entry_pages,
  command_group_label_keys,
  command_group_order,
  command_page_empty_keys,
  command_page_placeholder_keys,
  command_page_loading_key,
  type CommandActiveSession,
  type CommandContext,
  type CommandGroupId,
  type CommandPage,
  type CommandPageItem,
  type RankedCommand,
} from "./types.ts";
import { use_commands } from "./use_commands.ts";

/** 面板属性。 */
interface CommandPaletteProps {
  /** 面板是否打开；由 Shell 持有，面板不自行决定开合。 */
  open: boolean;
  /** 请求关闭面板。 */
  on_close(): void;
  /** Renderer 稳定控制器。 */
  controller: DesktopController;
}

/** 渲染层的统一行模型；根命令与子页面行共用。 */
interface CommandRowModel {
  /** 稳定标识；用于高亮记忆。 */
  id: string;
  /** 行主文案。 */
  title: string;
  /** 行副文案。 */
  subtitle?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  /** 键位展示文本。 */
  shortcut?: string;
  /** 是否置灰。 */
  disabled: boolean;
  /** 置灰原因。 */
  disabled_reason?: string;
  /** 是否为当前项。 */
  is_current: boolean;
  /** 选中行为；接收面板投影出的上下文。 */
  run: (context: CommandContext) => void | Promise<void>;
}

/** 一个渲染分组；根页面按命令分组，子页面只有一个无标题分组。 */
interface CommandSection {
  key: string;
  /** 分组标题；为空时不渲染标题行。 */
  label: string;
  rows: readonly CommandRowModel[];
}

/** 翻页的近似步长。 */
const page_step = 8;

export function CommandPalette({ open, on_close, controller }: CommandPaletteProps) {
  const translate = use_translation("common");
  const [page, set_page] = useState<CommandPage>("root");
  const [query, set_query] = useState("");
  const [active_id, set_active_id] = useState("");
  const input_ref = useRef<HTMLInputElement>(null);
  const back_button_ref = useRef<HTMLButtonElement>(null);
  const list_ref = useRef<HTMLDivElement>(null);
  const restore_focus_ref = useRef<HTMLElement | null>(null);

  const sidebar_mode = use_desktop_selector(controller.stores.navigation, (state) => state.sidebar_mode);
  const active_workspace_id = use_desktop_selector(controller.stores.navigation, (state) => state.active_workspace_id);
  const selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const powers = use_desktop_selector(controller.stores.catalog, (state) => state.powers);

  const context = useMemo<CommandContext>(
    () => ({
      sidebar_mode,
      active_workspace_id,
      selection_kind: selection?.kind ?? null,
      active_session: resolve_active_session(selection, controller),
      visible_power_count: order_rail_powers(powers).length,
    }),
    // `open` 参与依赖：打开面板时重新解析运行态与历史游标，避免沿用上一次的陈旧投影。
    [active_workspace_id, controller, open, powers, selection, sidebar_mode],
  );

  const group_labels = useMemo(
    () => Object.fromEntries(command_group_order.map((group) => [group, translate(command_group_label_keys[group])])) as Record<CommandGroupId, string>,
    [translate],
  );

  const commands = use_commands(query, context, group_labels);
  const page_projection = use_command_page_items(page, query, controller);
  const sections = use_page_sections(page, commands, page_projection.items, group_labels);

  /** 全部可渲染行；键盘导航与高亮都在这个一维序列上进行。 */
  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);

  /** 行 id → 全局下标；渲染时用于写 `aria-activedescendant` 与滚动定位。 */
  const row_index_by_id = useMemo(() => new Map(rows.map((row, index) => [row.id, index])), [rows]);

  /**
   * 当前高亮下标。
   *
   * 由「记忆的 id + 当前行集合」推导，而不是在 effect 里写回 state：
   * 查询变化导致高亮项消失时会自动回落到第一个可用项，不会产生渲染循环。
   */
  const active_index = useMemo(() => {
    const remembered = rows.findIndex((row) => row.id === active_id);
    if (remembered >= 0 && !rows[remembered].disabled) return remembered;
    return rows.findIndex((row) => !row.disabled);
  }, [active_id, rows]);

  // ---- 生命周期 ----
  useEffect(() => {
    if (open) return;
    set_page("root");
    set_query("");
    set_active_id("");
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    restore_focus_ref.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const target = restore_focus_ref.current;
      restore_focus_ref.current = null;
      // 打开前的元素可能已随导航卸载；此时放弃恢复焦点，而不是抛错。
      if (target?.isConnected) target.focus();
    };
  }, [open]);

  useLayoutEffect(() => {
    if (open) input_ref.current?.focus();
  }, [open, page]);

  useEffect(() => {
    if (!open || active_index < 0) return;
    list_ref.current?.querySelector<HTMLElement>(`[data-row-index="${active_index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active_index, open, rows]);

  // ---- 行操作 ----
  const go_back = useCallback(() => {
    set_page("root");
    set_query("");
    set_active_id("");
  }, []);

  const dismiss = useCallback(() => on_close(), [on_close]);

  const run_row = useCallback(
    async (row: CommandRowModel) => {
      if (row.disabled) return;
      // 子页面入口必须留在面板内；先关闭会让用户看到一次面板闪烁。
      const target_page = command_entry_pages[row.id];
      if (target_page) {
        set_page(target_page);
        set_query("");
        set_active_id("");
        return;
      }
      dismiss();
      try {
        await row.run(context);
      } catch (error) {
        controller.actions.report_error(error);
      }
    },
    [context, controller.actions, dismiss],
  );

  /** 环形移动高亮，跳过禁用项。 */
  const move_highlight = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      const start = active_index >= 0 ? active_index : 0;
      for (let step = 1; step <= rows.length; step += 1) {
        const next = (((start + delta * step) % rows.length) + rows.length) % rows.length;
        if (!rows[next].disabled) {
          set_active_id(rows[next].id);
          return;
        }
      }
    },
    [active_index, rows],
  );

  /** 跳到首尾，或按步长翻页；翻页从目标位置向回退方向扫描最近的可用项。 */
  const jump_highlight = useCallback(
    (target: "first" | "last" | number) => {
      if (rows.length === 0) return;
      if (target === "first" || target === "last") {
        const ordered = target === "first" ? rows : [...rows].reverse();
        const found = ordered.find((row) => !row.disabled);
        if (found) set_active_id(found.id);
        return;
      }
      const anchor = active_index >= 0 ? active_index : 0;
      const clamped = Math.min(rows.length - 1, Math.max(0, target));
      const forward = clamped >= anchor;
      for (let step = 0; step < rows.length; step += 1) {
        const index = forward ? clamped + step : clamped - step;
        if (index < 0 || index >= rows.length) return;
        if (!rows[index].disabled) {
          set_active_id(rows[index].id);
          return;
        }
      }
    },
    [active_index, rows],
  );

  // ---- 键盘 ----
  const handle_key_down = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // IME 组合期间 Enter 属于「确认候选词」，绝不能执行命令。zh 是默认支持语言。
    if (event.nativeEvent.isComposing) return;
    const on_input = event.target === input_ref.current;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move_highlight(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        move_highlight(-1);
        return;
      case "Home":
        event.preventDefault();
        jump_highlight("first");
        return;
      case "End":
        event.preventDefault();
        jump_highlight("last");
        return;
      case "PageDown":
        event.preventDefault();
        jump_highlight((active_index >= 0 ? active_index : 0) + page_step);
        return;
      case "PageUp":
        event.preventDefault();
        jump_highlight((active_index >= 0 ? active_index : 0) - page_step);
        return;
      case "Enter":
        // 非输入框上的 Enter 交给按钮的默认行为（返回按钮）。
        if (!on_input) return;
        event.preventDefault();
        if (active_index >= 0) void run_row(rows[active_index]);
        return;
      case "Escape":
        event.preventDefault();
        if (page === "root") dismiss();
        else go_back();
        return;
      case "Backspace":
        if (on_input && !query && page !== "root") {
          event.preventDefault();
          go_back();
        }
        return;
      case "Tab": {
        // 面板只有输入框与返回按钮（子页面）两个可聚焦元素，Tab 只在这两者之间循环。
        event.preventDefault();
        if (page === "root") return;
        const back = back_button_ref.current;
        if (!back) return;
        if (document.activeElement === back) input_ref.current?.focus();
        else back.focus();
        return;
      }
      default:
        return;
    }
  };

  if (!open) return null;

  const is_sessions_page = page === "sessions";
  const show_loading = is_sessions_page && page_projection.status === "loading";
  const show_empty = !show_loading && rows.length === 0;
  // 数据本身为空 → 页面专属空态；只是没有匹配结果 → 通用空态，避免把「搜不到」说成「不存在」。
  const empty_key = page_projection.status === "empty" ? command_page_empty_keys[page] : "command_palette.empty";

  /** 单行渲染；根命令与子页面行共用同一套结构与状态样式。 */
  const render_row = (row: CommandRowModel) => {
    const index = row_index_by_id.get(row.id) ?? -1;
    const highlighted = index === active_index;
    return (
      <div
        key={row.id}
        id={`command-palette-option-${index}`}
        data-row-index={index}
        role="option"
        aria-selected={highlighted}
        aria-disabled={row.disabled || undefined}
        aria-current={row.is_current ? "true" : undefined}
        title={row.disabled ? row.disabled_reason : undefined}
        onMouseMove={() => {
          if (!row.disabled && row.id !== active_id) set_active_id(row.id);
        }}
        onClick={() => void run_row(row)}
        className={cn(
          "relative flex min-h-8 w-full select-none items-center gap-2.5 rounded-item px-2.5 py-1.5 text-left text-xs outline-none transition-colors duration-100 [&>svg]:size-4 [&>svg]:shrink-0",
          row.disabled
            ? "cursor-default text-muted-foreground"
            : "cursor-pointer text-foreground hover:bg-interaction-hover hover:text-foreground",
          highlighted && !row.disabled && "bg-interaction-selected text-foreground hover:bg-interaction-active",
        )}
      >
        {row.icon ? <span className="shrink-0 text-muted-foreground">{row.icon}</span> : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{row.title}</span>
          {row.subtitle ? <span className="mt-0.5 block truncate text-3xs text-muted-foreground">{row.subtitle}</span> : null}
        </span>
        {row.disabled && row.disabled_reason ? (
          <span className="shrink-0 text-3xs text-muted-foreground">{row.disabled_reason}</span>
        ) : null}
        {row.is_current ? <TbCheck className="size-4 shrink-0 text-foreground" aria-hidden="true" /> : null}
        {row.trailing}
        {row.shortcut ? <span className="ml-auto shrink-0 pl-2 text-2xs tracking-widest text-subtle-foreground">{row.shortcut}</span> : null}
      </div>
    );
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-center bg-scrim pt-[15vh] max-[520px]:pt-[8vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      {/* 点击面板空白处不应让输入框失焦，否则面板会失去键盘上下文。 */}
      <div
        className="h-fit w-[min(34rem,calc(100vw-2rem))]"
        onMouseDown={(event) => {
          if (!(event.target as HTMLElement).closest("[data-command-input='true']")) event.preventDefault();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={translate("command_palette.label")}
          onKeyDown={handle_key_down}
          className="overflow-hidden rounded-surface border border-border bg-background shadow-2xl"
        >
          <div className="flex h-11 items-center gap-2 border-b border-divider px-3">
            {page === "root" ? (
              <TbSearch className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <button
                ref={back_button_ref}
                type="button"
                onClick={go_back}
                aria-label={translate("command_palette.back")}
                title={translate("command_palette.back")}
                className="flex size-6 shrink-0 items-center justify-center rounded-control text-muted-foreground outline-none transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:bg-interaction-hover focus-visible:text-foreground"
              >
                <TbArrowLeft className="size-4" />
              </button>
            )}
            <input
              ref={input_ref}
              data-command-input="true"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-listbox"
              aria-activedescendant={active_index >= 0 ? `command-palette-option-${active_index}` : undefined}
              aria-autocomplete="list"
              aria-label={translate("command_palette.search")}
              autoComplete="off"
              spellCheck={false}
              placeholder={translate(command_page_placeholder_keys[page])}
              value={query}
              onChange={(event) => set_query(event.target.value)}
              className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none"
            />
          </div>

          {is_sessions_page && page_projection.scope_label ? (
            <p className="border-b border-divider px-3 py-1.5 text-3xs text-muted-foreground">
              {translate("command_palette.page.sessions_scope", { name: page_projection.scope_label })}
            </p>
          ) : null}

          <div
            ref={list_ref}
            id="command-palette-listbox"
            role="listbox"
            aria-label={translate("command_palette.label")}
            className="max-h-[min(24rem,50vh)] overflow-y-auto p-1"
          >
            {show_loading ? (
              <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">{translate(command_page_loading_key)}</p>
            ) : show_empty ? (
              <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">{translate(empty_key)}</p>
            ) : (
              sections.map((section) =>
                section.label ? (
                  <div key={section.key} role="group" aria-labelledby={`command-palette-group-${section.key}`}>
                    <div
                      id={`command-palette-group-${section.key}`}
                      role="presentation"
                      className="px-2 py-2 text-2xs font-medium text-muted-foreground select-none"
                    >
                      {section.label}
                    </div>
                    {section.rows.map(render_row)}
                  </div>
                ) : (
                  // 无标题分组（子页面）不声明 role="group"，避免出现没有可访问名称的分组。
                  <div key={section.key}>{section.rows.map(render_row)}</div>
                ),
              )
            )}
          </div>

          <div className="flex h-8 items-center justify-between gap-3 border-t border-divider px-3 text-3xs text-muted-foreground">
            <span>{translate(page === "root" ? "command_palette.hint.root" : "command_palette.hint.page")}</span>
            <span className="tabular-nums">
              {rows.length >= command_result_limit
                ? translate("command_palette.result_truncated")
                : translate("command_palette.result_count", { count: rows.length })}
            </span>
          </div>
        </div>
      </div>
      {/* 结果数量通过实时区域播报；粒度是数量而不是每一条内容，避免逐字击键刷屏。 */}
      <div aria-live="polite" className="sr-only">
        {translate("command_palette.result_count", { count: rows.length })}
      </div>
    </div>,
    document.body,
  );
}

/** 解析当前 Agent Session 的只读投影；不在会话上下文时为 null。 */
function resolve_active_session(selection: NavigationTarget | null, controller: DesktopController): CommandActiveSession | null {
  if (selection?.kind !== "session") return null;
  const snapshot = controller.stores.chat_stream.get_snapshot();
  const key = get_session_key(selection.workspace_id, selection.agent_id, selection.session_id);
  return {
    workspace_id: selection.workspace_id,
    agent_id: selection.agent_id,
    session_id: selection.session_id,
    is_draft: false,
    is_busy: is_chat_busy(snapshot.chat_runtime_by_session[key]),
    has_more_history: Boolean(snapshot.history_by_session[key]?.has_more),
  };
}

/** 把根命令与子页面行统一投影成渲染分组。 */
function use_page_sections(
  page: CommandPage,
  commands: readonly RankedCommand[],
  page_items: readonly CommandPageItem[],
  group_labels: Record<CommandGroupId, string>,
): readonly CommandSection[] {
  return useMemo(() => {
    if (page === "root") {
      const by_group = new Map<CommandGroupId, CommandRowModel[]>();
      for (const command of commands) {
        const row: CommandRowModel = {
          id: command.id,
          title: command.title,
          icon: command.icon,
          trailing: command.trailing,
          shortcut: command.shortcut,
          disabled: !command.is_enabled,
          disabled_reason: command.disabled_reason,
          is_current: false,
          // 统一成 Promise<void>：命令返回的 boolean 只用于「是否留在面板内」，
          // 而该决策已由 command_entry_pages 在调用 run 之前完成。
          run: async (run_context) => {
            await command.run(run_context);
          },
        };
        by_group.set(command.group, [...(by_group.get(command.group) ?? []), row]);
      }
      return command_group_order
        .filter((group) => (by_group.get(group)?.length ?? 0) > 0)
        .map<CommandSection>((group) => ({ key: group, label: group_labels[group], rows: by_group.get(group) ?? [] }));
    }

    return [
      {
        key: page,
        label: "",
        rows: page_items.map<CommandRowModel>((item) => ({
          id: item.id,
          title: item.title,
          subtitle: item.subtitle,
          icon: item.icon,
          trailing: command_page_item_trailing(item.is_current),
          disabled: false,
          is_current: Boolean(item.is_current),
          run: () => item.run(),
        })),
      },
    ];
  }, [commands, group_labels, page, page_items]);
}
