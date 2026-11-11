/** Inbox单项详情：问题原地处理、更新阅读、完成确认和来源展开；不复制交互业务状态。 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import type { RespondSessionInteractionInput } from "@downcity/type";
import type { InboxEntry } from "../types/Inbox.js";
import type { NotificationRendererOptions } from "../types/NotificationRenderer.js";
import { InboxStore } from "./InboxStore.js";
import { full_time, has_private_questions } from "./InboxEntries.js";
import { InboxIcon } from "./InboxIcon.js";
import { InboxAvatar } from "./InboxAvatar.js";
import { InboxAttention } from "./InboxAttention.js";

/**
 * 单项详情按稳定来源挂载，刷新保留原表单草稿；列表选择、返回确认和可见性由父级控制。
 * 交互仍复用宿主表单与提交入口，Store仅记录草稿和忙碌状态，不保存回答内容。
 */
export function InboxEntryDetail({ entry, current, handled, store, options, props, next, choose, unavailable, on_close, can_read }: {
  /** 来源暂时不可达时不将缺失请求误判为已解决。 */ unavailable: boolean;
  /** 稳定选择项；请求失效后也可继续说明原因。 */ entry: InboxEntry;
  /** 最新列表中仍存在的原项，缺失表示已在其他入口处理。 */ current?: InboxEntry;
  /** 当前界面是否成功完成了该交互。 */ handled: boolean;
  /** 共享展示状态。 */ store: InboxStore;
  /** 复用的宿主表单与导航。 */ options: NotificationRendererOptions;
  /** 当前宿主接口，仍由原Session验证提交。 */ props: PowerMainviewComponentProps;
  /** 用户确认后选择的下一项。 */ next?: InboxEntry;
  /** 带草稿确认的选择动作。 */ choose: (entry: InboxEntry) => Promise<void>;
  /** 关闭详情，由父级提供现有草稿确认。 */ on_close: () => Promise<void>;
  /** 只有实际可见的详情允许自动已读，由主视图控制。 */ can_read: boolean;
}) {
  const { Markdown, Button } = props.ui.components;
  const title_id = useId();
  const [error, set_error] = useState("");
  const [opening, set_opening] = useState(false);
  const [read_error, set_read_error] = useState(false);
  const reading = useRef(new Set<string>());
  const read_attempts = useRef(new Set<string>());
  const submitting = useRef(false);
  const active = current ?? entry;
  const item = active.pending;
  const invalid = entry.view === "pending" && (!current || !item?.interaction.can_respond);
  const notification_id = active.update?.notification_id;
  const update_created_at = active.update?.created_at;
  const read = useCallback(async (retry = false) => {
    if (!can_read || notification_id === undefined || update_created_at === undefined) return;
    const read_key = JSON.stringify([notification_id, update_created_at]);
    if (reading.current.has(read_key) || (!retry && read_attempts.current.has(read_key))) return;
    // 每个通知版本仅自动尝试一次；失败保留手动重试，避免刷新或焦点事件反复请求。
    read_attempts.current.add(read_key);
    reading.current.add(read_key);
    try {
      await store.mark_read(notification_id, update_created_at);
      set_read_error(false);
      props.ui.invalidate();
    } catch { set_read_error(true); }
    finally { reading.current.delete(read_key); }
  }, [can_read, notification_id, update_created_at, store, props.ui]);
  useEffect(() => {
    // 只有聚焦且实际展示的具体详情才已读；后台挂载不消费未读。
    const read_visible = () => {
      if (can_read && !document.hidden && document.hasFocus() && current?.unread) void read();
    };
    read_visible();
    window.addEventListener("focus", read_visible);
    document.addEventListener("visibilitychange", read_visible);
    return () => {
      window.removeEventListener("focus", read_visible);
      document.removeEventListener("visibilitychange", read_visible);
    };
  }, [can_read, current?.unread, read]);
  const submit = async (input: RespondSessionInteractionInput, private_question = false) => {
    if (!item || invalid || handled || unavailable) throw new Error("这个请求已失效，请刷新后查看原会话。");
    if (input.interaction_id !== item.interaction.reference.interaction_id) throw new Error("交互来源不匹配");
    if (submitting.current || store.get_snapshot().busy_key) throw new Error("正在提交，请稍候。");
    submitting.current = true;
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
    } finally {
      submitting.current = false;
      store.busy(undefined);
    }
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
  const availability = active.pending?.availability ?? active.update?.availability;
  const source_notice = availability === "archived" ? "来源已归档，通知摘要仍然保留。"
    : availability === "removed" ? "来源已移除，通知记录仍然保留。"
      : availability === "unknown" ? "来源身份未知或暂时不可达；已保留内容，无法确认是否可打开。" : "";
  const can_open = availability === "available" && (entry.pending ? !!options.open_interaction : !!entry.update?.target && !!options.open_notification);
  return <article className="inbox-detail" aria-labelledby={title_id}>
    <header className="inbox-detail-header">
      <div className="inbox-detail-heading">
        <h1 id={title_id} className="inbox-detail-title">{active.title}</h1>
        <Button size="icon" title="关闭详情" aria_label="关闭详情" on_click={() => void on_close()}><InboxIcon kind="close" /></Button>
      </div>
      <div className="inbox-detail-meta">
        <span className="inbox-source"><InboxAvatar entry={active} size="detail" options={options} />{active.source}</span>
        <time dateTime={new Date(active.created_at).toISOString()}>{full_time(active.created_at)}</time>
        {!handled && (item || active.update?.outcome === "failure") ? <span className="inbox-detail-status">{item && unavailable ? "暂不可响应" : invalid ? current ? "已中断" : "已结束" : <InboxAttention entry={active} options={options} presentation="status" />}</span> : null}
      </div>
      {can_open ? <div className="inbox-detail-actions"><Button disabled={opening} on_click={() => void open()}>{opening ? "正在打开…" : entry.pending ? "查看原会话 ↗" : "查看结果 ↗"}</Button></div> : null}
    </header>
    {source_notice ? <p className="inbox-detail-note" role="status">{source_notice}</p> : null}
    {error ? <div className="inbox-inline-error" role="alert">{error}</div> : null}
    {handled ? <div className="inbox-resolution" role="status"><InboxIcon kind="check" /><div><h2>已处理</h2><p>你的回应已送回原会话。</p>{next ? <Button on_click={() => void choose(next)}>处理下一项</Button> : null}</div></div>
      : item && unavailable ? <div className="inbox-resolution" role="status"><InboxIcon kind="inbox" /><div><h2>暂时无法连接原会话</h2><p>请求状态尚未确认，请重试连接后继续处理。</p></div></div>
      : invalid ? <div className="inbox-resolution" role="status"><InboxIcon kind="inbox" /><div><h2>{current ? "原执行已不可响应" : "这个请求已结束"}</h2><p>{current ? "已保留请求内容，请查看原会话了解执行状态。" : "它已在其他入口处理或随原执行取消。"}</p>{next ? <Button on_click={() => void choose(next)}>查看下一项</Button> : null}</div></div>
        : item ? <div className="inbox-form" onChange={() => store.dirty(entry.key)}>
          {options.render_interaction ? options.render_interaction(item, submit, { title_id, title: active.title }) : <p className="inbox-detail-note">请在支持交互表单的宿主中回应此请求。</p>}
        </div> : <div className="inbox-result">
          {active.update?.body?.trim() ? <Markdown text={active.update.body} /> : null}
          {read_error ? <p className="inbox-inline-error" role="status">暂未标为已读。<button type="button" onClick={() => void read(true)}>重试</button></p> : null}
        </div>}
    {entry.pending ? <details className="inbox-origin"><summary>来源详情</summary><dl><dt>Agent</dt><dd>{active.source}</dd><dt>Session</dt><dd>{entry.pending.interaction.reference.session_id}</dd><dt>执行</dt><dd>{entry.pending.interaction.reference.turn_id}</dd></dl></details> : null}
  </article>;
}
