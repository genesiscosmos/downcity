/** 完整 canonical 活动块：共享分组、摘要、图标、懒详情与只读交互历史。 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { TbArrowDownLeft } from "react-icons/tb";
import { ActivityIcon } from "./activity-icon";
import type { AgentActivityPart } from "../types/chat-blocks";
import type { ActivityHost } from "../types/activity-host";
import type { ActivityRowSummary } from "../types/activity-row";
import type { AgentActivityPresentation, AgentActivityVisualKind } from "../types/activity";
import type { ActivityProps } from "../types/activity-props";
import { ControlMessagesProvider, use_control_translation } from "../lib/control-messages";
import { resolve_agent_action_presentation, resolve_agent_reasoning_presentation, resolve_agent_tool_presentation } from "../lib/activity/agent_activity_presentation";
import { activity_call_failed, activity_error_original } from "../lib/activity/activity_error";
import { bounded_text, object_value, redact_private, read_input } from "../lib/activity/activity_detail_shared";
import { read_tool_detail } from "../lib/activity/tool-detail";
import { normalize_reasoning_markdown } from "../lib/activity/normalize_reasoning_markdown";
import { ActivityFlow } from "./activity-flow";
import { ActivityRow } from "./activity-row";
import { ActivityReadableDetailView } from "./activity-readable";
import { DetailContent } from "./detail-content";
import { MarkdownView } from "./markdown/MarkdownView";
import { MarkdownViewProvider } from "./markdown/markdown_host_context";

const activity_host_context = createContext<ActivityHost | undefined>(undefined);
/** 为完整 ChatPanel 注入一次宿主能力；单独 Activity 也可直接接收 host。 */
export function ActivityProvider({ host, children }: { /** 领域能力，不持有网络或业务执行。 */ host?: ActivityHost; /** 需要继承领域能力的消息树。 */ children: ReactNode }) {
  return <activity_host_context.Provider value={host}>{children}</activity_host_context.Provider>;
}
/** 可直接从 @downcity/ui 挂载，不需要 Desktop 或 Power 注册表。 */
export function Activity(props: ActivityProps) {
  return <ControlMessagesProvider translate={props.translate}><ActivityContent {...props} /></ControlMessagesProvider>;
}

/** 分组与每行正文均继承相同的宿主文案。 */
function ActivityContent({ parts, host: explicit_host }: ActivityProps) {
  const inherited_host = useContext(activity_host_context);
  const host = explicit_host ?? inherited_host;
  const translate = use_control_translation("chat");
  const power_names = useMemo(() => new Set(host?.powers?.keys() ?? []), [host?.powers]);
  const icon_for = (kind: AgentActivityVisualKind, power_name?: string) => {
    const custom = host?.render_icon?.(kind, power_name);
    if (custom !== undefined) return custom;
    const url = power_name ? host?.powers?.get(power_name)?.icon_url : undefined;
    return <ActivityIcon kind={kind} power_name={power_name} icon_url={url} />;
  };
  const from_presentation = (presentation: AgentActivityPresentation, group: boolean): ActivityRowSummary => ({
    icon: presentation.visual_kind === "reasoning" ? null : icon_for(presentation.visual_kind),
    tone: presentation.tone, diff_stat: presentation.diff_stat,
    state: presentation.visual_kind === "reasoning" ? "" : translate(presentation.state_key, presentation.state_values),
    identity: presentation.visual_kind === "reasoning" ? "" : presentation.file_path && !group
      ? host?.render_file?.(presentation.file_path, presentation.summary) ?? presentation.summary : presentation.summary,
    summary: presentation.visual_kind === "reasoning" ? presentation.summary : "",
    render_body: group || !presentation.read_detail && !presentation.error ? undefined : () => {
      const detail = presentation.read_detail?.();
      return <DetailContent class_name="activity-tool-detail">
        {detail?.type === "reasoning" ? <MarkdownViewProvider text_size={host?.reasoning_text_size}><MarkdownView layout="embedded" text={normalize_reasoning_markdown(detail.text)} mode={presentation.input_streaming ? "streaming" : "static"} /></MarkdownViewProvider>
          : detail?.type === "readable" ? <ActivityReadableDetailView detail={detail} streaming={presentation.input_streaming} />
          : detail?.type === "code" ? <pre>{detail.text}</pre> : null}
        {presentation.error ? <p role="alert">{redact_private(presentation.error)}</p> : null}
      </DetailContent>;
    },
  });
  const describe = (part: AgentActivityPart, group = false): ActivityRowSummary | null => {
    const custom = host?.describe?.(part, group);
    if (custom !== undefined) {
      if (!custom || group || part.type !== "tool" || !part.interactions?.length) return custom;
      const render_domain = custom.render_body;
      return { ...custom, render_body: () => <>{render_domain?.()}<DetailContent class_name="activity-tool-detail">{part.interactions!.map(item => <p key={item.interaction_id}>{item.request.title || item.request.type} · {translate(`interaction.${item.status}`)}</p>)}</DetailContent></> };
    }
    if (part.type === "reasoning") { const presentation = resolve_agent_reasoning_presentation(part); return presentation.read_detail ? from_presentation(presentation, group) : null; }
    if (part.type === "action") return from_presentation(resolve_agent_action_presentation(part), group);
    if (part.type === "input") {
      const key = part.kind === "shell_result" ? "command_result" : part.kind === "delegation_result" ? "work_result" : part.kind === "power_result" ? "background_result" : part.kind === "tool_media" ? "attachment" : "message";
      return { icon: <TbArrowDownLeft className="activity-tool-icon" />, incoming: true, tone: "complete", diff_stat: null,
        state: "", identity: translate(`runtime_input.${key}`), summary: "",
        render_body: group ? undefined : () => <DetailContent class_name="activity-tool-detail">{part.content.map((item, index) => item.type === "file"
          ? <span key={index}>{item.filename || item.url}</span>
          : item.type === "text" ? <pre key={index}>{redact_private(bounded_text(item.text))}</pre>
          : item.type === "context" ? <div key={index}><small>{item.tag}</small><pre>{redact_private(bounded_text(item.context))}</pre></div> : null)}</DetailContent>,
      };
    }
    const presentation = resolve_agent_tool_presentation(part, power_names);
    const failed = activity_call_failed(part);
    const pending = part.state !== "completed" && part.state !== "failed" && (part.state === "waiting-user" || part.interactions?.some(item => item.status === "pending"));
    const row = from_presentation(presentation, group);
    const power = presentation.tool_identity?.kind === "power" ? presentation.tool_identity : undefined;
    if (power) {
      row.icon = icon_for("power", power.power_name);
      row.identity = host?.powers?.get(power.power_name)?.title ?? power.power_name;
      row.summary = power.action_name;
      row.state = pending ? translate("activity.waiting_confirmation") : translate(part.state === "completed" ? "activity.power.completed" : "activity.power.running", { action: power.action_name || power.power_name });
    }
    if (pending) { row.tone = "waiting"; row.state = translate("activity.waiting_confirmation"); }
    if (failed) { row.tone = "failed"; row.state = translate(`activity.${presentation.visual_kind}.failed`, { action: power?.action_name || part.tool_name }); }
    if (group) return row;
    if (failed) row.render_body = () => <DetailContent class_name="activity-tool-detail"><p role="alert">{redact_private(bounded_text(part.error || String(object_value(part.output)?.message || object_value(part.output)?.error || translate("activity.error_detail.tool_failed", { tool: part.tool_name }))))}</p>{part.input_text && part.input === undefined ? <pre>{redact_private(bounded_text(part.input_text))}</pre> : null}<ActivityErrorOriginal original={activity_error_original(part)} /></DetailContent>;
    else if (host?.show_tool_details !== false && !power && !row.render_body && (part.input !== undefined || part.input_text || part.output !== undefined)) row.render_body = () => {
      const detail = read_tool_detail(part);
      if (detail) return <DetailContent class_name="activity-tool-detail"><ActivityReadableDetailView detail={detail} streaming={presentation.input_streaming} /></DetailContent>;
      return <DetailContent class_name="activity-tool-detail">
      {part.input !== undefined || part.input_text ? <><small>{translate("activity.input")}</small><pre>{redact_private(bounded_text(part.input_text && part.input === undefined ? part.input_text : safe_value(part.input)))}</pre></> : null}
      {part.output !== undefined ? <><small>{translate("activity.output")}</small><pre>{redact_private(bounded_text(safe_value(part.output)))}</pre></> : null}
      {part.interactions?.map(item => <p key={item.interaction_id}>{item.request.title || item.request.type} · {translate(`interaction.${item.status}`)}</p>)}
    </DetailContent>;
    };
    if (!row.render_body && part.interactions?.length) row.render_body = () => <DetailContent class_name="activity-tool-detail">{part.interactions!.map(item => <p key={item.interaction_id}>{item.request.title || item.request.type} · {translate(`interaction.${item.status}`)}</p>)}</DetailContent>;
    if (part.state === "input-streaming") row.summary = `${read_input(part, ["file_path", "path", "query"])} · ${translate("activity.received_characters", { count: String(part.input_text?.length ?? 0) })}`;
    return row;
  };
  const visible = parts.filter(part => describe(part, true) !== null);
  const Row = host?.row_component;
  return <ActivityFlow parts={visible} summarize={part => describe(part, true)!} render_item={part => {
    const props = { ...describe(part)!, show_chevron: part.type !== "reasoning" };
    return Row ? <Row {...props} display_key={part.part_id} display_kind={part.type === "input" ? "input.detail.expanded" : `activity.${part.type}.expanded`} /> : <ActivityRow {...props} />;
  }} render_group={(props, id) => Row ? <Row {...props} display_key={id} display_kind="activity.group.expanded" /> : <ActivityRow {...props} />} />;
}
/** 未知工具只在展开后序列化，结构化内容保持有界。 */
function safe_value(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2) ?? ""; } catch { return String(value); }
}
/** 原始错误只由显式复制动作读取剪贴板，不把原文堆栈放入可见正文。 */
function ActivityErrorOriginal({ original }: { /** 已经脱敏的错误原文；缺失时没有复制入口。 */ original?: string }) {
  const translate = use_control_translation("chat");
  const [copy_state, set_copy_state] = useState<"idle" | "copied" | "failed">("idle");
  if (!original) return null;
  return <button type="button" className="activity-error-copy" onClick={() => {
    void navigator.clipboard.writeText(redact_private(original)).then(() => set_copy_state("copied")).catch(() => set_copy_state("failed"));
  }}>{translate(copy_state === "copied" ? "activity.error_detail.copied" : copy_state === "failed" ? "activity.error_detail.copy_failed" : "activity.error_detail.copy")}</button>;
}
