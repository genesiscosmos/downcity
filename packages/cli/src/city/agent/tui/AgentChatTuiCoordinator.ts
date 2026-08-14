/**
 * city agent chat TUI 协调器。
 *
 * 关键点（中文）
 * - 使用 header → transcript → interaction → editor → command → footer 的稳定操作台布局。
 * - transcript 支持方向键、分页键与鼠标滚轮回看历史。
 * - 编辑器负责消费标准快捷键（Ctrl+C/D/O/S），再回调 coordinator。
 * - header 展示 Session 上下文，footer 只展示当前可执行操作与滚动状态。
 */

import { type Component } from "@earendil-works/pi-tui";
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
import { StreamingUIController } from "@/city/agent/tui/controllers/StreamingUI.js";
import { ChatSessionSubscription } from "@/city/agent/tui/controllers/ChatSessionSubscription.js";
import { ChatModelController } from "@/city/agent/tui/controllers/ChatModelController.js";
import { ChatSecurityController } from "@/city/agent/tui/controllers/ChatSecurityController.js";
import { SessionPickerComponent } from "@/city/agent/tui/dialogs/SessionPicker.js";
import { ApprovalPanelComponent } from "@/city/agent/tui/dialogs/ApprovalDialog.js";
import { QuestionPanelComponent } from "@/city/agent/tui/dialogs/QuestionDialog.js";
import { SecurityPolicyPanelComponent } from "@/city/agent/tui/dialogs/SecurityPolicyDialog.js";
import type {
  AgentChatPendingInteractionView,
  AgentChatSessionSummaryView,
} from "@/city/agent/AgentChatTypes.js";
import {
  createRemoteChatSession,
  listRemoteChatSessions,
} from "@/city/agent/AgentChatRemote.js";
import type {
  SessionInteractionRequest,
  SessionInteractionResponse,
  SessionMutation,
} from "@downcity/agent";
import type { ChatSessionSnapshot } from "@/city/types/ChatSessionSubscription.js";
import type {
  AgentChatTuiAction,
  AgentChatTuiCoordinatorOptions,
  AgentChatTuiResult,
} from "@/city/types/AgentChatTui.js";
import type { AppState } from "@/city/agent/tui/types.js";
import {
  dispatchSlashCommand,
  resolveSlashCommandInput,
  type SlashCommandHost,
} from "@/city/agent/tui/commands/index.js";
import { resolve_transcript_scroll_delta } from "@/city/agent/tui/controllers/TranscriptNavigation.js";
import { build_attachment_tags } from "@/city/agent/tui/attachments/AttachmentInput.js";
import { read_clipboard_attachment_paths } from "@/city/agent/tui/attachments/ClipboardAttachment.js";
import { pick_native_files } from "@/city/agent/tui/attachments/NativeFilePicker.js";
import { AlternateScreenTerminal } from "@/shared/tui/AlternateScreenTerminal.js";
import { FullScreenTui } from "@/shared/tui/FullScreenTui.js";
/**
 * Agent chat TUI 协调器。
 */
export class AgentChatTuiCoordinator {
  private readonly options: AgentChatTuiCoordinatorOptions;
  private readonly terminal: AlternateScreenTerminal;
  private readonly tui: FullScreenTui;
  private readonly header: AgentHeaderComponent;
  private readonly footer: ChatFooterComponent;
  private readonly message_list: MessageListComponent;
  private readonly streaming_ui: StreamingUIController;
  private readonly session_subscription: ChatSessionSubscription;
  private readonly model_controller: ChatModelController;
  private readonly security_controller: ChatSecurityController;
  private readonly editor: ChatEditorComponent;
  private readonly queued_messages: QueuedMessagesComponent;
  private readonly interaction_panel: InlinePanelSlotComponent;
  private readonly command_panel: InlinePanelSlotComponent;
  private readonly input_queue = new QueuedInputQueue();
  private app_state: AppState;
  private current_session_id: string;
  private running = false;
  private stopped = false;
  private resolve_run: ((result: AgentChatTuiResult) => void) | null = null;
  private remove_input_listener: (() => void) | null = null;
  private command_panel_loading = false;
  private draining_input_queue = false;
  private prompt_pending = false;

  /** 待处理的 Session Interaction 队列；并行请求按到达顺序依次展示。 */
  private interaction_queue: AgentChatPendingInteractionView[] = [];

  /** 已接收的 Interaction ID，避免同一 part 快照重复展示。 */
  private readonly received_interaction_ids = new Set<string>();

  /**
   * slash 命令宿主，解耦命令分发与 coordinator 内部实现。
   */
  private get slash_command_host(): SlashCommandHost {
    return {
      is_streaming: this.app_state.is_executing || this.prompt_pending,
      send_normal_user_input: async (text: string) => {
        await this.run_message_sequence(text);
      },
      show_error: (text: string) => {
        this.add_error_message(text);
      },
      show_help: () => {
        this.show_command_help();
      },
      attach_files: () => {
        return this.attach_files();
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
      open_agent_configuration: async () => {
        await this.stop("configure");
      },
      show_security_policy_picker: () => {
        this.show_security_policy_picker();
      },
      select_model: async (model_id) => {
        await this.select_model(model_id);
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
      security: undefined,
      session_title: undefined,
      model_label: undefined,
      is_executing: false,
      queued_message_count: 0,
      transcript_scroll_offset: 0,
    };

    this.terminal = new AlternateScreenTerminal();
    this.tui = new FullScreenTui(this.terminal);
    this.terminal.setTitle(this.build_title());

    this.editor = new ChatEditorComponent(this.tui);
    this.header = new AgentHeaderComponent(this.app_state);
    this.footer = new ChatFooterComponent(this.app_state);
    this.queued_messages = new QueuedMessagesComponent();
    this.interaction_panel = new InlinePanelSlotComponent();
    this.command_panel = new InlinePanelSlotComponent();

    this.message_list = new MessageListComponent({
      get_viewport_height: () => this.get_message_list_viewport_height(),
      on_scroll_change: (scroll_offset) => {
        this.app_state.transcript_scroll_offset = scroll_offset;
      },
    });
    this.streaming_ui = new StreamingUIController({
      message_list: this.message_list,
      request_render: () => this.request_render(),
    });
    this.session_subscription = new ChatSessionSubscription({
      remote_agent: options.remote_agent,
      on_snapshot: (snapshot) => this.apply_session_snapshot(snapshot),
      on_mutation: (mutation) => this.apply_session_mutation(mutation),
    });
    this.model_controller = new ChatModelController({
      get_session: () => this.session_subscription.session,
      get_current_model_label: () => this.app_state.model_label,
      on_status: (message) => {
        this.add_status_message(message);
        this.request_render();
      },
      on_error: (message) => {
        this.add_error_message(message);
        this.request_render();
      },
      on_close: () => this.hide_command_panel(),
    });
    this.security_controller = new ChatSecurityController({
      get_session: () => this.session_subscription.session,
      get_session_id: () => this.current_session_id,
      get_approval_mode: () => this.app_state.security?.approval_mode,
      on_status: ({ is_executing, security }) => {
        this.app_state.security = security;
        this.set_session_executing(is_executing);
        this.request_render();
      },
      on_error: (message) => {
        this.add_error_message(message);
        this.request_render();
      },
    });

    this.editor.on_submit = (text) => {
      void this.handle_user_input(text);
    };
    this.editor.on_paste_image = async () => {
      const paths = await read_clipboard_attachment_paths();
      if (paths.length === 0) return false;
      await this.attach_files(paths.map((value) => JSON.stringify(value)).join(" "));
      return true;
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
   * @returns TUI 停止时的导航动作与当前 Session。
   */
  async run(): Promise<AgentChatTuiResult> {
    if (this.running || this.stopped) {
      return { action: "exit", session_id: this.current_session_id };
    }
    this.running = true;

    // 两个交互槽位进入正常布局流：Session Interaction 在输入框上方，命令交互在输入框下方。
    this.tui.addChild(this.header as Component);
    this.tui.addChild(this.message_list as Component);
    this.tui.addChild(this.interaction_panel as Component);
    this.tui.addChild(this.queued_messages as Component);
    this.tui.addChild(this.editor as Component);
    this.tui.addChild(this.command_panel as Component);
    this.tui.addChild(this.footer as Component);
    this.tui.setFocus(this.editor as Component);

    this.remove_input_listener = this.tui.addInputListener((data) =>
      this.handle_global_input(data),
    );

    // 先建立订阅并合并快照，再启动 TUI，避免启动期间遗漏 Session Mutation。
    await this.activate_session(this.current_session_id);

    this.tui.start();

    return await new Promise<AgentChatTuiResult>((resolve) => {
      this.resolve_run = resolve;
    });
  }

  /** 将 canonical pending Interaction 加入当前 Session 的展示队列。 */
  private show_interaction_panel(
    request: SessionInteractionRequest,
    session_id = this.current_session_id,
  ): void {
    if (
      this.stopped ||
      session_id !== this.current_session_id ||
      this.received_interaction_ids.has(request.interaction_id)
    ) return;
    this.received_interaction_ids.add(request.interaction_id);
    this.interaction_queue.push({ session_id, request });
    this.ensure_interaction_panel();
  }

  /** 当前没有活动面板时，按请求 kind 展示队首 Interaction。 */
  private ensure_interaction_panel(): void {
    if (
      this.interaction_panel.is_active ||
      this.stopped ||
      this.interaction_queue.length === 0
    ) return;

    const pending = this.interaction_queue[0];
    if (!pending) return;
    const request = pending.request;
    const panel = request.kind === "approval"
      ? new ApprovalPanelComponent({
          approval_id: request.interaction_id,
          approval_type: request.operation === "tool" ? "tool" : "shell",
          tool_name: request.source.type === "tool"
            ? request.source.tool_name
            : "session",
          details: request.operation === "tool"
            ? [
                {
                  label: "input",
                  value: JSON.stringify(request.validated_input),
                },
                ...(request.tool_description
                  ? [{ label: "description", value: request.tool_description }]
                  : []),
                ...(request.model_explanation
                  ? [{ label: "model", value: request.model_explanation }]
                  : []),
              ]
            : [
                { label: "cmd", value: request.command },
                { label: "cwd", value: request.cwd },
                { label: "reason", value: request.reason },
              ],
          on_decide: (decision) => {
            this.hide_interaction_panel();
            void this.respond_interaction_panel(pending, {
              kind: "approval",
              decision: decision === "approve" ? "approved" : "denied",
            });
          },
        })
      : new QuestionPanelComponent({
          request,
          on_submit: (answers) => {
            this.hide_interaction_panel();
            void this.respond_interaction_panel(pending, {
              kind: "question",
              answers,
            });
          },
          on_cancel: () => {
            this.hide_interaction_panel();
            void this.cancel_question_panel(pending);
          },
        });

    this.command_panel.clear();
    this.interaction_panel.show(panel);
    this.tui.setFocus(this.interaction_panel as Component);
    this.request_render();
  }

  /** 隐藏并移除当前 Interaction 面板。 */
  private hide_interaction_panel(): void {
    if (this.interaction_panel.is_active) this.interaction_queue.shift();
    this.interaction_panel.clear();
    this.tui.setFocus(this.editor as Component);
    this.request_render();
  }

  /**
   * 提交面板决策；失败时将请求放回队首，避免 Agent 永久等待。
   */
  private async respond_interaction_panel(
    pending: AgentChatPendingInteractionView,
    response: SessionInteractionResponse,
  ): Promise<void> {
    const handled = await this.submit_interaction_response(
      pending.request.interaction_id,
      response,
      pending.session_id,
    );
    if (!handled && !this.stopped) this.interaction_queue.unshift(pending);
    this.ensure_interaction_panel();
    this.request_render();
  }

  /** 停止 Question 所属 Turn，让 Session 取消等待中的 Interaction。 */
  private async cancel_question_panel(
    pending: AgentChatPendingInteractionView,
  ): Promise<void> {
    try {
      const session = this.session_subscription.session;
      if (pending.session_id !== this.current_session_id || !session) {
        throw new Error("Question no longer belongs to the active Session.");
      }
      await session.stop();
    } catch (error) {
      this.add_error_message(this.format_error(error));
      if (!this.stopped) this.interaction_queue.unshift(pending);
    }
    this.ensure_interaction_panel();
    this.request_render();
  }

  /** 向远端 Session 提交结构化 Interaction 响应。 */
  private async submit_interaction_response(
    interaction_id: string,
    response: SessionInteractionResponse,
    session_id = this.current_session_id,
  ): Promise<boolean> {
    try {
      const session = this.session_subscription.session;
      if (session_id !== this.current_session_id || !session) {
        throw new Error("Interaction no longer belongs to the active Session.");
      }
      const result = await session.respond({
        interaction_id,
        response,
      });
      if (result.status === "resolved") return true;
      this.add_status_message(
        `Interaction ${interaction_id} is already ${result.status}.`,
      );
      return true;
    } catch (error) {
      this.add_error_message(this.format_error(error));
    }
    return false;
  }

  /**
   * 停止 TUI 并清理资源。
   */
  async stop(action: AgentChatTuiAction = "exit"): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.session_subscription.dispose();
    this.streaming_ui.dispose();
    this.hide_session_picker();
    this.hide_interaction_panel();
    this.remove_input_listener?.();
    this.tui.stop();
    this.resolve_run?.({ action, session_id: this.current_session_id });
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
    const interaction_lines = this.interaction_panel.render(width).length;
    const queued_messages_lines = this.queued_messages.render(width).length;
    const editor_lines = this.editor.render(width).length;
    const command_lines = this.command_panel.render(width).length;
    const footer_lines = this.footer.render(width).length;
    return Math.max(
      1,
      this.terminal.rows
        - header_lines
        - interaction_lines
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
      is_streaming: this.app_state.is_executing || this.prompt_pending,
    });

    if (
      (this.app_state.is_executing || this.prompt_pending) &&
      (intent.kind === "not-command" || intent.kind === "message")
    ) {
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

  /** 将 slash command 指定的文件标签加入编辑器，不立即发送。 */
  private async attach_files(paths?: string): Promise<void> {
    let selected_paths: string[];
    try {
      selected_paths = paths
        ? [paths]
        : await pick_native_files(process.cwd());
    } catch (error) {
      this.add_error_message(error instanceof Error ? error.message : String(error));
      this.request_render();
      return;
    }
    if (selected_paths.length === 0) return;
    const result = await build_attachment_tags(selected_paths.map((value) => JSON.stringify(value)).join(" "));
    for (const error of result.errors) this.add_error_message(error);
    if (result.tags.length === 0) {
      this.request_render();
      return;
    }
    const current_text = this.editor.getText().trim();
    this.editor.set_text([...result.tags, current_text].filter(Boolean).join("\n\n"));
    this.add_status_message(`Attached ${result.tags.length} file${result.tags.length === 1 ? "" : "s"}.`);
    this.request_render();
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
    if (!(await this.security_controller.wait())) return false;
    const session = this.session_subscription.session;
    if (!session) {
      this.add_error_message("Active Session is not available.");
      this.request_render();
      return false;
    }
    this.prompt_pending = true;
    this.message_list.scroll_to_bottom();
    this.request_render();
    try {
      const turn = await session.prompt({ query: message });
      const result = await turn.finished;
      if (!(await this.security_controller.refresh())) this.set_session_executing(false);
      return result.success;
    } catch (error) {
      // 传输失败可能没有 canonical Error Message，需要保留本地可见错误。
      this.add_error_message(this.format_error(error));
      if (!(await this.security_controller.refresh())) this.set_session_executing(false);
      return false;
    } finally {
      this.prompt_pending = false;
      this.request_render();
    }
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
      sessions = await listRemoteChatSessions({
        remote_agent: this.options.remote_agent,
      });
    } catch (error) {
      this.add_error_message(this.format_error(error));
      this.request_render();
      return;
    } finally {
      this.command_panel_loading = false;
    }
    if (this.stopped || this.interaction_panel.is_active) return;

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

  /** 在输入框下方展示当前 Session 的安全策略选择器。 */
  private show_security_policy_picker(): void {
    if (!this.can_open_command_panel()) return;
    if (!this.app_state.security) {
      this.add_error_message("Security policy is not available for this Session.");
      this.request_render();
      return;
    }
    const picker = new SecurityPolicyPanelComponent({
      current_mode: this.app_state.security.approval_mode,
      on_select: (mode) => {
        this.hide_command_panel();
        this.security_controller.apply(mode);
      },
      on_cancel: () => {
        this.hide_command_panel();
      },
    });
    this.command_panel.show(picker);
    this.tui.setFocus(this.command_panel as Component);
    this.request_render();
  }

  /** 打开模型选择器或按显式 ID 切换当前 Session 模型。 */
  private async select_model(model_id?: string): Promise<void> {
    if (!this.can_open_command_panel()) return;
    this.command_panel_loading = true;
    try {
      const picker = await this.model_controller.open(model_id);
      if (!picker || this.stopped || this.interaction_panel.is_active) return;
      this.command_panel.show(picker);
      this.tui.setFocus(this.command_panel as Component);
    } catch (error) {
      this.add_error_message(`Failed to update Session model: ${this.format_error(error)}`);
    } finally {
      this.command_panel_loading = false;
    }
    this.request_render();
  }

  /** 判断当前是否允许打开输入框下方交互面板。 */
  private can_open_command_panel(): boolean {
    return !this.stopped
      && !this.command_panel_loading
      && !this.security_controller.is_updating
      && !this.command_panel.is_active
      && !this.interaction_panel.is_active;
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
      const created = await createRemoteChatSession({
        remote_agent: this.options.remote_agent,
      });
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
    this.interaction_panel.clear();
    this.interaction_queue = [];
    this.received_interaction_ids.clear();
    this.current_session_id = session_id;
    this.app_state.session_id = session_id;
    this.app_state.session_title = undefined;
    this.app_state.model_label = undefined;
    this.app_state.security = undefined;
    this.header.set_state(this.app_state);
    this.footer.set_state(this.app_state);
    this.terminal.setTitle(this.build_title());
    this.message_list.clear();

    try {
      await this.activate_session(session_id);
      this.add_status_message(`Agent chat · ${this.app_state.agent_id} · ${session_id}`);
    } catch (error) {
      this.add_error_message(this.format_error(error));
    }
    this.request_render();
  }

  /** 建立当前 Session 的长期订阅，并以快照校准初始化状态。 */
  private async activate_session(session_id: string): Promise<void> {
    try {
      await this.session_subscription.activate(session_id);
    } catch (error) {
      throw new Error(`Failed to activate Session: ${this.format_error(error)}`);
    }
  }

  /** 用完整 Session 快照替换 TUI 状态，随后由订阅资源回放缓冲 Mutation。 */
  private apply_session_snapshot(snapshot: ChatSessionSnapshot): void {
    if (snapshot.session_id !== this.current_session_id) return;
    this.app_state.session_title = snapshot.title;
    this.app_state.model_label = snapshot.model_label;
    this.app_state.security = snapshot.security;
    this.set_session_executing(snapshot.is_executing);
    this.header.set_state(this.app_state);
    this.footer.set_state(this.app_state);
    this.terminal.setTitle(this.build_title());
    this.message_list.set_messages(snapshot.messages);
    this.message_list.scroll_to_bottom();
    for (const pending of snapshot.interactions) {
      this.show_interaction_panel(pending.request, snapshot.session_id);
    }
  }

  /** 将当前 Session 的全部 Mutation 投影到 transcript 与 TUI 状态。 */
  private apply_session_mutation(mutation: SessionMutation): void {
    if (mutation.session_id !== this.current_session_id) return;

    if (
      mutation.variant === "message" ||
      mutation.variant === "part" ||
      mutation.variant === "delta"
    ) {
      this.streaming_ui.handle_event(mutation);
      if (mutation.variant === "part" && mutation.type === "interaction") {
        if (mutation.part.status === "pending") {
          this.show_interaction_panel(mutation.part.request, mutation.session_id);
        } else {
          this.remove_resolved_interaction(mutation.part.interaction_id);
        }
      }
      return;
    }

    if (mutation.variant === "turn") {
      this.set_session_executing(mutation.status === "running");
      return;
    }

    if (mutation.variant === "session" && mutation.type === "title") {
      this.app_state.session_title = mutation.title.trim() || "Untitled";
      this.header.set_state(this.app_state);
      this.terminal.setTitle(this.build_title());
      this.request_render();
      return;
    }

    if (mutation.variant === "session" && mutation.type === "config") {
      this.app_state.model_label = mutation.model_label;
      this.header.set_state(this.app_state);
      this.request_render();
    }
  }

  /** 以 Session 状态更新执行指示与 working 动画。 */
  private set_session_executing(is_executing: boolean): void {
    this.app_state.is_executing = is_executing;
    this.header.set_state(this.app_state);
    this.footer.set_state(this.app_state);
    this.streaming_ui.set_executing(is_executing);
  }

  /** 从本地展示队列移除已经由 canonical Part 收口的 Interaction。 */
  private remove_resolved_interaction(interaction_id: string): void {
    const index = this.interaction_queue.findIndex(
      (pending) => pending.request.interaction_id === interaction_id,
    );
    if (index < 0) return;
    if (index === 0 && this.interaction_panel.is_active) {
      this.hide_interaction_panel();
      this.ensure_interaction_panel();
      return;
    }
    this.interaction_queue.splice(index, 1);
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
    if (this.interaction_panel.is_active || this.command_panel.is_active) {
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
