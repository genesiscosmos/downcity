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
  const job_id = typeof input.job_id === "string" ? input.job_id : "";
  useEffect(() => {
    let disposed = false;
    void power.invoke<MemoryJobDetail>("memory.records.detail", { job_id })
      .then((value) => { if (!disposed) { set_detail(value); set_error(""); } })
      .catch((reason) => { if (!disposed) set_error(String(reason)); });
    return () => { disposed = true; };
  }, [job_id, power, revision, ui.revision]);
  return <Page><Toolbar title="记忆处理记录" actions={<Button on_click={() => set_revision((value) => value + 1)}>刷新</Button>} />
    {error ? <Callout tone="danger">{error}</Callout> : detail ? <MemoryJobChanges detail={detail} ui={ui} /> : <LoadingState label="正在读取…" />}
  </Page>;
}
