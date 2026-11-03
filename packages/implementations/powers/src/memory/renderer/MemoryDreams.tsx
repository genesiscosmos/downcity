/** Memory 后台整理管理页：明确范围开关、可信纠错输入、积压和批次到 Job 的提交状态。 */
import { useCallback, useEffect, useState } from "react";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import type { MemoryDreamScope, MemoryDreamView } from "../types/MemoryDream.js";
import type { MemoryMainviewSnapshot } from "../types/MemoryMainview.js";

const DEFER_LABELS: Record<string, string> = {
  disabled: "已关闭", waiting_for_maintenance: "等待维护检查", empty: "没有新材料", source_error: "来源错误",
  explicit_request_priority: "等待显式请求完成", memory_busy: "Memory 正忙", daily_batch_budget: "每日计算额度用尽",
  cooldown_or_budget: "等待冷却或预算恢复", existing_batch_requires_reconciliation: "等待既有批次处理或重试",
};
const BATCH_LABELS: Record<string, string> = { planned: "已固定输入", queued: "等待或执行中", succeeded: "已提交", skipped: "无需变更", failed: "失败，输入保留" };

/** 使用宿主已有组件和范围网关，切换范围后父组件重新挂载，忽略旧请求。 */
export function memory_dreams({ power, navigation, ui }: PowerMainviewComponentProps) {
  const { Button, Callout, Field, Group, Inline, LoadingState, Page, Row, Section, Select, Status, Textarea, Toolbar } = ui.components;
  const agent_id = typeof navigation.route.agent_id === "string" ? navigation.route.agent_id : "";
  const workspace_id = typeof navigation.route.workspace_id === "string" ? navigation.route.workspace_id : "";
  const target = navigation.route.scope === "city" ? "current_workspace" : "agent";
  const scope: MemoryDreamScope = { agent_id, ...(workspace_id ? { workspace_id } : {}), target };
  const [view, set_view] = useState<MemoryDreamView>();
  const [snapshot, set_snapshot] = useState<MemoryMainviewSnapshot>();
  const [error, set_error] = useState("");
  const [busy, set_busy] = useState(false);
  const [content, set_content] = useState("");
  const [event_id, set_event_id] = useState(() => crypto.randomUUID());
  const [occurred_at, set_occurred_at] = useState(() => new Date().toISOString());

  const load = useCallback(async () => await power.invoke<MemoryDreamView>("memory.dream.status", { ...scope }), [power, agent_id, workspace_id, target]);

  useEffect(() => {
    let disposed = false;
    void power.invoke<MemoryMainviewSnapshot>("memory.snapshot", { agent_id, workspace_id, scope: navigation.route.scope ?? "agent" })
      .then((value) => { if (!disposed) set_snapshot(value); })
      .catch((reason) => { if (!disposed) set_error(error_text(reason)); });
    return () => { disposed = true; };
  }, [power, agent_id, workspace_id, target, ui.revision]);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const result = await load();
        if (!disposed) { set_view(result); set_error(""); }
      } catch (reason) { if (!disposed) set_error(error_text(reason)); }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => { disposed = true; clearInterval(timer); };
  }, [load, ui.revision]);

  /** 操作返回的是持久状态或接收回执，正文是否已提交由对应 Job 单独确认。 */
  const mutate = async (action: string, payload: Record<string, string | boolean>) => {
    set_busy(true); set_error("");
    try {
      await power.invoke(action, { ...scope, ...payload });
      set_view(await load());
      return true;
    } catch (reason) { set_error(error_text(reason)); return false; }
    finally { set_busy(false); }
  };

  return <Page>
    <Toolbar title="后台整理" description="只整理明确纠错与已验收结果。默认关闭；没有新材料不会调用模型。" actions={<Inline>
      <Button on_click={() => navigation.navigate({ ...navigation.route, view: "list" })}>返回记忆</Button>
      <Button on_click={ui.invalidate}>刷新</Button>
      <Button on_click={() => navigation.navigate({ ...navigation.route, view: "jobs" })}>处理结果</Button>
    </Inline>} />
    {error ? <Callout tone="danger">{error}</Callout> : null}
    {snapshot ? <Section title="执行范围">
      <Field label="Agent"><Select value={agent_id} disabled={busy} options={snapshot.agents.map((agent) => ({ value: agent.agent_id, label: agent.name }))}
        on_value_change={(value) => navigation.navigate({ ...navigation.route, agent_id: value })} /></Field>
      <Field label="Workspace"><Select value={workspace_id} disabled={busy} options={[{ value: "", label: "无项目" }, ...snapshot.workspaces.map((workspace) => ({ value: workspace.workspace_id, label: workspace.name }))]}
        on_value_change={(value) => navigation.navigate({ ...navigation.route, workspace_id: value })} /></Field>
      <Field label="知识归属"><Select value={target} disabled={busy} options={[{ value: "agent", label: "Agent 私有知识" }, { value: "current_workspace", label: "Workspace 共享知识" }]}
        on_value_change={(value) => navigation.navigate({ ...navigation.route, scope: value === "agent" ? "agent" : "city" })} /></Field>
    </Section> : null}
    {!view && !error ? <LoadingState label="读取后台整理状态…" /> : null}
    {view ? <>
      <Group label="自动整理">
        <Row label="当前范围" description={`${agent_id} · ${workspace_id || "无项目"} · ${target}`} />
        <Row label="开关" trailing={<Button disabled={busy} on_click={() => void mutate("memory.dream.configure", { enabled: !view.ledger.enabled })}>{view.ledger.enabled ? "关闭自动整理" : "启用此范围"}</Button>} />
        <Row label="调度" description={DEFER_LABELS[view.ledger.defer_reason ?? ""] ?? "等待维护检查"} trailing={<Status>{view.ledger.enabled ? "已启用" : "已关闭"}</Status>} />
        <Row label="未处理事实" description={`${view.backlog} 条 · 已接收 ${view.ledger.accepted_cursor} · 连续处理到 ${view.ledger.processed_watermark}`} />
        <Row label="今日计算额度" description={`${view.ledger.budget_day} · ${view.ledger.budget_used}/2 次 · 重试也占额度`} />
        {view.ledger.next_run_at ? <Row label="最早下次运行" description={view.ledger.next_run_at} /> : null}
        {view.ledger.last_error ? <Row label="最近错误" description={view.ledger.last_error} /> : null}
      </Group>
      <Section title="明确纠错" description={target === "current_workspace" ? "直接填写可在此项目共享的纠正事实与条件。提交表示允许项目共享。" : "直接填写需要纠正的事实、原因与适用条件。只进入当前 Agent 私有范围。"}>
        <Field label="纠错原文"><Textarea value={content} rows={4} on_value_change={(value) => { set_content(value); set_event_id(crypto.randomUUID()); set_occurred_at(new Date().toISOString()); }} /></Field>
        <Button variant="primary" disabled={busy || !content.trim()} on_click={() => void (async () => {
          if (await mutate("memory.dream.correction", { content, event_id, occurred_at, workspace_share_allowed: target === "current_workspace" })) {
            set_content(""); set_event_id(crypto.randomUUID()); set_occurred_at(new Date().toISOString());
            ui.toast({ type: "success", message: "纠错已接收，尚未提炼或提交" });
          }
        })()}>{target === "current_workspace" ? "提交项目共享纠错" : "提交纠错"}</Button>
      </Section>
      <Section title={`最近事实 · ${view.ledger.signals.length}`} description="Task 验收事实默认进入原 Agent 私有知识；失败和延期继续保留。">
        <Group>{view.ledger.signals.slice(-20).reverse().map((signal) => <Row key={signal.signal_id} label={`${signal.event_type} · ${signal.state}`}
          description={`${signal.event_id} · ${signal.occurred_at} · ${signal.source_boundary}${signal.source_error ? ` · ${signal.source_error}` : ""}`} />)}</Group>
      </Section>
      <Section title={`最近批次 · ${view.ledger.batches.length}`} description="已提交表示记忆提交完成；后台没有聊天接收方，不表示消息已投递。">
        <Group>{view.ledger.batches.slice(-10).reverse().map((batch) => {
          const job = view.jobs.find((item) => item.job_id === batch.job_id);
          return <Row key={batch.batch_id} label={BATCH_LABELS[batch.status]}
            description={`${batch.batch_id} · ${batch.signal_ids.length} 条事实 · ${batch.policy_version} · Job ${batch.job_id} · ${job?.status ?? (batch.owner_id === view.owner_id ? "本实例暂无 Job 记录" : "原 City 管理")}${batch.error ? ` · ${batch.error}` : ""}`}
            trailing={batch.status === "failed" && batch.owner_id === view.owner_id ? <Button disabled={busy || !view.ledger.enabled} on_click={() => void mutate("memory.dream.retry", { batch_id: batch.batch_id })}>重试原批次</Button> : undefined} />;
        })}</Group>
      </Section>
    </> : null}
  </Page>;
}

/** 展示真实错误，不把失败显示为无积压。 */
function error_text(error: unknown): string { return error instanceof Error ? error.message : String(error); }
