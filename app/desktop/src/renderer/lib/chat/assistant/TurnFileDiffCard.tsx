/**
 * Agent Chat 单轮文件改动卡片与完整 diff 审核视图。
 *
 * 数据只来自 canonical Assistant data part；组件不访问 Git，也不根据 Tool 日志推断改动。
 */

import { useState } from "react";
import type { SessionTurnFileDiff, SessionTurnFileDiffData } from "@downcity/agent/session";
import { TbChevronDown, TbChevronUp, TbFileDiff } from "react-icons/tb";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const DEFAULT_VISIBLE_FILE_COUNT = 3;

/** 展示当前 Turn 的文件数、行数统计和可展开文件列表。 */
export function TurnFileDiffCard({ data }: { /** 当前 Turn 的 canonical 文件改动。 */ data: SessionTurnFileDiffData }) {
  const [show_all, set_show_all] = useState(false);
  const [review_open, set_review_open] = useState(false);
  const hidden_count = Math.max(0, data.files.length - DEFAULT_VISIBLE_FILE_COUNT);
  const visible_files = show_all ? data.files : data.files.slice(0, DEFAULT_VISIBLE_FILE_COUNT);
  return <>
    <section className="mt-2 overflow-hidden rounded-xl border border-border-subtle bg-foreground/[0.012] text-[0.6875rem] text-foreground/80">
      <div className="flex min-h-11 items-center gap-2 border-b border-border/45 px-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.045] text-muted-foreground"><TbFileDiff className="size-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground/90">已编辑 {data.files.length} 个文件</div>
          <DiffStats additions={data.additions} deletions={data.deletions} />
        </div>
        <button type="button" onClick={() => set_review_open(true)} className="h-7 rounded-lg border border-border-subtle bg-background px-2.5 text-[0.6875rem] font-medium text-foreground/80 transition-colors hover:bg-interaction-hover hover:text-foreground">审核</button>
      </div>
      <div className="px-3 py-1.5">
        {visible_files.map((file) => <FileSummaryRow key={file.file} file={file} />)}
        {hidden_count > 0 ? <button type="button" onClick={() => set_show_all((current) => !current)} className="flex h-7 items-center gap-1 text-[0.6875rem] font-medium text-foreground/75 transition-colors hover:text-foreground">{show_all ? <><span>收起文件</span><TbChevronUp className="size-3.5" /></> : <><span>再显示 {hidden_count} 个文件</span><TbChevronDown className="size-3.5" /></>}</button> : null}
      </div>
    </section>
    <TurnFileDiffReview open={review_open} on_open_change={set_review_open} data={data} />
  </>;
}

/** 单行展示文件路径与新增、删除统计。 */
function FileSummaryRow({ file }: { /** 单个文件差异。 */ file: SessionTurnFileDiff }) {
  return <div className="flex min-h-7 min-w-0 items-center gap-3">
    <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-foreground/70" title={file.file}>{file.file}</span>
    <DiffStats additions={file.additions} deletions={file.deletions} compact />
  </div>;
}

/** 统一显示新增与删除行数。 */
function DiffStats({ additions, deletions, compact = false }: { /** 新增行数。 */ additions: number; /** 删除行数。 */ deletions: number; /** 是否使用单行紧凑布局。 */ compact?: boolean }) {
  return <span className={cn("tabular-nums", compact ? "shrink-0" : "mt-0.5 block")}><span className="text-emerald-600 dark:text-emerald-400">+{additions}</span><span className="ml-1 text-red-500 dark:text-red-400">-{deletions}</span></span>;
}

/** 在全尺寸 Dialog 中按文件展示完整 unified diff。 */
function TurnFileDiffReview({ open, on_open_change, data }: { /** Dialog 是否打开。 */ open: boolean; /** 更新 Dialog 打开状态。 */ on_open_change(open: boolean): void; /** 当前 Turn 文件改动。 */ data: SessionTurnFileDiffData }) {
  return <Dialog open={open} onOpenChange={on_open_change}>
    <DialogContent size="fullscreen">
      <DialogHeader className="border-b border-border/50">
        <div><DialogTitle>审核本轮改动</DialogTitle><DialogDescription>{data.files.length} 个文件，新增 {data.additions} 行，删除 {data.deletions} 行</DialogDescription></div>
      </DialogHeader>
      <DialogBody className="gap-4 px-3 pt-3 sm:px-4">
        {data.files.map((file) => <FilePatch key={file.file} file={file} />)}
      </DialogBody>
    </DialogContent>
  </Dialog>;
}

/** 展示单个文件的完整 patch，并按 diff 行语义着色。 */
function FilePatch({ file }: { /** 单个文件差异。 */ file: SessionTurnFileDiff }) {
  const lines = file.patch ? file.patch.split("\n") : ["二进制文件已更改"];
  return <section className="shrink-0 overflow-hidden rounded-xl border border-border-subtle bg-background">
    <header className="flex min-h-9 items-center gap-3 border-b border-border/50 bg-foreground/[0.025] px-3">
      <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] font-medium text-foreground/80" title={file.file}>{file.file}</span>
      <DiffStats additions={file.additions} deletions={file.deletions} compact />
    </header>
    <div className="overflow-x-auto bg-foreground/[0.012] py-1 font-mono text-[0.6875rem] leading-[1.55]">
      {lines.map((line, index) => <div key={`${index}:${line}`} className={diff_line_class_name(line)}><span className="block min-w-max px-3 whitespace-pre">{line || " "}</span></div>)}
    </div>
  </section>;
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
