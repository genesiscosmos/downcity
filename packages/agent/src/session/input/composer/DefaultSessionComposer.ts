/**
 * 默认 Session Composer。
 *
 * 负责组装当前 Step 的 system、messages 与 tools，并在上下文压力出现时把较旧的稳定
 * Part 折叠进累计摘要 checkpoint。
 *
 * 关键点（中文）
 * - canonical history 由调用方传入，本模块只读取它，从不改写。
 * - 压缩结果只写自己的 checkpoint 派生表；下一次 compose 才会读到新边界。
 * - 自定义压缩算法可以继承本类并只覆盖 `advance_context()`。
 */

import { compact_context } from "./ContextCompaction.js";
import { session_messages_to_model_messages } from "@/model/messages/SessionModelMessages.js";
import type {
  SessionComposer,
  SessionComposeInput,
  SessionContextAdvanceInput,
  SessionContextDiagnostics,
  SessionStepInput,
} from "@/types/session/SessionComposer.js";
import type { ContextCheckpointRow } from "@/types/session/ContextCheckpoint.js";
import {
  build_composer_system_blocks,
  inject_power_context,
  to_system_messages,
} from "@/session/input/composer/ComposerAssembly.js";
import {
  initialize_checkpoint_schema,
  read_latest_checkpoint,
} from "@/session/input/composer/AdaptiveContextCheckpoint.js";
import {
  slice_messages_after_checkpoint,
} from "@/session/input/composer/AdaptiveContextParts.js";

/** 基于 Part 级 checkpoint 的默认 Composer。 */
export class DefaultSessionComposer implements SessionComposer {
  /** Composer 名称，同时作为派生表命名空间。 */
  readonly name = "adaptive_part";

  /** 创建累计摘要 checkpoint 派生表。 */
  async initialize(
    input: Parameters<SessionComposer["initialize"]>[0],
  ): Promise<void> {
    await initialize_checkpoint_schema(input.derived, this.name);
  }

  /** 返回显式摘要 system block 与 checkpoint 边界后的 canonical 历史。 */
  async compose(input: SessionComposeInput): Promise<SessionStepInput> {
    const checkpoint = await read_latest_checkpoint(input.derived, this.name);
    const system_blocks = await build_composer_system_blocks(input);
    if (checkpoint?.summary.trim()) {
      system_blocks.push({
        source: "session",
        name: "context-summary",
        content: `<session-context-summary>\n${checkpoint.summary}\n</session-context-summary>`,
      });
    }
    const tail = checkpoint
      ? slice_messages_after_checkpoint(input.history, checkpoint)
      : input.history;
    return {
      system: to_system_messages(system_blocks),
      system_blocks,
      messages: inject_power_context(
        await session_messages_to_model_messages(tail, input.session.project_root),
        input.state.power_context_blocks ?? [],
      ),
      tools: { ...input.state.tools },
      context_diagnostics: build_diagnostics(this.name, input.history, checkpoint),
    };
  }

  /** 按模型可见语义选择历史，一次生成摘要并提交完整单元边界。 */
  async advance_context(input: SessionContextAdvanceInput): Promise<boolean> {
    return await compact_context(input, this.name);
  }
}

/** 组装当前上下文的只读诊断。 */
function build_diagnostics(
  composer_name: string,
  history: SessionComposeInput["history"],
  checkpoint: ContextCheckpointRow | null,
): SessionContextDiagnostics {
  const latest_sequence = history.at(-1)?.sequence;
  return {
    composer_name,
    ...(latest_sequence !== undefined ? { through_sequence: latest_sequence } : {}),
    ...(checkpoint ? { through_part_sequence: checkpoint.through_part_sequence } : {}),
    derived: Boolean(checkpoint),
    ...(checkpoint ? { derivation_id: checkpoint.checkpoint_id } : {}),
  };
}
