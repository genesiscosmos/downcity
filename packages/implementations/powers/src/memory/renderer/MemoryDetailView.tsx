/** 记忆独立详情：直接读取目标记忆，修订与删除不依赖列表，tab 生命周期由宿主管理。 */
import { useEffect, useRef, useState } from "react";
import type { PowerViewComponentProps } from "@downcity/city/power/react";
import type { PowerJsonObject } from "@downcity/city/power";
import type { MemoryMainviewMutationResult, MemoryMainviewReadResult } from "@/memory/types/MemoryMainview.js";

/** 更换资源身份时重建详情状态，避免在不同 Agent 或范围之间复用旧正文。 */
export function memory_detail_view(props: PowerViewComponentProps) {
  const { scope, agent_id, workspace_id, memory_id } = props.input;
  return <Memory_detail key={JSON.stringify([scope, agent_id, workspace_id, memory_id])} {...props} />;
}

/** 直接围绕目标资源读写；已删除状态优先于刷新结果，避免继续请求已删除的资源。 */
function Memory_detail({ input, power, ui }: PowerViewComponentProps) {
  const { Button, Callout, EmptyState, Field, Group, Inline, LoadingState, Markdown, Page, Row, Section, Status, Textarea, Toolbar } = ui.components;
  const scope = input.scope === "city" ? "city" : "agent";
  const agent_id = read_string(input.agent_id);
  const workspace_id = read_string(input.workspace_id);
  const memory_id = read_string(input.memory_id);
  const [detail, set_detail] = useState<MemoryMainviewReadResult>();
  const [draft, set_draft] = useState("");
  const [reading, set_reading] = useState(true);
  const [read_revision, set_read_revision] = useState(0);
  const [busy, set_busy] = useState(false);
  const busy_ref = useRef(false);
  const [revising, set_revising] = useState(false);
  const [deleted, set_deleted] = useState(false);
  const [error, set_error] = useState("");

  useEffect(() => {
    if (deleted) return;
    let disposed = false;
    if (!memory_id || (scope === "agent" ? !agent_id : !workspace_id)) {
      set_error(!memory_id ? "缺少记忆标识" : scope === "agent" ? "缺少 Agent 标识" : "缺少 Workspace 标识");
      set_reading(false);
      return;
    }
    set_reading(true);
    void power.invoke<MemoryMainviewReadResult>("memory.read", { scope, agent_id, workspace_id, memory_id })
      .then((value) => { if (!disposed) { set_detail(value); set_error(""); } })
      .catch((reason) => { if (!disposed) set_error(to_error_message(reason)); })
      .finally(() => { if (!disposed) set_reading(false); });
    return () => { disposed = true; };
  }, [agent_id, deleted, memory_id, power, read_revision, scope, workspace_id, ui.revision]);

  /** 只消费写入结果；列表刷新由宿主失效通知驱动，不主动枚举列表。 */
  const mutate = async (action_id: string, payload: PowerJsonObject, message: string) => {
    if (busy_ref.current || deleted) return;
    busy_ref.current = true;
    set_busy(true);
    set_error("");
    try {
      const result = await power.invoke<MemoryMainviewMutationResult>(action_id, { scope, agent_id, workspace_id, memory_id, ...payload });
      if (!result.operation_success) throw new Error(result.error || "操作失败");
      if (action_id === "memory.forget") {
        set_deleted(true);
        set_detail(undefined);
      }
      set_draft("");
      set_revising(false);
      ui.invalidate();
      ui.toast({ type: "success", message: result.message || message });
    } catch (reason) {
      const message_value = to_error_message(reason);
      set_error(message_value);
      ui.toast({ type: "error", message: message_value });
    } finally {
      busy_ref.current = false;
      set_busy(false);
    }
  };

  const forget = async () => {
    if (!detail?.found || busy_ref.current || deleted) return;
    if (!await ui.confirm({ title: `删除「${detail.title || memory_id}」？`, description: "该记忆会从当前范围永久删除，证据记录会保留。", action: "删除", destructive: true })) return;
    await mutate("memory.forget", {}, "记忆已删除");
  };

  const retry_action = <Button disabled={reading || busy} on_click={() => set_read_revision((value) => value + 1)}>{reading ? "读取中…" : "重试"}</Button>;
  if (deleted) return <Page><EmptyState title="记忆已删除" /></Page>;
  if (!detail) return <Page>{error ? <>
    <Toolbar actions={retry_action} />
    <Callout tone="danger">{error}</Callout>
  </> : <LoadingState label="正在读取记忆…" />}</Page>;
  const scope_label = scope === "city" ? "共享" : "Agent 私有";
  return <Page>
    {error ? <Callout tone="danger">{error}</Callout> : null}
    <Toolbar title={detail.found ? detail.title || memory_id : "记忆不存在"} description={detail.found ? memory_id : detail.error} actions={<Inline>
      {error || !detail.found ? retry_action : null}
      {detail.found ? <><Button disabled={busy} on_click={() => { set_revising((value) => !value); set_draft(""); }}>{revising ? "取消修订" : "修订"}</Button>
      <Button variant="destructive" disabled={busy} on_click={() => void forget()}>删除</Button></> : null}
    </Inline>} />
    {detail.found ? <Group>
      <Row label="类型" trailing={<Status>{type_label(detail.memory_type ?? "")}</Status>} />
      <Row label="范围" trailing={<Status>{scope_label}</Status>} />
      <Row label="观察时间" trailing={<Status>{detail.observed_at ?? ""}</Status>} />
      <Row label="引用" trailing={<Status>{detail.citation ?? memory_id}</Status>} />
      {detail.source_ids?.length ? <Row label="证据" trailing={<Status>{detail.source_ids.length} 条</Status>} /> : null}
    </Group> : null}
    {revising ? <Section title="修订" description="描述要如何修改这条记忆。">
      <Field label="修订指令"><Textarea value={draft} rows={4} placeholder="例如：把默认语言从 JavaScript 改为 TypeScript。" on_value_change={set_draft} /></Field>
      <Inline><Button variant="primary" disabled={busy || !draft.trim()} on_click={() => void mutate("memory.revise", { instruction: draft.trim() }, "修订请求已提交，请查看处理记录")}>{busy ? "修订中…" : "提交修订"}</Button></Inline>
    </Section> : null}
    <Section title="内容">
      {reading ? <LoadingState label="正在读取记忆…" /> : detail.content ? <Markdown text={detail.content} /> : <EmptyState title="没有可显示的内容" size="compact" />}
    </Section>
  </Page>;
}

/** 返回记忆分类的用户可见名称，与记忆列表保持一致。 */
function type_label(memory_type: string): string {
  return ({ fact: "事实", preference: "偏好", decision: "决策", episode: "经历", procedure: "流程", document: "文档" } as Record<string, string>)[memory_type] ?? memory_type;
}

/** 仅接受 JSON 输入中的字符串，缺失身份由视图显式报告。 */
function read_string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 将读取或写入失败转换为用户可见消息。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
