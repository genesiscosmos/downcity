/** Memory 处理记录：列表只展示状态，独立授权详情接口展示有界的固定差异与证据。 */
import { useEffect, useState } from "react";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import type { MemoryJobDetail, MemoryJobView } from "../types/MemoryJob.js";
import { memory_job_changes as MemoryJobChanges } from "./MemoryJobDetail.js";

/** 与宿主 jobs action 对齐的分页结果。 */
interface MemoryJobsPage {
  /** 当前执行范围可查看的处理记录。 */
  items: MemoryJobView[];
  /** 当前执行范围的总记录数。 */
  total: number;
}

/** 组件只使用现有 Power 网关、宿主 UI 和稳定的范围定位。 */
interface MemoryJobsProps extends Pick<PowerMainviewComponentProps, "power" | "navigation" | "ui"> {
  /** 调用领域 action 的真实 Agent。 */
  agent_id: string;
  /** 当前项目；空字符串表示未指定。 */
  workspace_id: string;
}

const PAGE_SIZE = 20;
const STATUS_LABELS: Record<MemoryJobView["status"], string> = {
  queued: "排队中", running: "处理中", committing: "提交中", retry_wait: "等待重试",
  succeeded: "已提交", skipped: "无需变更", failed: "失败",
};
const KIND_LABELS: Record<MemoryJobView["kind"], string> = {
  digest: "会话提炼", revise: "记忆修订", profile_optimize: "核心记忆整理", dream: "后台整理",
};

/** 仅活跃记录参与轮询；卸载、切换页码和刷新时忽略此前请求结果。 */
export function MemoryJobs({ power, navigation, ui, agent_id, workspace_id }: MemoryJobsProps) {
  const { Button, Callout, EmptyState, Group, Inline, LoadingState, Page, Row, Section, Status, Toolbar } = ui.components;
  const [page, set_page] = useState<MemoryJobsPage>();
  const [offset, set_offset] = useState(0);
  const [revision, set_revision] = useState(0);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState("");
  const [selected_id, set_selected_id] = useState("");
  const [detail, set_detail] = useState<MemoryJobDetail>();
  const [reading, set_reading] = useState(false);
  const [busy, set_busy] = useState(false);
  const input = { agent_id, workspace_id };

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    set_loading(true);
    set_error("");
    const load = async () => {
      try {
        const result = await power.invoke<MemoryJobsPage>("memory.jobs", { agent_id, workspace_id, offset, limit: PAGE_SIZE });
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
  }, [agent_id, workspace_id, offset, power, revision, ui.revision]);

  useEffect(() => {
    if (!selected_id) { set_detail(undefined); return; }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    set_detail(undefined);
    set_reading(true);
    const load = async () => {
      try {
        const value = await power.invoke<MemoryJobDetail>("memory.job_detail", { agent_id, workspace_id, job_id: selected_id });
        if (disposed) return;
        set_detail(value);
        if (["queued", "running", "committing", "retry_wait"].includes(value.job.status)) timer = setTimeout(() => void load(), 3000);
      } catch (reason) { if (!disposed) set_error(error_message(reason)); }
      finally { if (!disposed) set_reading(false); }
    };
    void load();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [agent_id, workspace_id, power, selected_id, revision, ui.revision]);

  /** 重试只重新提交原 Job；返回状态不等同于提交成功。 */
  const retry = async (job_id: string) => {
    set_busy(true);
    set_error("");
    try {
      const result = await power.invoke<MemoryJobView>("memory.retry", { ...input, job_id });
      set_detail(undefined);
      set_reading(true);
      set_selected_id(result.job_id);
      set_revision((value) => value + 1);
      ui.toast({ type: "success", message: `处理状态：${STATUS_LABELS[result.status]}` });
    } catch (reason) { set_error(error_message(reason)); }
    finally { set_busy(false); }
  };

  return <Page>
    <Toolbar title="记忆处理记录" description="仅已提交表示保存完成；暂存差异和失败记录不能视为已生效。" actions={<Inline>
      <Button on_click={() => navigation.navigate({ ...navigation.route, view: "list" })}>返回记忆</Button>
      <Button disabled={loading || busy} on_click={() => set_revision((value) => value + 1)}>刷新</Button>
    </Inline>} />
    {error ? <Callout tone="danger">{error}</Callout> : null}
    {loading && !page ? <LoadingState label="正在读取处理记录…" /> : null}
    {page && !page.items.length ? <EmptyState title="还没有处理记录" description="会话提炼、修订和核心记忆整理的请求会显示在这里。" /> : null}
    {page?.items.length ? <Section title={`处理记录 · ${page.total}`}>
      <Group>{page.items.map((job) => <Row key={job.job_id}
        label={KIND_LABELS[job.kind]}
        description={`${job.target} · ${job.agent_id} · ${job.updated_at}${job.detail ? ` · ${job.detail}` : ""}`}
        trailing={<Status tone={job.status === "succeeded" ? "success" : job.status === "failed" ? "danger" : "muted"}>{STATUS_LABELS[job.status]}</Status>}
        on_click={() => set_selected_id(job.job_id)}
      />)}</Group>
      <Inline>
        <Button disabled={loading || offset === 0} on_click={() => { set_page(undefined); set_offset(Math.max(0, offset - PAGE_SIZE)); }}>上一页</Button>
        <Status>{offset + 1}–{offset + page.items.length} / {page.total}</Status>
        <Button disabled={loading || offset + PAGE_SIZE >= page.total} on_click={() => { set_page(undefined); set_offset(offset + PAGE_SIZE); }}>下一页</Button>
      </Inline>
    </Section> : null}
    {selected_id ? <Section title="处理详情">
      {!detail ? (reading ? <LoadingState label="正在读取详情…" /> : <EmptyState title="无法读取处理详情" description="请刷新后重试。" size="compact" />) : <Group>
        <Row label="Job ID" description={detail.job.job_id} />
        <Row label="状态" trailing={<Status>{STATUS_LABELS[detail.job.status]}</Status>} />
        <Row label="范围" description={`${detail.job.target} · ${detail.job.mode} · ${detail.job.agent_id}${detail.job.workspace_id ? ` · ${detail.job.workspace_id}` : ""}`} />
        {detail.job.session_id ? <Row label="Memory Session" description={detail.job.session_id} /> : null}
        {detail.job.detail ? <Row label="说明" description={detail.job.detail} /> : null}
        {detail.job.status === "succeeded" && detail.job.memory_ids?.length ? <Row label="提交结果" description={detail.job.memory_ids.join("、")} /> : null}
        <MemoryJobChanges key={`${detail.job.job_id}:${detail.job.session_id ?? ""}`} detail={detail} ui={ui} />
        {detail.job.status === "failed" && detail.job.kind !== "dream" ? <Row label="重新处理" trailing={<Button disabled={busy} on_click={() => void retry(detail.job.job_id)}>{busy ? "提交中…" : "重试"}</Button>} /> : null}
      </Group>}
    </Section> : null}
  </Page>;
}

/** 将宿主失败转换为可读文本，不把错误视为空列表。 */
function error_message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
