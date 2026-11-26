/** Memory 处理记录：列表只展示状态，独立授权详情接口展示有界的固定差异与证据。 */
import { useEffect, useState } from "react";
import type { PowerPageComponentProps } from "@downcity/city/power/react";
import type { MemoryJobView } from "../types/MemoryJob.js";

/** 与宿主 jobs action 对齐的分页结果。 */
interface MemoryJobsPage {
  /** 当前执行范围可查看的处理记录。 */
  items: MemoryJobView[];
  /** 当前执行范围的总记录数。 */
  total: number;
}

/** Records are bound to their owning user or Agent, with no project filter. */
interface MemoryJobsProps extends Pick<PowerPageComponentProps, "power" | "ui"> {
  /** Owning category; the main page defaults to user records. */
  scope?: "user" | "agent";
  /** Required when displaying a specific Agent's records. */
  agent_id?: string;
  /** Agent Profile 内嵌时复用宿主页容器，避免重复 Page 布局。 */
  embedded?: boolean;
}

const PAGE_SIZE = 20;
const STATUS_LABELS: Record<MemoryJobView["status"], string> = {
  queued: "排队中", running: "处理中", committing: "提交中", retry_wait: "等待重试",
  succeeded: "已提交", skipped: "无需变更", failed: "失败",
};
const KIND_LABELS: Record<MemoryJobView["kind"], string> = {
  digest: "会话提炼", revise: "记忆修订", optimize: "核心记忆整理", dream: "后台整理",
};

/** One records view shared by the user page and the fixed Agent page. */
export function MemoryJobs({ power, ui, scope = "user", agent_id }: MemoryJobsProps) {
  const { Button, Callout, EmptyState, Group, Inline, LoadingState, Row, Status, Toolbar } = ui.components;
  const [page, set_page] = useState<MemoryJobsPage>();
  const [offset, set_offset] = useState(0);
  const [revision, set_revision] = useState(0);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState("");
  const input = { scope, ...(scope === "agent" && agent_id ? { agent_id } : {}) };

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    set_loading(true);
    set_error("");
    const load = async () => {
      try {
        if (scope === "agent" && !agent_id) throw new Error("请在 Agent 页面查看它的处理记录");
        const result = await power.invoke<MemoryJobsPage>("memory.records.list", { ...input, offset, limit: PAGE_SIZE });
        if (disposed) return;
        set_page(result);
        set_error("");
        if (result.items.some((job) => ["queued", "running", "committing", "retry_wait"].includes(job.status))) {
          timer = setTimeout(() => void load(), 3000);
        }
      } catch (reason) {
        if (!disposed) set_error(error_message(reason));
      } finally {
        if (!disposed) set_loading(false);
      }
    };
    void load();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [agent_id, scope, offset, power, revision, ui.revision]);

  return <><Toolbar title="处理记录" actions={<Button disabled={loading} on_click={() => set_revision((value) => value + 1)}>刷新</Button>} />
    {error ? <Callout tone="danger">{error}</Callout> : null}
    {loading ? <LoadingState label="正在读取处理记录…" /> : !page?.items.length ? <EmptyState title="还没有处理记录" /> : <>
      <Group>{page.items.map((job) => <Row key={job.job_id} label={KIND_LABELS[job.kind]}
        description={`${job.scope === "user" ? "用户记忆" : "Agent 私有记忆"} · ${new Date(job.updated_at).toLocaleString()}`}
        trailing={<Status tone={job.status === "failed" ? "danger" : job.status === "succeeded" ? "success" : "muted"}>{STATUS_LABELS[job.status]}</Status>}
        on_click={() => ui.open_view({ view_id: "memory_job_detail", resource_key: job.job_id, title: KIND_LABELS[job.kind], input: { job_id: job.job_id } })} />)}</Group>
      <Inline><Button disabled={!offset} on_click={() => set_offset(Math.max(0, offset - PAGE_SIZE))}>上一页</Button>
        <Status>{offset + 1}–{offset + page.items.length} / {page.total}</Status>
        <Button disabled={offset + PAGE_SIZE >= page.total} on_click={() => set_offset(offset + PAGE_SIZE)}>下一页</Button></Inline>
    </>}
  </>;
}

/** 网关错误保留为可读提示。 */
function error_message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
