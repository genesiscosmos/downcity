/**
 * Session Turn 文件修改观测。
 *
 * 本模块把 Tool effects 投影为实时摘要和最终 canonical data part。所有失败都只记录
 * warning，不得反向改变 Turn 结果。
 */

import { nanoid } from "nanoid";
import {
  build_session_turn_file_diff,
  build_session_turn_file_diff_summary,
} from "@/session/messages/SessionTurnFileDiffBuilder.js";
import { SESSION_TURN_FILE_DIFF_DATA_TYPE } from "@/session/messages/SessionTurnFileDiffData.js";
import type {
  AppendSessionTurnFileDiffInput,
  PublishSessionTurnFileDiffInput,
} from "@/types/session/SessionTurnFileDiff.js";
import type { Logger } from "@/utils/logger/Logger.js";

/** 把当前 Turn 成功的结构化文件修改写入 canonical Assistant data part。 */
export async function append_session_turn_file_diff(
  input: AppendSessionTurnFileDiffInput,
): Promise<void> {
  try {
    const file_diff = build_session_turn_file_diff(
      input.workspace_path,
      input.turn_context.effects.snapshot(),
    );
    if (!file_diff) return;
    await input.assistant_output.append_result_parts([{
      type: "data",
      data_type: SESSION_TURN_FILE_DIFF_DATA_TYPE,
      data_id: `turn-file-diff:${input.turn_id}`,
      data: {
        files: file_diff.files.map((file) => ({
          file: file.file,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch,
        })),
        additions: file_diff.additions,
        deletions: file_diff.deletions,
      },
    }]);
  } catch (error) {
    await log_file_diff_warning(
      input.logger,
      input.session_id,
      input.turn_id,
      "failed to persist structured file edits",
      error,
    );
  }
}

/** 发布当前 Turn 的实时文件修改摘要。 */
export function publish_session_turn_file_diff(
  input: PublishSessionTurnFileDiffInput,
): void {
  try {
    const summary = build_session_turn_file_diff_summary(
      input.workspace_path,
      input.effects,
    );
    if (summary.files_count === 0) return;
    input.publish({
      mutation_id: nanoid(),
      variant: "file_diff",
      session_id: input.session_id,
      turn_id: input.turn_id,
      created_at: Date.now(),
      files_count: summary.files_count,
      additions: summary.additions,
      deletions: summary.deletions,
    });
  } catch (error) {
    void log_file_diff_warning(
      input.logger,
      input.session_id,
      input.turn_id,
      "failed to publish live file edit summary",
      error,
    );
  }
}

/** 文件修改观测失败使用的 best-effort 日志入口。 */
async function log_file_diff_warning(
  logger: Logger,
  session_id: string,
  turn_id: string,
  message: string,
  error: unknown,
): Promise<void> {
  try {
    await logger.log("warn", `[agent] ${message}`, {
      session_id,
      turn_id,
      error: error instanceof Error ? error.message : String(error),
    });
  } catch {
    // 文件编辑观测失败不影响 canonical 对话执行。
  }
}
