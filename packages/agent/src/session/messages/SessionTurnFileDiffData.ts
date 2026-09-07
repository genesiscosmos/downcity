/**
 * Session Turn 文件改动 data part 的协议辅助函数。
 *
 * 这里集中维护稳定 data_type 与运行时校验，避免 Desktop、远程客户端和插件各自解释
 * 任意 JSON 结构。
 */

import type { SessionAssistantDataPart } from "@downcity/type";
import type {
  SessionTurnFileDiff,
  SessionTurnFileDiffData,
  SessionTurnFileDiffStatus,
} from "@downcity/type";

/** 当前 Turn 文件改动使用的稳定 Assistant data part 类型。 */
export const SESSION_TURN_FILE_DIFF_DATA_TYPE = "data-session-turn-file-diff";

/** 从 Assistant data part 中读取经过校验的 Turn 文件改动。 */
export function read_session_turn_file_diff_data(
  part: SessionAssistantDataPart,
): SessionTurnFileDiffData | undefined {
  if (part.data_type !== SESSION_TURN_FILE_DIFF_DATA_TYPE) return undefined;
  if (!is_record(part.data) || !Array.isArray(part.data.files)) return undefined;
  const files = part.data.files.flatMap((candidate) => {
    const file_diff = read_file_diff(candidate);
    return file_diff ? [file_diff] : [];
  });
  if (files.length !== part.data.files.length) return undefined;
  const additions = read_count(part.data.additions);
  const deletions = read_count(part.data.deletions);
  if (additions === undefined || deletions === undefined) return undefined;
  return { files, additions, deletions };
}

/** 判断 data part 是否为有效的 Turn 文件改动。 */
export function is_session_turn_file_diff_data_part(
  part: SessionAssistantDataPart,
): boolean {
  return read_session_turn_file_diff_data(part) !== undefined;
}

/** 读取单个文件差异并收窄未知 JSON。 */
function read_file_diff(input: unknown): SessionTurnFileDiff | undefined {
  if (!is_record(input)) return undefined;
  const file = typeof input.file === "string" ? input.file : "";
  const status = input.status;
  const additions = read_count(input.additions);
  const deletions = read_count(input.deletions);
  if (
    !file ||
    !is_file_diff_status(status) ||
    additions === undefined ||
    deletions === undefined ||
    typeof input.patch !== "string"
  ) return undefined;
  return { file, status, additions, deletions, patch: input.patch };
}

/** 文件状态只接受 canonical 三种值。 */
function is_file_diff_status(input: unknown): input is SessionTurnFileDiffStatus {
  return input === "added" || input === "deleted" || input === "modified";
}

/** 行数必须是非负整数。 */
function read_count(input: unknown): number | undefined {
  return Number.isInteger(input) && Number(input) >= 0 ? Number(input) : undefined;
}

/** 将未知值收窄为普通对象。 */
function is_record(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}
