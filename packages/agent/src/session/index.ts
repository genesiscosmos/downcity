/**
 * @downcity/agent/session — 浏览器安全的 canonical Session 数据协议入口。
 *
 * 该入口只导出纯类型、常量、JSON 校验函数和消息标记解析器，不引入 Node Session runtime。
 */

export { extract_chat_message_file_tags } from "@/model/messages/ChatMessageMarkup.js";

export type {
  SessionTurnFileDiff,
  SessionTurnFileDiffData,
  SessionTurnFileDiffStatus,
  SessionTurnFileDiffSummary,
} from "@downcity/type";
export {
  is_session_turn_file_diff_data_part,
  read_session_turn_file_diff_data,
  SESSION_TURN_FILE_DIFF_DATA_TYPE,
} from "@/session/messages/SessionTurnFileDiffData.js";
