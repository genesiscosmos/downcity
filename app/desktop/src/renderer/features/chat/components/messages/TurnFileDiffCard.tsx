/**
 * Agent Chat 单轮文件改动卡片与完整 diff 审核视图。
 *
 * 数据只来自 canonical Assistant data part；组件不访问 Git，也不根据 Tool 日志推断改动。
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { SessionTurnFileDiff, SessionTurnFileDiffData } from "@downcity/agent/session";
import { TbCheck, TbChevronDown, TbChevronRight, TbChevronUp, TbDots, TbExternalLink, TbFileDiff, TbLink } from "react-icons/tb";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { BayBar } from "@/layouts/BayBar";
import { cn } from "@/lib/utils";
import { use_translation } from "@/locales/i18n";

const DEFAULT_VISIBLE_FILE_COUNT = 3;
const TurnFileDiffReviewContext = createContext<((data: SessionTurnFileDiffData) => void) | null>(null);
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

/** 在应用主视图中统一持有本轮 Diff 审核侧栏。 */
export function TurnFileDiffReviewHost({ children }: { /** Desktop 当前主视图。 */ children: ReactNode }) {
  const translate_chat = use_translation("chat");
  const [review_data, set_review_data] = useState<SessionTurnFileDiffData>();
  const [open, set_open] = useState(false);
  const open_review = useCallback((data: SessionTurnFileDiffData) => {
    set_review_data(data);
    set_open(true);
  }, []);
  return <TurnFileDiffReviewContext.Provider value={open_review}>
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <div className="flex h-full min-w-0 flex-1 flex-col">{children}</div>
      <BayBar open={open} title={translate_chat("file_diff.review")} close_baybar={() => set_open(false)}>{review_data ? <TurnFileDiffReviewPanel data={review_data} /> : null}</BayBar>
    </div>
  </TurnFileDiffReviewContext.Provider>;
}

/** 展示当前 Turn 的文件数、行数统计和可展开文件列表。 */
export function TurnFileDiffCard({ data }: { /** 当前 Turn 的 canonical 文件改动。 */ data: SessionTurnFileDiffData }) {
  const translate_chat = use_translation("chat");
  const [show_all, set_show_all] = useState(false);
  const open_review = useContext(TurnFileDiffReviewContext);
  const hidden_count = Math.max(0, data.files.length - DEFAULT_VISIBLE_FILE_COUNT);
  const visible_files = show_all ? data.files : data.files.slice(0, DEFAULT_VISIBLE_FILE_COUNT);
  return <section className="mt-2 overflow-hidden rounded-xl bg-surface-subtle text-[0.6875rem] text-foreground/80">
    <div className="flex min-h-11 items-center gap-2 px-3.5">
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4"><TbFileDiff aria-hidden /></span>
      <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{translate_chat("message.files_changed", { count: data.files.length })}</div>
      <DiffStats additions={data.additions} deletions={data.deletions} compact />
      {open_review ? <button type="button" onClick={() => open_review(data)} className="ml-1 flex h-6 shrink-0 items-center rounded-md px-2 text-[0.6875rem] font-medium text-foreground/70 transition-colors hover:bg-interaction-hover hover:text-foreground">{translate_chat("file_diff.review")}</button> : null}
    </div>
    <div className="divide-y divide-border/45 border-t border-border/45">
      {visible_files.map((file) => <FilePatch key={file.file} file={file} variant="inline" />)}
      {hidden_count > 0 ? <button type="button" onClick={() => set_show_all((current) => !current)} className="flex h-9 w-full cursor-pointer items-center gap-1.5 px-3.5 text-left text-[0.6875rem] font-medium text-foreground/75 transition-colors hover:bg-interaction-hover hover:text-foreground">{show_all ? <TbChevronUp className="size-3.5 shrink-0 text-muted-foreground" /> : <TbChevronDown className="size-3.5 shrink-0 text-muted-foreground" />}<span>{show_all ? translate_chat("file_diff.collapse") : translate_chat("file_diff.show_more", { count: hidden_count })}</span></button> : null}
    </div>
  </section>;
}

/** 统一显示新增与删除行数。 */
function DiffStats({ additions, deletions, compact = false }: { /** 新增行数。 */ additions: number; /** 删除行数。 */ deletions: number; /** 是否使用单行紧凑布局。 */ compact?: boolean }) {
  return <span className={cn("tabular-nums", compact ? "shrink-0" : "mt-0.5 block")}><span className="text-emerald-600 dark:text-emerald-400">+{additions}</span><span className="ml-1 text-red-500 dark:text-red-400">-{deletions}</span></span>;
}

/** 在右侧 BayBar 中展示当前 Turn 的完整 diff。 */
function TurnFileDiffReviewPanel({ data }: { /** 当前 Turn 的 canonical 文件改动。 */ data: SessionTurnFileDiffData }) {
  const translate_chat = use_translation("chat");
  return <div className="flex min-h-full flex-col gap-3 p-3">
    <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-background px-3 py-2 text-[0.6875rem]">
      <span className="min-w-0 flex-1 text-foreground/75">{translate_chat("message.files_changed", { count: data.files.length })}</span>
      <DiffStats additions={data.additions} deletions={data.deletions} compact />
    </div>
    {data.files.map((file) => <FilePatch key={file.file} file={file} variant="review" default_open />)}
  </div>;
}

/** 展示一个可折叠文件 patch，并按 diff 行语义着色。 */
function FilePatch({ file, variant, default_open = false }: { /** 单个文件差异。 */ file: SessionTurnFileDiff; /** 当前位于消息卡片或审核侧栏。 */ variant: "inline" | "review"; /** 初始是否展开。 */ default_open?: boolean }) {
  const translate_common = use_translation("common");
  const translate_chat = use_translation("chat");
  const [open, set_open] = useState(default_open);
  const [copied, set_copied] = useState(false);
  const open_action = use_turn_file_open();
  const lines = file.patch ? file.patch.split("\n") : [translate_chat("file_diff.binary")];
  const copy_link = async () => {
    if (!open_action) return;
    await navigator.clipboard.writeText(build_file_link(open_action.workspace_path, file.file));
    set_copied(true);
    window.setTimeout(() => set_copied(false), 1200);
  };
  return <details open={open} onToggle={(event) => set_open(event.currentTarget.open)} className={cn("group/file shrink-0 overflow-hidden", variant === "review" && "overflow-hidden rounded-lg border border-border-subtle bg-background")}>
    <summary className={cn("flex min-h-9 cursor-pointer list-none items-center gap-2.5 px-3 py-1.5 outline-none transition-colors hover:bg-interaction-hover focus-visible:bg-interaction-hover [&::-webkit-details-marker]:hidden", variant === "review" && "bg-foreground/[0.025]")}>
      <TbChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/file:rotate-90" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] font-medium text-foreground/80" title={file.file}>{file.file}</span>
      {open_action ? <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/file:opacity-100 focus-within:opacity-100">
        <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); open_action.open_file(file.file); }} className="flex size-5 items-center justify-center rounded-md bg-transparent p-0 text-primary/45 transition-colors hover:bg-primary/10 hover:text-primary/65 [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:stroke-[1.65]" title={translate_chat("file_diff.open")} aria-label={translate_chat("file_diff.open_file", { name: file.file })}><TbExternalLink aria-hidden /></button>
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); }} className="flex size-5 items-center justify-center rounded-md bg-transparent p-0 text-primary/45 transition-colors hover:bg-primary/10 hover:text-primary/65 [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:stroke-[1.65]" title={translate_common("actions.more")} aria-label={translate_chat("file_diff.file_actions", { name: file.file })}>{copied ? <TbCheck aria-hidden /> : <TbDots aria-hidden />}</button></DropdownMenuTrigger><DropdownMenuContent align="end" side="top" sideOffset={4}><DropdownMenuItem onClick={() => void copy_link()}><TbLink className="size-3.5" /><span>{copied ? translate_chat("message.copied") : translate_chat("file_diff.copy_link")}</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </span> : null}
      <DiffStats additions={file.additions} deletions={file.deletions} compact />
    </summary>
    <div className={cn("overflow-x-auto border-t border-border/45 py-1 font-mono text-[0.6875rem] leading-[1.55]", variant === "inline" && "max-h-80")}>
      {lines.map((line, index) => <div key={`${index}:${line}`} className={diff_line_class_name(line)}><span className="block min-w-max px-3.5 whitespace-pre">{line || " "}</span></div>)}
    </div>
  </details>;
}

/** 根据 unified diff 行前缀返回稳定视觉语义。 */
function diff_line_class_name(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-muted-foreground/75";
  if (line.startsWith("+")) return "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300";
  if (line.startsWith("-")) return "bg-red-500/10 text-red-800 dark:text-red-300";
  if (line.startsWith("@@")) return "bg-sky-500/[0.08] text-sky-700 dark:text-sky-300";
  if (line.startsWith("diff --git") || line.startsWith("index ")) return "text-muted-foreground";
  return "text-foreground/70";
}
