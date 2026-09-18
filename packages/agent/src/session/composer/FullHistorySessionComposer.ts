/**
 * 全量历史 Session Composer。
 *
 * 不做任何上下文推进：每次交给模型的都是完整 canonical history，也没有派生表。
 * 适用于短会话、测试或上下文窗口足够大的模型。
 */

import { session_messages_to_model_messages } from "@/executor/messages/SessionModelMessages.js";
import type {
  SessionComposer,
  SessionComposeInput,
  SessionStepInput,
} from "@/types/session/SessionComposer.js";
import {
  build_composer_system_blocks,
  inject_power_context,
  to_system_messages,
} from "@/session/composer/ComposerAssembly.js";

/** 直接投影全部 canonical history 的 Composer。 */
export class FullHistorySessionComposer implements SessionComposer {
  /** Composer 名称；该实现不建立派生表。 */
  readonly name = "full_history";

  /** 没有派生 schema 需要初始化。 */
  async initialize(): Promise<void> {}

  /** 返回完整 canonical 历史与当前 Step 的工具集合。 */
  async compose(input: SessionComposeInput): Promise<SessionStepInput> {
    const system_blocks = await build_composer_system_blocks(input);
    const latest_sequence = input.history.at(-1)?.sequence;
    return {
      system: to_system_messages(system_blocks),
      system_blocks,
      messages: inject_power_context(
        await session_messages_to_model_messages(
          input.history,
          input.session.project_root,
        ),
        input.state.power_context_blocks ?? [],
      ),
      tools: { ...input.state.tools },
      context_diagnostics: {
        composer_name: this.name,
        ...(latest_sequence !== undefined ? { through_sequence: latest_sequence } : {}),
        derived: false,
      },
    };
  }

  /** 没有派生状态可以推进。 */
  async advance_context(): Promise<boolean> {
    return false;
  }
}
