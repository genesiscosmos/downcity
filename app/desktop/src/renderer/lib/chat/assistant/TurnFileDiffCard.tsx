/**
 * Agent Chat 单轮文件改动卡片与完整 diff 审核视图。
 *
 * 数据只来自 canonical Assistant data part；组件不访问 Git，也不根据 Tool 日志推断改动。
 */

import { createContext, useContext, useState, type ReactNode } from "react";
import type { SessionTurnFileDiff, SessionTurnFileDiffData } from "@downcity/agent/session";
import { TbChevronDown, TbChevronRight, TbChevronUp, TbFileDiff } from "react-icons/tb";
import { BayBar } from "@/layouts/BayBar";
import { cn } from "@/lib/utils";

const DEFAULT_VISIBLE_FILE_COUNT = 3;
const TurnFileDiffReviewContext = createContext<((data: SessionTurnFileDiffData) => void) | null>(null);

/** 在应用主视图中统一持有本轮 Diff 审核侧栏。 */
export function TurnFileDiffReviewHost({ children }: { /** Desktop 当前主视图。 */ children: ReactNode }) {
  const [review_data, set_review_data] = useState<SessionTurnFileDiffData>();
  const [open, set_open] = useState(false);
  const open_review = (data: SessionTurnFileDiffData) => {
    set_review_data(data);
    set_open(true);
  };
  return <TurnFileDiffReviewContext.Provider value={open_review}>
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <div className="flex h-full min-w-0 flex-1 flex-col">{children}</div>
      <BayBar open={open} title="审核本轮文件编辑" close_baybar={() => set_open(false)}>{review_data ? <TurnFileDiffReviewPanel data={review_data} /> : null}</BayBar>
    </div>
  </TurnFileDiffReviewContext.Provider>;
}

/** 展示当前 Turn 的文件数、行数统计和可展开文件列表。 */
export function TurnFileDiffCard({ data }: { /** 当前 Turn 的 canonical 文件改动。 */ data: SessionTurnFileDiffData }) {
  const [show_all, set_show_all] = useState(false);
  const open_review = useContext(TurnFileDiffReviewContext);
  const hidden_count = Math.max(0, data.files.length - DEFAULT_VISIBLE_FILE_COUNT);
  const visible_files = show_all ? data.files : data.files.slice(0, DEFAULT_VISIBLE_FILE_COUNT);
  return <section className="mt-2 overflow-hidden rounded-xl bg-surface-subtle text-[0.6875rem] text-foreground/80">
    <div className="flex min-h-11 items-center gap-2 px-3.5">
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4"><TbFileDiff aria-hidden /></span>
      <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">已编辑 {data.files.length} 个文件</div>
      <DiffStats additions={data.additions} deletions={data.deletions} compact />
      {open_review ? <button type="button" onClick={() => open_review(data)} className="ml-1 flex h-6 shrink-0 items-center rounded-md px-2 text-[0.6875rem] font-medium text-foreground/70 transition-colors hover:bg-interaction-hover hover:text-foreground">审核</button> : null}
    </div>
    <div className="divide-y divide-border/45 border-t border-border/45">
      {visible_files.map((file) => <FilePatch key={file.file} file={file} variant="inline" />)}
      {hidden_count > 0 ? <button type="button" onClick={() => set_show_all((current) => !current)} className="flex h-9 w-full cursor-pointer items-center gap-1.5 px-3.5 text-left text-[0.6875rem] font-medium text-foreground/75 transition-colors hover:bg-interaction-hover hover:text-foreground">{show_all ? <TbChevronUp className="size-3.5 shrink-0 text-muted-foreground" /> : <TbChevronDown className="size-3.5 shrink-0 text-muted-foreground" />}<span>{show_all ? "收起文件" : `再显示 ${hidden_count} 个文件`}</span></button> : null}
    </div>
  </section>;
}

/** 统一显示新增与删除行数。 */
function DiffStats({ additions, deletions, compact = false }: { /** 新增行数。 */ additions: number; /** 删除行数。 */ deletions: number; /** 是否使用单行紧凑布局。 */ compact?: boolean }) {
  return <span className={cn("tabular-nums", compact ? "shrink-0" : "mt-0.5 block")}><span className="text-emerald-600 dark:text-emerald-400">+{additions}</span><span className="ml-1 text-red-500 dark:text-red-400">-{deletions}</span></span>;
}

/** 在右侧 BayBar 中展示当前 Turn 的完整 diff。 */
function TurnFileDiffReviewPanel({ data }: { /** 当前 Turn 的 canonical 文件改动。 */ data: SessionTurnFileDiffData }) {
  return <div className="flex min-h-full flex-col gap-3 p-3">
    <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-background px-3 py-2 text-[0.6875rem]">
      <span className="min-w-0 flex-1 text-foreground/75">{data.files.length} 个文件</span>
      <DiffStats additions={data.additions} deletions={data.deletions} compact />
    </div>
    {data.files.map((file) => <FilePatch key={file.file} file={file} variant="review" default_open />)}
  </div>;
}

/** 展示一个可折叠文件 patch，并按 diff 行语义着色。 */
function FilePatch({ file, variant, default_open = false }: { /** 单个文件差异。 */ file: SessionTurnFileDiff; /** 当前位于消息卡片或审核侧栏。 */ variant: "inline" | "review"; /** 初始是否展开。 */ default_open?: boolean }) {
  const [open, set_open] = useState(default_open);
  const lines = file.patch ? file.patch.split("\n") : ["二进制文件已更改"];
  return <details open={open} onToggle={(event) => set_open(event.currentTarget.open)} className={cn("group/file shrink-0 overflow-hidden", variant === "review" && "overflow-hidden rounded-lg border border-border-subtle bg-background")}>
    <summary className={cn("flex min-h-9 cursor-pointer list-none items-center gap-2.5 px-3 py-1.5 outline-none transition-colors hover:bg-interaction-hover focus-visible:bg-interaction-hover [&::-webkit-details-marker]:hidden", variant === "review" && "bg-foreground/[0.025]")}>
      <TbChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/file:rotate-90" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] font-medium text-foreground/80" title={file.file}>{file.file}</span>
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
