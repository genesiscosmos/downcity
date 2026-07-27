/**
 * city agent chat TUI 协调器。
 *
 * 关键点（中文）
 * - 使用 header → transcript → approval → editor → command → footer 的稳定操作台布局。
 * - transcript 支持方向键、分页键与鼠标滚轮回看历史。
 * - 编辑器负责消费标准快捷键（Ctrl+C/D/O/S），再回调 coordinator。
 * - header 展示 Session 上下文，footer 只展示当前可执行操作与滚动状态。
 */

import {
  ProcessTerminal,
  TUI,
  type Component,
} from "@earendil-works/pi-tui";

import {
  AgentHeaderComponent,
  ChatEditorComponent,
  ChatFooterComponent,
  CommandHelpPanelComponent,
  InlinePanelSlotComponent,
  QueuedMessagesComponent,
} from "@/city/agent/tui/components/index.js";
import { MessageListComponent } from "@/city/agent/tui/components/MessageList.js";
import { QueuedInputQueue } from "@/city/agent/tui/controllers/QueuedInputQueue.js";
import { SessionPickerComponent } from "@/city/agent/tui/dialogs/SessionPicker.js";
import { ApprovalPanelComponent } from "@/city/agent/tui/dialogs/ApprovalDialog.js";
import { PiTuiChatRenderer } from "@/city/agent/tui/PiTuiChatRenderer.js";
import type { AgentChatSessionSummaryView } from "@/city/agent/AgentChatTypes.js";
import type { AgentChatInteractiveRendererPort } from "@/city/types/AgentChatInteractive.js";
import type { SessionMessage } from "@downcity/agent";
import type {
  AgentChatApprovalView,
  AppState,
} from "@/city/agent/tui/types.js";
import {
  dispatchSlashCommand,
  resolveSlashCommandInput,
  type SlashCommandHost,
} from "@/city/agent/tui/commands/index.js";
import {
  resolve_transcript_scroll_delta,
  TRANSCRIPT_MOUSE_TRACKING_DISABLE,
  TRANSCRIPT_MOUSE_TRACKING_ENABLE,
} from "@/city/agent/tui/controllers/TranscriptNavigation.js";

/**
 * 协调器构造选项。
 */
export interface AgentChatTuiCoordinatorOptions {
  /** 目标 agent id。 */
  agent_id: string;
  /** 初始 session id。 */
  session_id: string;
  /** 列出远程 session。 */
  list_sessions: () => Promise<AgentChatSessionSummaryView[]>;
  /** 创建新 session。 */
  create_session: () => Promise<{ session_id: string }>;
  /**
   * 加载指定 session 的历史记录。
   *
   * 关键点（中文）
   * - 返回可读标题与 canonical Session Message 快照。
   * - coordinator 在进入或切换 session 时调用。
   */
  load_session_history: (session_id: string) => Promise<{
    title: string;
    messages: SessionMessage[];
  }>;
  /** 执行一轮对话。 */
  run_turn: (input: {
    session_id: string;
    message: string;
    interactive_renderer: AgentChatInteractiveRendererPort;
  }) => Promise<{
    success: boolean;
    error?: string;
    emitted_visible_text: boolean;
    text?: string;
  }>;

  /** 批准 unrestricted sandbox 审批请求。 */
  respond_interaction: (
    session_id: string,
    interaction_id: string,
    decision: "approved" | "denied",
  ) => Promise<{ status: "resolved" | "expired" | "cancelled" }>;
}

/**
 * Agent chat TUI 协调器。
 */
export class AgentChatTuiCoordinator {
  private readonly options: AgentChatTuiCoordinatorOptions;
  private readonly terminal: ProcessTerminal;
  private readonly tui: TUI;
  private readonly header: AgentHeaderComponent;
  private readonly footer: ChatFooterComponent;
  private readonly message_list: MessageListComponent;
  private readonly editor: ChatEditorComponent;
  private readonly queued_messages: QueuedMessagesComponent;
  private readonly approval_panel: InlinePanelSlotComponent;
  private readonly command_panel: InlinePanelSlotComponent;
  private readonly input_queue = new QueuedInputQueue();
  private app_state: AppState;
  private current_session_id: string;
  private running = false;
  private stopped = false;
  private resolve_run: (() => void) | null = null;
  private remove_input_listener: (() => void) | null = null;
  private command_panel_loading = false;
  private draining_input_queue = false;

  /**
   * 待处理的 unrestricted sandbox 审批请求队列。
   * 当模型并行发起多个需要审批的 tool call 时，依次弹出选择器。
   */
  private approval_queue: AgentChatApprovalView[] = [];

  /** 已接收的审批 ID，避免同一 part 快照重复展示。 */
  private readonly received_approval_ids = new Set<string>();

  /**
   * slash 命令宿主，解耦命令分发与 coordinator 内部实现。
   */
  private get slash_command_host(): SlashCommandHost {
    return {
      is_streaming: this.app_state.is_executing,
      send_normal_user_input: async (text: string) => {
        await this.run_message_sequence(text);
      },
      show_error: (text: string) => {
        this.add_error_message(text);
      },
      show_help: () => {
        this.show_command_help();
      },
      clear_transcript: () => {
        this.message_list.clear();
      },
      create_new_session: async () => {
        await this.create_new_session();
      },
      show_session_picker: async () => {
        await this.show_session_picker();
      },
      approve: async (approval_id) => {
        await this.approve(approval_id);
      },
      deny: async (approval_id) => {
        await this.deny(approval_id);
      },
      stop: async () => {
        await this.stop();
      },
    };
  }

  /**
   * @param options 协调器选项。
   */
  constructor(options: AgentChatTuiCoordinatorOptions) {
    this.options = options;
    this.current_session_id = options.session_id;
    this.app_state = {
      agent_id: options.agent_id,
      session_id: options.session_id,
      session_title: undefined,
      is_executing: false,
      queued_message_count: 0,
      transcript_scroll_offset: 0,
    };

    this.terminal = new ProcessTerminal();
    this.tui = new TUI(this.terminal);
    this.terminal.setTitle(this.build_title());

    this.editor = new ChatEditorComponent(this.tui);
    this.header = new AgentHeaderComponent(this.app_state);
    this.footer = new ChatFooterComponent(this.app_state);
    this.queued_messages = new QueuedMessagesComponent();
    this.approval_panel = new InlinePanelSlotComponent();
    this.command_panel = new InlinePanelSlotComponent();

    this.message_list = new MessageListComponent({
      get_viewport_height: () => this.get_message_list_viewport_height(),
      on_scroll_change: (scroll_offset) => {
        this.app_state.transcript_scroll_offset = scroll_offset;
      },
    });

    this.editor.on_submit = (text) => {
      void this.handle_user_input(text);
    };
    this.editor.on_ctrl_c = () => {
      void this.stop();
    };
    this.editor.on_ctrl_d = () => {
      void this.stop();
    };
    this.editor.on_ctrl_s = () => {
      void this.stop();
    };
    this.editor.on_up_arrow_empty = () => {
      const recalled = this.input_queue.recall_latest();
      if (recalled) {
        this.editor.set_text(recalled.text);
        this.sync_input_queue_state();
        this.request_render();
        return true;
      }
      this.scroll_transcript(3);
      return true;
    };
    this.editor.on_down_arrow_empty = () => {
      this.scroll_transcript(-3);
      return true;
    };
  }

  /**
   * 启动 TUI 并进入事件循环。
   *
   * @param options 启动选项。
   * @returns TUI 停止后 resolve。
   */
  async run(): Promise<void> {
    if (this.running || this.stopped) {
      return;
    }
    this.running = true;

    // 两个交互槽位进入正常布局流：审批在输入框上方，命令交互在输入框下方。
    this.tui.addChild(this.header as Component);
    this.tui.addChild(this.message_list as Component);
    this.tui.addChild(this.approval_panel as Component);
    this.tui.addChild(this.queued_messages as Component);
    this.tui.addChild(this.editor as Component);
    this.tui.addChild(this.command_panel as Component);
    this.tui.addChild(this.footer as Component);
    this.tui.setFocus(this.editor as Component);

    this.remove_input_listener = this.tui.addInputListener((data) =>
      this.handle_global_input(data),
    );

    // 先加载当前 session 历史，再启动 TUI；帮助提示已下沉到 footer，不再占用 transcript。
    await this.load_history(this.current_session_id);

    this.tui.start();
    this.terminal.write(TRANSCRIPT_MOUSE_TRACKING_ENABLE);

    return await new Promise<void>((resolve) => {
      this.resolve_run = resolve;
    });
  }

  /** 入队并尝试显示输入框上方的 unrestricted sandbox 审批面板。 */
  private show_approval_panel(params: {
    approval_id: string;
    tool_name: string;
    cmd: string;
    cwd: string;
    reason: string;
  }): void {
    if (this.stopped || this.received_approval_ids.has(params.approval_id)) return;
    this.received_approval_ids.add(params.approval_id);
    this.approval_queue.push({
      session_id: this.current_session_id,
      ...params,
    });
    this.ensure_approval_panel();
  }

  /** 当前没有审批面板且队列非空时，显示下一个请求。 */
  private ensure_approval_panel(): void {
    if (this.approval_panel.is_active || this.stopped || this.approval_queue.length === 0) {
      return;
    }

    const params = this.approval_queue[0];
    const panel = new ApprovalPanelComponent({
      approval_id: params.approval_id,
      tool_name: params.tool_name,
      cmd: params.cmd,
      cwd: params.cwd,
      reason: params.reason,
      on_decide: (decision) => {
        this.hide_approval_panel();
        void this.respond_approval_panel(params, decision);
      },
    });

    this.command_panel.clear();
    this.approval_panel.show(panel);
    this.tui.setFocus(this.approval_panel as Component);
    this.request_render();
  }

  /** 隐藏当前审批面板并从队列移除当前请求。 */
  private hide_approval_panel(): void {
    if (this.approval_panel.is_active) this.approval_queue.shift();
    this.approval_panel.clear();
    this.tui.setFocus(this.editor as Component);
    this.request_render();
  }

  /**
   * 批准指定审批请求。
   */
  private async approve(approval_id?: string): Promise<void> {
    const target_id = String(approval_id || "").trim();
    if (!target_id) {
      this.add_error_message("Usage: /approve <approval_id>");
      this.request_render();
      return;
    }
    await this.submit_approval_decision(target_id, "approve");
    this.request_render();
  }

  /**
   * 拒绝指定审批请求。
   */
  private async deny(approval_id?: string): Promise<void> {
    const target_id = String(approval_id || "").trim();
    if (!target_id) {
      this.add_error_message("Usage: /deny <approval_id>");
      this.request_render();
      return;
    }
    await this.submit_approval_decision(target_id, "deny");
    this.request_render();
  }

  /**
   * 提交面板决策；失败时将请求放回队首，避免 Agent 永久等待。
   */
  private async respond_approval_panel(
    approval: AgentChatApprovalView,
    decision: "approve" | "deny",
  ): Promise<void> {
    const success = await this.submit_approval_decision(
      approval.approval_id,
      decision,
      approval.session_id,
    );
    if (!success && !this.stopped) this.approval_queue.unshift(approval);
    this.ensure_approval_panel();
    this.request_render();
  }

  /**
   * 向远端 Shell runtime 提交审批决策。
   *
   * @returns 是否成功命中并完成 pending approval。
   */
  private async submit_approval_decision(
    approval_id: string,
    decision: "approve" | "deny",
    session_id = this.current_session_id,
  ): Promise<boolean> {
    try {
      const result = await this.options.respond_interaction(
        session_id,
        approval_id,
        decision === "approve" ? "approved" : "denied",
      );
      if (result.status === "resolved") return true;
      this.add_error_message(`Failed to ${decision} ${approval_id}`);
    } catch (error) {
      this.add_error_message(this.format_error(error));
    }
    return false;
  }

  /**
   * 停止 TUI 并清理资源。
   */
  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.hide_session_picker();
    this.hide_approval_panel();
    this.remove_input_listener?.();
    this.terminal.write(TRANSCRIPT_MOUSE_TRACKING_DISABLE);
    this.tui.stop();
    this.resolve_run?.();
  }

  /**
   * 请求重新渲染。
   */
  private request_render(): void {
    if (this.stopped) {
      return;
    }
    this.tui.requestRender();
  }

  /**
   * 计算消息流当前可用的可视高度。
   */
  private get_message_list_viewport_height(): number {
    const width = this.terminal.columns;
    const header_lines = this.header.render(width).length;
    const approval_lines = this.approval_panel.render(width).length;
    const queued_messages_lines = this.queued_messages.render(width).length;
    const editor_lines = this.editor.render(width).length;
    const command_lines = this.command_panel.render(width).length;
    const footer_lines = this.footer.render(width).length;
    return Math.max(
      1,
      this.terminal.rows
        - header_lines
        - approval_lines
        - queued_messages_lines
        - editor_lines
        - command_lines
        - footer_lines,
    );
  }

  /**
   * 处理用户输入。
   *
   * @param raw_text 原始输入文本。
   */
  private async handle_user_input(raw_text: string): Promise<void> {
    if (this.stopped) {
      return;
    }

    const text = String(raw_text || "").trim();
    if (!text) {
      this.editor.clear();
      this.request_render();
      return;
    }

    this.editor.clear();
    this.message_list.scroll_to_bottom();

    const intent = resolveSlashCommandInput({
      input: text,
      is_streaming: this.app_state.is_executing,
    });

    if (this.app_state.is_executing && (intent.kind === "not-command" || intent.kind === "message")) {
      this.input_queue.enqueue(intent.input);
      this.sync_input_queue_state();
      this.request_render();
      return;
    }

    if (
      intent.kind === "builtin" ||
      intent.kind === "blocked" ||
      intent.kind === "invalid"
    ) {
      await dispatchSlashCommand(this.slash_command_host, intent);
      this.request_render();
      return;
    }

    if (intent.kind === "message") {
      await this.run_message_sequence(intent.input);
      return;
    }

    await this.run_message_sequence(text);
  }

  /**
   * 执行一条立即消息，并在成功后按 FIFO 消费本地排队输入。
   *
   * @param message 要立即发送的用户消息。
   */
  private async run_message_sequence(message: string): Promise<void> {
    const success = await this.run_turn(message);
    if (success) {
      await this.drain_input_queue();
      return;
    }
    this.drop_queued_messages();
  }

  /**
   * 执行一轮对话。
   *
   * @param message 用户消息。
   */
  private async run_turn(message: string): Promise<boolean> {
    this.app_state.is_executing = true;
    this.header.set_state(this.app_state);
    this.footer.set_state(this.app_state);
    this.message_list.scroll_to_bottom();
    this.request_render();

    const renderer = new PiTuiChatRenderer(
      this.message_list,
      () => this.request_render(),
      (params) => {
        this.show_approval_panel(params);
      },
    );
    const outcome = await this.options.run_turn({
      session_id: this.current_session_id,
      message,
      interactive_renderer: renderer,
    });

    this.app_state.is_executing = false;
    this.header.set_state(this.app_state);
    this.footer.set_state(this.app_state);

    if (!outcome.success) {
      this.add_error_message(outcome.error || "agent chat failed");
    } else if (!outcome.emitted_visible_text) {
      this.add_status_message("[no visible reply]");
    }

    this.request_render();
    return outcome.success;
  }

  /**
   * 在前一轮成功后按 FIFO 执行本地排队消息。
   *
   * 关键点（中文）：执行中的新 Enter 会继续追加到同一队列，当前循环自然在后续迭代中消费。
   */
  private async drain_input_queue(): Promise<void> {
    if (this.draining_input_queue || this.stopped || this.app_state.is_executing) return;

    this.draining_input_queue = true;
    try {
      while (!this.stopped) {
        const queued_input = this.input_queue.take_next();
        if (!queued_input) return;
        this.sync_input_queue_state();
        const success = await this.run_turn(queued_input.text);
        if (!success) {
          this.drop_queued_messages();
          return;
        }
      }
    } finally {
      this.draining_input_queue = false;
    }
  }

  /**
   * 丢弃当前未发送的本地消息，并在 transcript 中留下可见原因。
   */
  private drop_queued_messages(): void {
    const dropped_inputs = this.input_queue.clear();
    this.sync_input_queue_state();
    if (dropped_inputs.length <= 0 || this.stopped) return;
    this.add_error_message(
      `Dropped ${dropped_inputs.length} queued message${dropped_inputs.length === 1 ? "" : "s"} because the previous turn failed.`,
    );
    this.request_render();
  }

  /** 同步队列数量、队列预览与依赖该状态的固定区域。 */
  private sync_input_queue_state(): void {
    this.app_state.queued_message_count = this.input_queue.count;
    this.queued_messages.set_queued_inputs(this.input_queue.items);
    this.header.set_state(this.app_state);
    this.footer.set_state(this.app_state);
  }

  /** 在输入框下方显示 Session 选择器。 */
  private async show_session_picker(): Promise<void> {
    if (!this.can_open_command_panel()) return;
    this.command_panel_loading = true;

    let sessions: AgentChatSessionSummaryView[] = [];
    try {
      sessions = await this.options.list_sessions();
    } catch (error) {
      this.add_error_message(this.format_error(error));
      this.request_render();
      return;
    } finally {
      this.command_panel_loading = false;
    }
    if (this.stopped || this.approval_panel.is_active) return;

    const picker = new SessionPickerComponent({
      sessions,
      current_session_id: this.current_session_id,
      on_select: (result) => {
        this.hide_session_picker();
        if (result.kind === "create") {
          void this.create_new_session();
        } else if (result.session_id) {
          void this.switch_session(result.session_id);
        }
      },
      on_cancel: () => {
        this.hide_session_picker();
      },
    });

    this.command_panel.show(picker);
    this.tui.setFocus(this.command_panel as Component);
    this.request_render();
  }

  /** 隐藏 Session 选择器。 */
  private hide_session_picker(): void {
    this.hide_command_panel();
  }

  /** 在输入框下方显示 Slash 命令帮助。 */
  private show_command_help(): void {
    if (!this.can_open_command_panel()) return;
    this.command_panel.show(
      new CommandHelpPanelComponent(() => this.hide_command_panel()),
    );
    this.tui.setFocus(this.command_panel as Component);
    this.request_render();
  }

  /** 判断当前是否允许打开输入框下方交互面板。 */
  private can_open_command_panel(): boolean {
    return !this.stopped
      && !this.command_panel_loading
      && !this.command_panel.is_active
      && !this.approval_panel.is_active;
  }

  /** 清空输入框下方面板并恢复编辑器焦点。 */
  private hide_command_panel(): void {
    this.command_panel.clear();
    this.tui.setFocus(this.editor as Component);
    this.request_render();
  }

  /**
   * 创建新 session 并切换视图。
   */
  private async create_new_session(): Promise<void> {
    this.add_status_message("Creating session...");
    this.request_render();

    try {
      const created = await this.options.create_session();
      await this.switch_session(created.session_id);
    } catch (error) {
      this.add_error_message(this.format_error(error));
      this.request_render();
    }
  }

  /**
   * 切换到指定 session。
   *
   * @param session_id 目标 session id。
   */
  private async switch_session(session_id: string): Promise<void> {
    this.current_session_id = session_id;
    this.received_approval_ids.clear();
    this.app_state.session_id = session_id;
    this.app_state.session_title = undefined;
    this.header.set_state(this.app_state);
    this.footer.set_state(this.app_state);
    this.terminal.setTitle(this.build_title());
    this.message_list.clear();

    await this.load_history(session_id);

    this.add_status_message(`Agent chat · ${this.app_state.agent_id} · ${session_id}`);
    this.request_render();
  }

  /**
   * 加载指定 session 的历史记录并更新标题。
   *
   * @param session_id 目标 session id。
   */
  private async load_history(session_id: string): Promise<void> {
    try {
      const { title, messages } = await this.options.load_session_history(session_id);
      this.app_state.session_title = title;
      this.header.set_state(this.app_state);
      this.footer.set_state(this.app_state);
      this.terminal.setTitle(this.build_title());
      this.message_list.set_messages(messages);
      this.message_list.scroll_to_bottom();
    } catch (error) {
      this.add_error_message(`Failed to load history: ${this.format_error(error)}`);
    }
  }

  /**
   * 添加状态提示。
   *
   * @param text 状态文本。
   */
  private add_status_message(text: string): void {
    this.message_list.add_notice({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "local-status",
      text,
      created_at: Date.now(),
    });
  }

  /**
   * 添加错误提示。
   *
   * @param text 错误文本。
   */
  private add_error_message(text: string): void {
    this.message_list.add_notice({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "local-error",
      text,
      created_at: Date.now(),
    });
  }

  /**
   * 全局键盘输入处理。
   *
   * @param data pi-tui 输入数据。
   * @returns 是否消费该输入。
   */
  private handle_global_input(data: string): { consume: boolean } | undefined {
    if (this.approval_panel.is_active || this.command_panel.is_active) {
      return undefined;
    }

    const page_size = Math.max(1, this.get_message_list_viewport_height() - 1);
    const scroll_delta = resolve_transcript_scroll_delta(data, page_size);
    if (scroll_delta === null) return undefined;
    this.scroll_transcript(scroll_delta);
    return { consume: true };
  }

  /**
   * 滚动 transcript 并触发界面刷新。
   *
   * @param delta 正数查看历史，负数返回最新内容。
   */
  private scroll_transcript(delta: number): void {
    this.message_list.scroll_by(delta);
    this.footer.set_state(this.app_state);
    this.request_render();
  }

  /**
   * 构建终端标题。
   */
  private build_title(): string {
    const title = this.app_state.session_title?.trim() || "Untitled";
    return `Agent chat · ${this.app_state.agent_id} · ${title} · ${this.current_session_id}`;
  }

  /**
   * 格式化错误对象。
   *
   * @param error 错误对象。
   * @returns 错误文本。
   */
  private format_error(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

}
