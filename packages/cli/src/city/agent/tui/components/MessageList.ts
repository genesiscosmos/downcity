/**
 * canonical Session Message 可滚动列表。
 *
 * 组件直接持有 SessionMessage 快照，并按 message_id、part_id 和 revision 应用实时
 * 更新，不定义第二套会话 DTO。本地 CLI 状态只能通过 TranscriptNotice 插入，不能
 * 伪装成 User、Assistant、Action 或 Error Message。
 */

import { type Component } from "@earendil-works/pi-tui";
import type {
  SessionAssistantMessage,
  SessionAssistantMessagePart,
  SessionMessage,
} from "@downcity/agent";

import { AssistantMessageComponent } from "@/city/agent/tui/components/AssistantMessage.js";
import { GutterContainer } from "@/city/agent/tui/components/GutterContainer.js";
import { NoticeMessageComponent } from "@/city/agent/tui/components/NoticeMessage.js";
import { StatusMessageComponent } from "@/city/agent/tui/components/StatusMessage.js";
import { UserMessageComponent } from "@/city/agent/tui/components/UserMessage.js";
import { CHROME_GUTTER } from "@/city/agent/tui/constant/rendering.js";
import type { TranscriptNotice } from "@/city/agent/tui/types/TranscriptNotice.js";

/** 消息流构造选项。 */
export interface MessageListOptions {
  /** 获取当前可视区高度，单位为终端行。 */
  get_viewport_height: () => number;
  /** 滚动位置变化回调，用于同步底部阅读状态。 */
  on_scroll_change?: (scroll_offset: number) => void;
}

/** 直接渲染 canonical Session Message 的可滚动消息流。 */
export class MessageListComponent implements Component {
  private inner = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  private items: Array<SessionMessage | TranscriptNotice> = [];
  private components = new Map<string, Component>();
  private scroll_offset = 0;
  private last_rendered_line_count = 0;
  private readonly get_viewport_height_fn: () => number;
  private readonly on_scroll_change?: MessageListOptions["on_scroll_change"];

  /** @param options 可视区与滚动状态依赖。 */
  constructor(options: MessageListOptions) {
    this.get_viewport_height_fn = options.get_viewport_height;
    this.on_scroll_change = options.on_scroll_change;
  }

  /** 当前滚动偏移；零表示跟随最新内容。 */
  get current_scroll_offset(): number {
    return this.scroll_offset;
  }

  /** 当前消息和本地提示总数。 */
  get item_count(): number {
    return this.items.length;
  }

  /** 使用完整历史快照替换消息流，内部 Message 不进入用户 Transcript。 */
  set_messages(messages: SessionMessage[]): void {
    this.items = messages
      .filter((message) => message.visibility === "visible")
      .map((message) => structuredClone(message))
      .sort((left, right) => left.sequence - right.sequence);
    this.rebuild_components();
    this.set_scroll_offset(0);
  }

  /** 添加或按 revision 更新一条完整 canonical Session Message。 */
  upsert_message(message: SessionMessage): void {
    if (message.visibility !== "visible") return;
    const index = this.items.findIndex(
      (item) => !is_transcript_notice(item) && item.message_id === message.message_id,
    );
    if (index < 0) {
      this.append_item(structuredClone(message));
      return;
    }

    const current = this.items[index];
    if (is_transcript_notice(current) || current.revision > message.revision) return;
    const next_message = structuredClone(message);
    this.items[index] = next_message;
    const component = this.components.get(message.message_id);
    if (
      next_message.type === "assistant" &&
      component instanceof AssistantMessageComponent
    ) {
      component.update_message(next_message);
      return;
    }
    this.rebuild_components();
  }

  /** 在所属 canonical Assistant Message 中新增或更新一个 Part 快照。 */
  upsert_assistant_part(
    message_id: string,
    part: SessionAssistantMessagePart,
    revision: number,
    updated_at: number,
  ): void {
    const message = this.get_assistant_message(message_id);
    if (!message || revision < message.revision) return;
    const exists = message.parts.some((item) => item.part_id === part.part_id);
    const parts = exists
      ? message.parts.map((item) =>
          item.part_id === part.part_id ? structuredClone(part) : item
        )
      : [...message.parts, structuredClone(part)];
    this.commit_assistant_message({
      ...message,
      revision,
      updated_at,
      parts: sort_assistant_parts(parts),
    });
  }

  /** 把文本增量追加到所属 canonical Assistant Text Part。 */
  append_assistant_delta(
    message_id: string,
    part_id: string,
    delta: string,
    revision: number,
    updated_at: number,
  ): void {
    const message = this.get_assistant_message(message_id);
    if (!message || revision < message.revision) return;
    const current_part = message.parts.find((part) => part.part_id === part_id);
    if (!current_part || current_part.type !== "text") return;
    this.upsert_assistant_part(message_id, {
      ...current_part,
      text: current_part.text + delta,
      state: "streaming",
    }, revision, updated_at);
  }

  /** 把 Tool 输入增量追加到所属 canonical Assistant Tool Part。 */
  append_tool_input_delta(
    message_id: string,
    part_id: string,
    tool_call_id: string,
    delta: string,
    revision: number,
    updated_at: number,
  ): void {
    const message = this.get_assistant_message(message_id);
    if (!message || revision < message.revision) return;
    const current_part = message.parts.find((part) => part.part_id === part_id);
    if (
      !current_part ||
      current_part.type !== "tool" ||
      current_part.tool_call_id !== tool_call_id ||
      current_part.state !== "input-streaming"
    ) return;
    this.upsert_assistant_part(message_id, {
      ...current_part,
      input_text: `${current_part.input_text || ""}${delta}`,
    }, revision, updated_at);
  }

  /** 添加一个只属于本地 TUI 生命周期的提示。 */
  add_notice(notice: TranscriptNotice): void {
    this.append_item({ ...notice });
  }

  /** 清空消息、提示和组件缓存。 */
  clear(): void {
    this.items = [];
    this.components.clear();
    this.inner.clear();
    this.set_scroll_offset(0);
  }

  /** 按行滚动；正数向上查看历史，负数向下返回最新内容。 */
  scroll_by(delta: number): void {
    this.set_scroll_offset(Math.max(0, this.scroll_offset + delta));
  }

  /** 回到消息流底部。 */
  scroll_to_bottom(): void {
    this.set_scroll_offset(0);
  }

  /** 在跟随最新内容和离开底部之间切换。 */
  toggle_follow_tail(): boolean {
    this.set_scroll_offset(this.scroll_offset === 0 ? 1 : 0);
    return this.scroll_offset === 0;
  }

  /** 渲染当前可视区内的消息行。 */
  render(width: number): string[] {
    const all_lines = this.inner.render(width);
    const viewport_height = this.get_viewport_height_fn();
    const line_count_delta = all_lines.length - this.last_rendered_line_count;
    this.last_rendered_line_count = all_lines.length;

    if (line_count_delta > 0 && this.scroll_offset > 0) {
      this.set_scroll_offset(this.scroll_offset + line_count_delta);
    }
    if (viewport_height <= 0 || all_lines.length <= viewport_height) {
      this.set_scroll_offset(0);
      return all_lines;
    }

    const maximum_offset = all_lines.length - viewport_height;
    this.set_scroll_offset(Math.min(this.scroll_offset, maximum_offset));
    const start = Math.max(
      0,
      all_lines.length - viewport_height - this.scroll_offset,
    );
    return all_lines.slice(start, start + viewport_height);
  }

  /** 通知内部组件主题已变化。 */
  invalidate(): void {
    this.inner.invalidate();
  }

  /** 获取当前 Message 快照中的 Assistant Message。 */
  private get_assistant_message(message_id: string): SessionAssistantMessage | null {
    const item = this.items.find(
      (candidate) =>
        !is_transcript_notice(candidate) && candidate.message_id === message_id,
    );
    return item && !is_transcript_notice(item) && item.type === "assistant"
      ? item
      : null;
  }

  /** 原位提交 Assistant Message，并更新已经挂载的角色组件。 */
  private commit_assistant_message(message: SessionAssistantMessage): void {
    const index = this.items.findIndex(
      (item) => !is_transcript_notice(item) && item.message_id === message.message_id,
    );
    if (index < 0) return;
    this.items[index] = message;
    const component = this.components.get(message.message_id);
    if (component instanceof AssistantMessageComponent) {
      component.update_message(message);
    }
  }

  /** 追加消息或提示，并保持当前滚动阅读位置。 */
  private append_item(item: SessionMessage | TranscriptNotice): void {
    this.items.push(item);
    const component = this.create_component(item);
    const id = is_transcript_notice(item) ? item.id : item.message_id;
    this.components.set(id, component);
    this.inner.addChild(component);
  }

  /** 从当前消息与提示快照重建展示组件。 */
  private rebuild_components(): void {
    this.components.clear();
    this.inner.clear();
    for (const item of this.items) {
      const component = this.create_component(item);
      const id = is_transcript_notice(item) ? item.id : item.message_id;
      this.components.set(id, component);
      this.inner.addChild(component);
    }
  }

  /** 为 canonical Message 或本地提示创建对应组件。 */
  private create_component(item: SessionMessage | TranscriptNotice): Component {
    if (is_transcript_notice(item)) {
      return item.kind === "local-error"
        ? new NoticeMessageComponent("Error", item.text)
        : new StatusMessageComponent(item.text);
    }
    switch (item.type) {
      case "user":
        return new UserMessageComponent(
          item.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join(""),
        );
      case "assistant":
        return new AssistantMessageComponent(item);
      case "action":
        return new StatusMessageComponent(
          [item.title, item.description, item.status].filter(Boolean).join(" · "),
        );
      case "error":
        return new NoticeMessageComponent("Error", item.message);
    }
  }

  /** 更新滚动位置并仅在值变化时通知外部状态栏。 */
  private set_scroll_offset(scroll_offset: number): void {
    if (this.scroll_offset === scroll_offset) return;
    this.scroll_offset = scroll_offset;
    this.on_scroll_change?.(scroll_offset);
  }
}

/** 判断列表项是否为本地提示而不是 canonical Session Message。 */
function is_transcript_notice(
  item: SessionMessage | TranscriptNotice,
): item is TranscriptNotice {
  return "kind" in item &&
    (item.kind === "local-status" || item.kind === "local-error");
}

/** 深拷贝并按 canonical sequence 排序 Assistant Parts。 */
function sort_assistant_parts(
  parts: SessionAssistantMessagePart[],
): SessionAssistantMessagePart[] {
  return parts
    .map((part) => structuredClone(part))
    .sort((left, right) => left.sequence - right.sequence);
}
