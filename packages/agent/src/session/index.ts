/**
 * @downcity/agent/session — 浏览器安全的 canonical Session 数据协议入口。
 *
 * 该入口只导出纯类型、常量和 JSON 校验函数，不引入 Node Session runtime。
 */

export type {
  SessionTurnFileDiff,
  SessionTurnFileDiffData,
  SessionTurnFileDiffStatus,
} from "@/types/session/SessionTurnFileDiff.js";
export {
  is_session_turn_file_diff_data_part,
  read_session_turn_file_diff_data,
  SESSION_TURN_FILE_DIFF_DATA_TYPE,
} from "@/session/messages/SessionTurnFileDiffData.js";
