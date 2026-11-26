/** 活动资源直接打开固定 Job 详情；不把处理身份转换成记忆对象身份。 */
import { useEffect, useState } from "react";
import type { PowerViewComponentProps } from "@downcity/city/power/react";
import type { MemoryJobDetail } from "../types/MemoryJob.js";
import { memory_job_changes as MemoryJobChanges } from "./MemoryJobDetail.js";

/** 宿主详情 action 重新校验 Job 权限，仅展示固定 before/after。 */
export function memory_job_resource({ input, power, ui }: PowerViewComponentProps) {
  const { Page, Toolbar, Callout, LoadingState, Button } = ui.components;
  const [detail, set_detail] = useState<MemoryJobDetail>();
  const [error, set_error] = useState("");
  const [revision, set_revision] = useState(0);
  const [busy, set_busy] = useState(false);
  const job_id = typeof input.job_id === "string" ? input.job_id : "";
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const value = await power.invoke<MemoryJobDetail>("memory.records.detail", { job_id });
        if (disposed) return;
        set_detail(value); set_error("");
        if (["queued", "running", "committing", "retry_wait"].includes(value.job.status)) timer = setTimeout(() => void load(), 3000);
      } catch (reason) { if (!disposed) set_error(String(reason)); }
    };
    void load();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [job_id, power, revision, ui.revision]);
  const retry = async () => {
    set_busy(true); set_error("");
    try { await power.invoke("memory.records.retry", { job_id }); set_revision((value) => value + 1); ui.invalidate(); }
    catch (reason) { set_error(String(reason)); }
    finally { set_busy(false); }
  };
  return <Page><Toolbar title="记忆处理记录" actions={<Button on_click={() => set_revision((value) => value + 1)}>刷新</Button>} />
    {detail?.job.status === "failed" ? <Button disabled={busy} on_click={() => void retry()}>重试</Button> : null}
    {error ? <Callout tone="danger">{error}</Callout> : detail ? <MemoryJobChanges detail={detail} ui={ui} /> : <LoadingState label="正在读取…" />}
  </Page>;
}
