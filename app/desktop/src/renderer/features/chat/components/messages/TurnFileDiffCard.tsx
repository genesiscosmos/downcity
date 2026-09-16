/**
 * Agent Chat 单轮文件改动卡片与完整 diff 审核视图。
 *
 * 数据只来自 canonical Agent Data Part；组件不访问 Git，也不根据 Tool 日志推断改动。
 */

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { SessionTurnFileDiff, SessionTurnFileDiffData, SessionTurnFileDiffSummary } from "@downcity/agent/session";
import { TbCheck, TbChevronDown, TbChevronRight, TbChevronUp, TbDots, TbExternalLink, TbFileDiff, TbGitCompare, TbLink } from "react-icons/tb";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { message_action_button_class_name } from "@/features/chat/components/messages/MessageActionButton";
import { use_baybar_open, baybar_tab_id, type BayBarTab, type BayBarTranslate } from "@/layouts/BayBar";
import { use_desktop_selector } from "@/app/use_desktop";
import type { DesktopController } from "@/types/DesktopView";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";

/** 「本轮」标签页与其下文件改动分区的稳定标识。 */
export const FILE_DIFF_SECTION_ID = "file-diff";

const DEFAULT_VISIBLE_FILE_COUNT = 3;

/** 「本轮」标签页的种类标识。 */
export const TURN_TAB_KIND = "turn";

/** Diff 审核入口：选中某一轮并把它打开到右侧。 */
export type TurnFileDiffReviewOpen = (data: SessionTurnFileDiffData) => void;
const TurnFileDiffReviewContext = createContext<TurnFileDiffReviewOpen | null>(null);
/** diff 文件项的打开动作与链接上下文。 */
interface TurnFileOpenAction {
  /** 在主视图 Workspace 中打开指定相对路径文件。 */
  open_file(relative_path: string): void;
  /** Workspace 绝对路径；用于构造可粘贴的 file 链接。 */
  workspace_path?: string;
}
const TurnFileOpenContext = createContext<TurnFileOpenAction | null>(null);

/** 在消息区域为 diff 文件项注入“在主视图 Workspace 中打开”动作与链接上下文。 */
export function TurnFileOpenProvider({ open_file, workspace_path, children }: { /** 打开指定相对路径文件；不提供时不渲染文件操作。 */ open_file?: (relative_path: string) => void; /** Workspace 绝对路径；用于复制文件链接。 */ workspace_path?: string; /** 消息渲染内容。 */ children: ReactNode }) {
  const value = useMemo<TurnFileOpenAction | null>(() => open_file ? { open_file, workspace_path } : null, [open_file, workspace_path]);
  return <TurnFileOpenContext.Provider value={value}>{children}</TurnFileOpenContext.Provider>;
}
/** 读取 diff 文件项的打开动作；未注入时为空。 */
function use_turn_file_open(): TurnFileOpenAction | undefined {
  return useContext(TurnFileOpenContext) ?? undefined;
}

/** 构造可在输入框粘贴并解析回 Workspace 文件的 file 链接。 */
function build_file_link(workspace_path: string | undefined, relative_path: string): string {
  if (!workspace_path) return relative_path;
  const root = workspace_path.replace(/\\/g, "/").replace(/\/+$/, "");
  const absolute_path = root.startsWith("/") ? `${root}/${relative_path}` : `/${root}/${relative_path}`;
  return `file://${encodeURI(absolute_path)}`;
}

/**
 * 各会话当前选中的「待审阅轮次」。
 *
 * 模块级共享状态，理由与 Chat 打开文件相同：写入方是正文里的 diff 卡片，
 * 读取方是面板里的「本轮」tab，两者不在同一棵子树里；
 * 若放在页面的 useState 里，切换会话或收起面板后内容就丢了。
 */
const review_by_session = new Map<string, SessionTurnFileDiffData>();
const review_listeners = new Set<() => void>();

function subscribe_review(listener: () => void): () => void {
  review_listeners.add(listener);
  return () => { review_listeners.delete(listener); };
}

/** 写入某会话选中的轮次，并通知订阅者。 */
function write_review(session_key: string, data: SessionTurnFileDiffData): void {
  review_by_session.set(session_key, data);
  for (const listener of review_listeners) listener();
}

/** 读取某会话选中的轮次；未选过时为空。 */
export function use_turn_review(session_key: string): SessionTurnFileDiffData | undefined {
  return useSyncExternalStore(
    subscribe_review,
    () => review_by_session.get(session_key),
    () => review_by_session.get(session_key),
  );
}

/**
 * 注入 Diff 审核入口：选中某一轮 + 在右侧打开「本轮」标签页。
 *
 * 两件事收在这里，是因为它们共享同一份上下文（会话、controller、文案）：
 * 卡片只负责「用户点了审核」，不需要知道标签页怎么构造。
 * 选中的轮次写进模块级状态，面板里的「本轮」标签页能读到，
 * 不依赖页面是否还在渲染。
 */
export function TurnFileDiffReviewProvider({ session_key, session_title, controller, children }: {
  /** 当前 Chat 的会话缓存键。 */
  session_key: string;
  /** 当前会话标题（原始值，可能为空）；用于给标签页命名。 */
  session_title?: string;
  /** Renderer 稳定控制器，用于构造标签页内容。 */
  controller: DesktopController;
  /** 消息渲染内容。 */
  children: ReactNode;
}) {
  const translate_chat = use_translation("chat");
  const open_baybar = use_baybar_open();
  const open_review = useCallback<TurnFileDiffReviewOpen>((data) => {
    write_review(session_key, data);
    // 标题用会话名，不用「本轮」：同时开着多个会话时，
    // 「本轮」会重复出现而无法区分是哪个会话的。
    const label = session_title?.trim() || translate_chat("conversation.new");
    open_baybar(turn_tab(session_key, label, controller, translate_chat), FILE_DIFF_SECTION_ID);
  }, [controller, open_baybar, session_key, session_title, translate_chat]);
  return <TurnFileDiffReviewContext.Provider value={open_review}>{children}</TurnFileDiffReviewContext.Provider>;
}

/**
 * 「本轮」tab 的自解析内容。
 *
 * 自己订阅会话的本轮改动摘要与选中轮次，因此正文是否还在渲染都不影响它。
 */
export function TurnTab({ session_key, controller }: {
  /** 当前 Chat 的会话缓存键。 */
  session_key: string;
  /** Renderer 稳定控制器，用于读取本轮改动摘要。 */
  controller: DesktopController;
}) {
  const summary = use_desktop_selector(controller.stores.chat_stream, (state) => state.file_diff_by_session[session_key]);
  const review_data = use_turn_review(session_key);
  return review_data ? <TurnFileDiffReviewPanel data={review_data} /> : <TurnFileDiffOverview summary={summary} />;
}

/**
 * 构造「本轮改动」标签页。
 *
 * 在点击审核时调用；内容自解析（只带 session_key），
 * 所以切换会话后已打开的标签页依旧显示它自己那一轮。
 *
 * 标题是**会话名**（由调用方算好）：本轮是会话内的一个阶段，没有自己的名字，
 * 能区分多个同类标签页的只有会话名。
 */
export function turn_tab(session_key: string, session_label: string, controller: DesktopController, t: BayBarTranslate): BayBarTab {
  return {
    id: baybar_tab_id(TURN_TAB_KIND, session_key),
    label: session_label,
    icon: <TbGitCompare />,
    sections: [{
      id: FILE_DIFF_SECTION_ID,
      label: t("file_diff.tab_label"),
      content: <TurnTab session_key={session_key} controller={controller} />,
    }],
  };
}

/**
 * 读取 Diff 审核入口；未注入时为空。
 */
function use_turn_file_diff_review(): TurnFileDiffReviewOpen | undefined {
  return useContext(TurnFileDiffReviewContext) ?? undefined;
}

/** 展示当前 Turn 的文件数、行数统计和可展开文件列表。 */
export function TurnFileDiffCard({ data }: { /** 当前 Turn 的 canonical 文件改动。 */ data: SessionTurnFileDiffData }) {
  const translate_chat = use_translation("chat");
  const [show_all, set_show_all] = useState(false);
  const review = use_turn_file_diff_review();
  const hidden_count = Math.max(0, data.files.length - DEFAULT_VISIBLE_FILE_COUNT);
  const visible_files = show_all ? data.files : data.files.slice(0, DEFAULT_VISIBLE_FILE_COUNT);
  return <section className="mt-2 overflow-hidden rounded-xl bg-surface-subtle text-2xs text-foreground">
    <div className="flex min-h-11 items-center gap-2 px-3.5">
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4"><TbFileDiff aria-hidden /></span>
      <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{translate_chat("message.files_changed", { count: data.files.length })}</div>
      <DiffStats additions={data.additions} deletions={data.deletions} compact />
      {review ? <button type="button" onClick={() => review(data)} className="ml-1 flex h-6 shrink-0 items-center rounded-md px-2 text-2xs font-medium text-foreground outline-none transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30">{translate_chat("file_diff.review")}</button> : null}
    </div>
    <div className="divide-y divide-divider border-t border-divider">
      {visible_files.map((file) => <FilePatch key={file.file} file={file} variant="inline" />)}
      {hidden_count > 0 ? <button type="button" onClick={() => set_show_all((current) => !current)} className="flex h-9 w-full cursor-pointer items-center gap-1.5 px-3.5 text-left text-2xs font-medium text-foreground outline-none transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30">{show_all ? <TbChevronUp className="size-3.5 shrink-0 text-muted-foreground" /> : <TbChevronDown className="size-3.5 shrink-0 text-muted-foreground" />}<span>{show_all ? translate_chat("file_diff.collapse") : translate_chat("file_diff.show_more", { count: hidden_count })}</span></button> : null}
    </div>
  </section>;
}

/** 统一显示新增与删除行数。 */
function DiffStats({ additions, deletions, compact = false }: { /** 新增行数。 */ additions: number; /** 删除行数。 */ deletions: number; /** 是否使用单行紧凑布局。 */ compact?: boolean }) {
  return <span className={cn("tabular-nums", compact ? "shrink-0" : "mt-0.5 block")}><span className="text-emerald-600 dark:text-emerald-400">+{additions}</span><span className="ml-1 text-red-500 dark:text-red-400">-{deletions}</span></span>;
}

/** 在右侧 BayBar 中展示当前选中 Turn 的完整 diff。 */
export function TurnFileDiffReviewPanel({ data }: { /** 当前 Turn 的 canonical 文件改动。 */ data: SessionTurnFileDiffData }) {
  const translate_chat = use_translation("chat");
  return <div className="file-diff-review-panel">
    <header className="file-diff-review-summary">
      <TbFileDiff className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 text-xs font-medium text-foreground">{translate_chat("message.files_changed", { count: data.files.length })}</span>
      <span className="file-diff-review-stats"><DiffStats additions={data.additions} deletions={data.deletions} compact /></span>
    </header>
    <div className="file-diff-review-files">{data.files.map((file) => <FilePatch key={file.file} file={file} variant="review" default_open />)}</div>
  </div>;
}

/** 展示一个可折叠文件 patch，并按 diff 行语义着色。 */
function FilePatch({ file, variant, default_open = false }: { /** 单个文件差异。 */ file: SessionTurnFileDiff; /** 当前位于消息卡片或审核侧栏。 */ variant: "inline" | "review"; /** 初始是否展开。 */ default_open?: boolean }) {
  const translate_common = use_translation("common");
  const translate_chat = use_translation("chat");
  const [open, set_open] = useState(default_open);
  const [copied, set_copied] = useState(false);
  const open_action = use_turn_file_open();
  const rows = file.patch ? parse_unified_diff(file.patch) : [{ type: "meta", text: translate_chat("file_diff.binary") } satisfies DiffRow];
  const copy_link = async () => {
    if (!open_action) return;
    await navigator.clipboard.writeText(build_file_link(open_action.workspace_path, file.file));
    set_copied(true);
    window.setTimeout(() => set_copied(false), 1200);
  };
  return <details open={open} onToggle={(event) => set_open(event.currentTarget.open)} className={cn("group/file shrink-0 overflow-hidden", variant === "review" && "file-diff-review-file")}>
    <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2.5 px-3 py-1.5 outline-none transition-colors hover:bg-interaction-hover focus-visible:bg-interaction-hover [&::-webkit-details-marker]:hidden">
      <TbChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/file:rotate-90" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-mono text-2xs font-medium text-foreground" title={file.file}>{file.file}</span>
      {open_action ? <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/file:opacity-100 focus-within:opacity-100">
        <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); open_action.open_file(file.file); }} className={message_action_button_class_name} title={translate_chat("file_diff.open")} aria-label={translate_chat("file_diff.open_file", { name: file.file })}><TbExternalLink aria-hidden /></button>
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); }} className={message_action_button_class_name} title={translate_common("actions.more")} aria-label={translate_chat("file_diff.file_actions", { name: file.file })}>{copied ? <TbCheck aria-hidden /> : <TbDots aria-hidden />}</button></DropdownMenuTrigger><DropdownMenuContent align="end" side="top" sideOffset={4}><DropdownMenuItem onClick={() => void copy_link()}><TbLink className="size-3.5" /><span>{copied ? translate_chat("message.copied") : translate_chat("file_diff.copy_link")}</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </span> : null}
      <span className={variant === "review" ? "file-diff-review-stats" : undefined}><DiffStats additions={file.additions} deletions={file.deletions} compact /></span>
    </summary>
    <div className={cn("file-diff-patch border-t border-divider", variant === "inline" && "max-h-80")}>
      {rows.map((row, index) => row.type === "omitted"
        ? <div key={`omitted:${index}`} className="file-diff-omitted">{translate_chat("file_diff.unmodified", { count: row.count })}</div>
        : row.type === "meta"
          ? <div key={`meta:${index}`} className="file-diff-meta">{row.text}</div>
          : <div key={`${row.type}:${row.old_line}:${row.new_line}:${index}`} className={cn("file-diff-code-row", `is-${row.type}`)}>
            <span className="file-diff-line-number" aria-hidden>{row.type === "addition" ? row.new_line : row.old_line}</span>
            <code>{row.text || " "}</code>
          </div>)}
    </div>
  </details>;
}

/** 消息内 Diff 使用并排复用的单列行号，不把 unified diff 的 +/- 前缀混入正文。 */
type DiffRow =
  | { type: "context" | "addition" | "removal"; text: string; old_line?: number; new_line?: number }
  | { type: "omitted"; count: number }
  | { type: "meta"; text: string };

function parse_unified_diff(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let old_line = 0;
  let new_line = 0;
  let previous_old_end = 0;
  let previous_new_end = 0;
  for (const line of patch.split("\n")) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      const next_old = Number(hunk[1]);
      const next_new = Number(hunk[2]);
      const omitted = previous_old_end || previous_new_end
        ? Math.max(next_old - previous_old_end, next_new - previous_new_end)
        : Math.max(next_old - 1, next_new - 1);
      if (omitted > 0) rows.push({ type: "omitted", count: omitted });
      old_line = next_old;
      new_line = next_new;
      continue;
    }
    if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("\\ No newline")) continue;
    if (line.startsWith("-")) {
      rows.push({ type: "removal", text: line.slice(1), old_line });
      old_line += 1;
    } else if (line.startsWith("+")) {
      rows.push({ type: "addition", text: line.slice(1), new_line });
      new_line += 1;
    } else if (line.startsWith(" ")) {
      rows.push({ type: "context", text: line.slice(1), old_line, new_line });
      old_line += 1;
      new_line += 1;
    } else if (line) {
      rows.push({ type: "meta", text: line });
    }
    previous_old_end = old_line;
    previous_new_end = new_line;
  }
  return rows;
}

/**
 * 尚未选中具体轮次时的 Diff 面板内容。
 *
 * 当前轮次存在改动就会出现在右侧 Rail 中，因此这里必须给出明确去向，
 * 而不是留一个空面板。
 */
export function TurnFileDiffOverview({ summary }: { /** 当前 Turn 的实时改动摘要；为空表示本轮尚无改动。 */ summary?: SessionTurnFileDiffSummary }) {
  const translate_chat = use_translation("chat");
  // 「本轮」域始终存在，没有改动时也要给出明确说明，而不是留一个空面板。
  if (!summary) return <div className="p-3 text-2xs leading-5 text-muted-foreground">{translate_chat("file_diff.empty_turn")}</div>;
  return <div className="flex min-h-0 flex-col gap-3 p-3">
    <div className="flex min-w-0 items-start gap-2.5 rounded-xl bg-surface-subtle px-3 py-2.5">
      <TbFileDiff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground">{translate_chat("message.files_changed", { count: summary.files_count })}</div>
        <div className="mt-1 text-2xs"><DiffStats additions={summary.additions} deletions={summary.deletions} /></div>
      </div>
    </div>
    <p className="text-2xs leading-5 text-muted-foreground">{translate_chat("file_diff.pick_turn")}</p>
  </div>;
}
