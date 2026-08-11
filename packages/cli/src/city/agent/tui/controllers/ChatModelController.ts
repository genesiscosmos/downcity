/**
 * Chat TUI 当前 Session 的模型命令控制器。
 *
 * 负责读取宿主模型目录、校验显式 model_id，并通过 RemoteSession 提交切换。
 * Header 状态仍完全由 Session 快照和 config Mutation 投影。
 */

import { listAgentChatModelChoices } from "@/city/agent/AgentChatRemote.js";
import { ModelPickerComponent } from "@/city/agent/tui/dialogs/ModelPicker.js";
import type {
  AgentChatModelChoice,
  AgentChatModelControllerOptions,
} from "@/city/types/AgentChatModel.js";

/** 管理 `/model` 命令的目录与 Session 更新逻辑。 */
export class ChatModelController {
  private readonly options: AgentChatModelControllerOptions;

  /** @param options 当前 Session 与 TUI 通知回调。 */
  constructor(options: AgentChatModelControllerOptions) {
    this.options = options;
  }

  /** 执行显式模型切换，或返回供 Coordinator 挂载的选择器。 */
  async open(model_id?: string): Promise<ModelPickerComponent | null> {
    const choices = await listAgentChatModelChoices();
    if (choices.length === 0) {
      throw new Error("No chat models are available for the current user.");
    }
    const requested_model_id = String(model_id || "").trim();
    if (requested_model_id) {
      const choice = choices.find((item) => item.model_id === requested_model_id);
      if (!choice) throw new Error(`Model is not available: ${requested_model_id}`);
      await this.apply_choice(choice);
      return null;
    }
    return new ModelPickerComponent({
      choices,
      current_model_label: this.options.get_current_model_label(),
      on_select: (selected_model_id) => {
        this.options.on_close();
        const choice = choices.find((item) => item.model_id === selected_model_id);
        if (choice) void this.apply_choice(choice).catch((error) => this.report_error(error));
      },
      on_cancel: this.options.on_close,
    });
  }

  /** 向当前 RemoteSession 提交已校验的模型 ID。 */
  private async apply_choice(choice: AgentChatModelChoice): Promise<void> {
    const current_model_label = this.options.get_current_model_label();
    if (current_model_label === choice.model_id || current_model_label === choice.name) {
      this.options.on_status(`Session model unchanged · ${choice.name}`);
      return;
    }
    const session = this.options.get_session();
    if (!session) throw new Error("Active Session is not available.");
    await session.set({ model_id: choice.model_id });
    this.options.on_status(`Session model updated · ${choice.name}`);
  }

  /** 把异步选择回调失败转换为用户可见错误。 */
  private report_error(error: unknown): void {
    this.options.on_error(
      `Failed to update Session model: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
