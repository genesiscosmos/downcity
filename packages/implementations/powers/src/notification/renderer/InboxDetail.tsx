/** Inbox单项详情：问题原地处理、更新阅读、完成确认和来源展开；不复制交互业务状态。 */
import { useEffect, useRef, useState } from "react";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import type { RespondSessionInteractionInput } from "@downcity/type";
import type { InboxEntry } from "../types/Inbox.js";
import type { NotificationRendererOptions } from "../types/NotificationRenderer.js";
import { InboxStore } from "./InboxStore.js";
import { use_inbox } from "./InboxContext.js";
import { full_time, has_private_questions, inbox_entries, kind_label } from "./InboxEntries.js";
import { InboxIcon } from "./InboxIcon.js";

/** 每张详情按稳定来源挂载，刷新不重建表单，切换时清除临时输入。 */
export function InboxDetail({ store, options, ...props }: PowerMainviewComponentProps & {
  /** Sidebar与Mainview共用的UI状态。 */ store: InboxStore;
  /** 宿主原交互表单与来源导航能力。 */ options: NotificationRendererOptions;
}) {
  const { state, view, choose } = use_inbox(store, props);
  const selected = state.selected[view];
  const entries = inbox_entries(state.data, view);
  const error = state.error || (state.data && (state.data.unavailable_agents.length || state.data.unavailable_groups.length)
    ? "部分来源暂时不可达，已保留当前内容。" : "");
  return <div className="inbox-detail-shell">
    {error ? <div className="inbox-connection" role="status"><span>{error}</span><button type="button" onClick={() => void store.refresh_sources()}>重试</button></div> : null}
    {state.loading ? <div className="inbox-detail-skeleton" role="status" aria-label="正在读取详情"><i /><i /><i /></div> : !selected ? <div className="inbox-empty">
      <InboxIcon kind="inbox" /><h2>{error ? "暂时无法读取收件箱" : view === "pending" ? "暂时没有需要你处理的事" : "工作更新会显示在这里"}</h2>
      <p>{error ? "恢复连接后重试，原请求不会因此结束。" : view === "pending" ? "Agent 需要你的回答或授权时，会出现在左侧。" : "选中一条更新，查看结果和来源。"}</p>
    </div> : <InboxEntryDetail key={selected.key} entry={selected} current={entries.find((item) => item.key === selected.key)}
      handled={state.handled.has(selected.key)} store={store} options={options} props={props}
      unavailable={!!state.error || !!state.data?.unavailable_agents.includes(selected.pending?.agent_id ?? "")}
      next={entries.find((item) => item.key !== selected.key)} choose={choose} />}
    {!state.loading && selected && !entries.length && state.handled.has(selected.key) ? <div className="inbox-queue-finished"><InboxIcon kind="check" />当前待处理事项已清空</div> : null}
  </div>;
}

/** 单个请求的草稿仅由原表单保存，Store只知道是否修改。 */
function InboxEntryDetail({ entry, current, handled, store, options, props, next, choose, unavailable }: {
  /** 来源暂时不可达时不将缺失请求误判为已解决。 */ unavailable: boolean;
  /** 稳定选择项；请求失效后也可继续说明原因。 */ entry: InboxEntry;
  /** 最新列表中仍存在的原项，缺失表示已在其他入口处理。 */ current?: InboxEntry;
  /** 当前界面是否成功完成了该交互。 */ handled: boolean;
  /** 共享展示状态。 */ store: InboxStore;
  /** 复用的宿主表单与导航。 */ options: NotificationRendererOptions;
  /** 当前宿主接口，仍由原Session验证提交。 */ props: PowerMainviewComponentProps;
  /** 用户确认后选择的下一项。 */ next?: InboxEntry;
  /** 带草稿确认的选择动作。 */ choose: (entry: InboxEntry) => Promise<void>;
}) {
  const { Markdown, Button } = props.ui.components;
  const [error, set_error] = useState("");
  const [opening, set_opening] = useState(false);
  const [read_error, set_read_error] = useState(false);
  const reading = useRef(new Set<number>());
  const active = current ?? entry;
  const item = active.pending;
  const invalid = entry.view === "pending" && (!current || !item?.interaction.can_respond);
  const read = async () => {
    const update = active.update;
    if (!update || reading.current.has(update.created_at)) return;
    reading.current.add(update.created_at);
    try {
      await store.mark_read(update.notification_id, update.created_at);
      set_read_error(false);
      props.ui.invalidate();
    } catch { set_read_error(true); }
    finally { reading.current.delete(update.created_at); }
  };
  useEffect(() => {
    // 只有聚焦且实际展示的具体详情才已读；后台挂载不消费未读。
    const read_visible = () => {
      if (!document.hidden && document.hasFocus() && active.update && current?.unread) void read();
    };
    read_visible();
    window.addEventListener("focus", read_visible);
    document.addEventListener("visibilitychange", read_visible);
    return () => {
      window.removeEventListener("focus", read_visible);
      document.removeEventListener("visibilitychange", read_visible);
    };
  }, [entry.key, active.update?.created_at, current?.unread]);
  const submit = async (input: RespondSessionInteractionInput, private_question = false) => {
    if (!item || invalid || handled || unavailable) throw new Error("这个请求已失效，请刷新后查看原会话。");
    if (input.interaction_id !== item.interaction.reference.interaction_id) throw new Error("交互来源不匹配");
    store.busy(entry.key);
    try {
      if (private_question || has_private_questions(item)) {
        if (!options.submit_private) throw new Error("当前宿主没有私密提交入口");
        await options.submit_private(item, input);
      } else {
        await props.power.invoke("notification.respond", { agent_id: item.agent_id,
          reference: { ...item.interaction.reference }, response: { ...input.response } });
      }
      store.handled(entry);
      void store.refresh();
      props.ui.invalidate();
    } finally { store.busy(undefined); }
  };
  const open = async () => {
    if (opening) return;
    if (store.get_snapshot().busy_key) return;
    if (store.get_snapshot().dirty_key && !await props.ui.confirm({ title: "离开未提交的回答？", description: "查看来源会清除当前填写的内容。", action: "清除并查看" })) return;
    store.clear_dirty();
    set_opening(true); set_error("");
    try {
      if (entry.pending) await options.open_interaction?.(entry.pending);
      else if (entry.update) await options.open_notification?.(entry.update);
    } catch (reason) { set_error(reason instanceof Error ? reason.message : String(reason)); }
    finally { set_opening(false); }
  };
  const request = item?.interaction.interaction.request;
  const payload = request?.payload;
  const questions = payload && typeof payload === "object" && !Array.isArray(payload) && Array.isArray(payload.questions) ? payload.questions : [];
  const first_question = questions[0];
  const same_title = questions.length === 1 && first_question && typeof first_question === "object" && !Array.isArray(first_question) && first_question.question === entry.title;
  const availability = active.pending?.availability ?? active.update?.availability;
  const source_notice = availability === "archived" ? "来源已归档，通知摘要仍然保留。"
    : availability === "removed" ? "来源已移除，通知记录仍然保留。"
      : availability === "unknown" ? "来源身份未知或暂时不可达；已保留内容，无法确认是否可打开。" : "";
  const can_open = availability === "available" && (entry.pending ? !!options.open_interaction : !!entry.update?.target && !!options.open_notification);
  return <article className="inbox-detail" aria-labelledby="inbox-detail-title">
    <header className="inbox-detail-header">
      <div className="inbox-eyebrow"><InboxIcon kind={entry.kind} /><span>{kind_label(entry.kind)}</span></div>
      <h1 id="inbox-detail-title">{entry.title}</h1>
      <div className="inbox-detail-meta"><span className="inbox-source">{entry.source}</span><span aria-hidden="true">·</span><time dateTime={new Date(entry.created_at).toISOString()}>{full_time(entry.created_at)}</time>
        {can_open ? <button type="button" className="inbox-source-link" disabled={opening} onClick={() => void open()}>{opening ? "正在打开…" : entry.pending ? "查看原会话 ↗" : "查看结果 ↗"}</button> : null}
      </div>
    </header>
    {source_notice ? <p className="inbox-detail-note" role="status">{source_notice}</p> : null}
    {active.update ? <p className="inbox-detail-note">{active.update.outcome === "failure" ? "执行失败" : active.update.outcome === "success" ? "执行成功" : "状态更新"}</p> : null}
    {error ? <div className="inbox-inline-error" role="alert">{error}</div> : null}
    {handled ? <div className="inbox-resolution" role="status"><InboxIcon kind="check" /><div><h2>已处理</h2><p>你的回应已送回原会话。</p>{next ? <Button on_click={() => void choose(next)}>处理下一项</Button> : null}</div></div>
      : unavailable ? <div className="inbox-resolution" role="status"><InboxIcon kind="inbox" /><div><h2>暂时无法连接原会话</h2><p>请求状态尚未确认，请重试连接后继续处理。</p></div></div>
      : invalid ? <div className="inbox-resolution" role="status"><InboxIcon kind="inbox" /><div><h2>{current ? "原执行已不可响应" : "这个请求已结束"}</h2><p>{current ? "已保留请求内容，请查看原会话了解执行状态。" : "它已在其他入口处理或随原执行取消。"}</p>{next ? <Button on_click={() => void choose(next)}>查看下一项</Button> : null}</div></div>
        : item ? <div className="inbox-form" data-question-is-title={!!same_title}
          onChange={() => store.dirty(entry.key)}>
          {options.render_interaction ? options.render_interaction(item, submit) : <p className="inbox-detail-note">请在支持交互表单的宿主中回应此请求。</p>}
        </div> : <div className="inbox-result">
          {active.update?.body ? <Markdown text={active.update.body} /> : <p className="inbox-detail-note">工作状态已更新，可打开来源查看详情。</p>}
          {read_error ? <p className="inbox-inline-error" role="status">暂未标为已读。<button type="button" onClick={() => void read()}>重试</button></p> : null}
        </div>}
    {entry.pending ? <details className="inbox-origin"><summary>来源详情</summary><dl><dt>Agent</dt><dd>{active.source}</dd><dt>Session</dt><dd>{entry.pending.interaction.reference.session_id}</dd><dt>执行</dt><dd>{entry.pending.interaction.reference.turn_id}</dd></dl></details> : null}
  </article>;
}
