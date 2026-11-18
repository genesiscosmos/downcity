"use client";
/**
 * ChatInput 上方共用的状态面板：同一外壳从胶囊组向上展开为内容面板。
 * 底部分类与内容共用底色和圆角，按实测宽高过渡；内容保持完整宽度，避免文字随外壳挤压。
 * 内容高度由 ResizeObserver 跟随，分类切换、表单变化与队列增减均从当前高度平滑过渡。
 *
 * 展开状态属于当前会话，初始收起；新项目不改变用户选择。当前分类清空后
 * 立即收起，防止后续同类项目自动展开。收起和切换保留未提交表单，隐藏区域
 * 退出焦点与辅助技术访问；不同交互之间仍由交互卡片的 key 释放临时输入。
 * 这里只保存已提交交互的身份，不保存答案或私密值。
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { TbHierarchy2, TbListDetails, TbLoader2, TbMessageQuestion } from "react-icons/tb";
import { motion, useReducedMotion } from "framer-motion";
import { PillSwitcher } from "../pill-switcher";
import { ControlMessagesProvider, use_control_translation as use_translation } from "../../lib/control-messages";
import type { StatusPanelProps, StatusTab, StatusPillLabelProps } from "../../types/status-panel";
import { PendingInteractionArea } from "./PendingInteractionArea";
import { MessageQueue } from "./MessageQueue";
import { SubSessionList } from "./SubSessionList";

/** 统一分类计数、折叠、切换与内容生命周期，避免两类状态各自占用外层布局。 */
function StatusPanelContent<Address>({ queue, interactions, sub_sessions, error }: StatusPanelProps<Address>) {
  const translate = use_translation("chat");
  const panel_id = useId();
  const reduce_motion = useReducedMotion();
  const container_ref = useRef<HTMLElement>(null);
  const switcher_ref = useRef<HTMLDivElement>(null);
  const content_ref = useRef<HTMLDivElement>(null);
  const [content_height, set_content_height] = useState(0);
  const [available_width, set_available_width] = useState(0);
  const [pill_width, set_pill_width] = useState(0);
  const [selected_tab, set_selected_tab] = useState<StatusTab>("");
  // 收起时保留最后一个内容的布局，使高度能够完整过渡到零。
  const [display_tab, set_display_tab] = useState<StatusTab>("queue");
  const [submitted_keys, set_submitted_keys] = useState<ReadonlySet<string>>(() => new Set());
  const pending = interactions?.items.filter((item) => item.part.status === "pending"
    && !submitted_keys.has(item.key ?? item.part.interaction_id)) ?? [];
  const queue_count = queue?.queued_messages.length ?? 0;
  const interaction_count = pending.length;
  const sub_session_count = sub_sessions?.items.length ?? 0;
  const has_running_sub_session = sub_sessions?.items.some((item) => item.status === "working") ?? false;
  const counts = { queue: queue_count, interaction: interaction_count, sub_sessions: sub_session_count };
  const active_tab = selected_tab && counts[selected_tab] > 0 ? selected_tab : "";
  useEffect(() => {
    if (selected_tab && !active_tab) set_selected_tab("");
  }, [active_tab, selected_tab]);
  const has_content = Object.values(counts).some((count) => count > 0);
  useLayoutEffect(() => {
    const container = container_ref.current;
    const switcher = switcher_ref.current;
    if (!container || !switcher) return;
    const measure = () => {
      set_available_width(container.clientWidth);
      set_pill_width(switcher.offsetWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(switcher);
    return () => observer.disconnect();
  }, [has_content]);
  useLayoutEffect(() => {
    const content = content_ref.current;
    if (!content) return;
    const measure_height = () => set_content_height(content.getBoundingClientRect().height);
    // 切换提交后立即读取目标高度；后续异步内容和宽度变化由 observer 跟随。
    measure_height();
    const observer = new ResizeObserver(measure_height);
    observer.observe(content);
    return () => observer.disconnect();
  }, [has_content, display_tab, available_width]);
  if (!has_content) return null;
  const options = [
    ...(queue_count ? [{ value: "queue" as const, label: <StatusPillLabel icon={<TbListDetails />} label={translate("status_panel.queue")} count={queue_count} /> }] : []),
    ...(interaction_count ? [{ value: "interaction" as const, label: <StatusPillLabel icon={<TbMessageQuestion />} label={translate("status_panel.interaction")} count={interaction_count} /> }] : []),
    ...(sub_session_count ? [{ value: "sub_sessions" as const, label: <StatusPillLabel icon={has_running_sub_session ? <TbLoader2 className="animate-spin motion-reduce:animate-none" /> : <TbHierarchy2 />} label={translate("status_panel.sessions")} count={sub_session_count} /> }] : []),
  ];
  return <section ref={container_ref} className="chat-composer-context-row chat-status-panel flex flex-none flex-col items-start pt-2" aria-label={translate("status_panel.label")}>
    <div className="max-w-full overflow-hidden rounded-surface bg-control-track" style={{
      width: active_tab ? available_width || "100%" : pill_width ? Math.min(pill_width, available_width || pill_width) : "max-content",
      borderRadius: "1rem",
      transition: reduce_motion ? "none" : "width 0.18s ease-out",
    }}>
      <motion.div id={panel_id} initial={false}
        animate={{ height: active_tab ? content_height : 0, opacity: active_tab ? 1 : 0 }}
        transition={{ duration: reduce_motion ? 0 : 0.2, ease: "easeOut" }}
        aria-hidden={!active_tab} inert={!active_tab}
        className="overflow-hidden" style={{ width: available_width }}>
        <div ref={content_ref} className="flow-root">
          {/* 测量自然高度而非动画容器，避免高度过渡反过来触发测量循环。 */}
          <div hidden={display_tab !== "queue"}>{queue ? <MessageQueue {...queue} /> : null}</div>
          <div hidden={display_tab !== "interaction"}>
            {interactions ? <PendingInteractionArea items={pending} respond={async (input, private_question, item) => {
              await interactions.respond(input, private_question, item);
              set_submitted_keys((current) => new Set([...current, item.key ?? item.part.interaction_id]));
            }} /> : null}
            {error ? <p role="alert" className="px-3 pb-2 text-2xs text-destructive">{error}</p> : null}
          </div>
          <div hidden={display_tab !== "sub_sessions"}>{sub_sessions ? <SubSessionList {...sub_sessions} /> : null}</div>
        </div>
      </motion.div>
      {/* 使用可用宽度约束自然尺寸；折叠动画期间也不创建横向滚动区域。 */}
      <div ref={switcher_ref} className="w-max" style={{ maxWidth: available_width || "100%" }}>
        <PillSwitcher<StatusTab> value={active_tab} options={options} controlled_panel_id={panel_id}
          class_name="h-auto min-h-8 flex-wrap bg-transparent [&_[data-pill-option]]:max-w-full [&_[data-pill-option]]:overflow-hidden"
          aria_label={translate("status_panel.label")} on_value_change={(tab) => {
            set_display_tab(tab);
            set_selected_tab((current) => current === tab ? "" : tab);
          }} />
      </div>
    </div>
  </section>;
}

/** 分类胶囊共用图标、名称与数量 tag；收起和展开采用相同布局。 */
function StatusPillLabel({ icon, label, count }: StatusPillLabelProps) {
  return <span className="inline-flex min-w-0 items-center gap-1.5">
    <span aria-hidden="true" className="flex shrink-0 items-center [&_svg]:size-3.5">{icon}</span>
    <span className="min-w-0 truncate">{label}</span>
    <span className="shrink-0 rounded-full bg-surface-emphasis px-1.5 py-0.5 text-3xs font-medium leading-none text-muted-foreground tabular-nums">{count}</span>
  </span>;
}

/** 独用时接收宿主文案；组合时继承上层文案。 */
export function StatusPanel<Address>(props: StatusPanelProps<Address>) {
  return <ControlMessagesProvider translate={props.translate}><StatusPanelContent key={props.session_key} {...props} /></ControlMessagesProvider>;
}
