/** Session activity 只引用本次已确认可读的会话；完整地址在宿主点击时从当前 Agent 目录解析。 */
import type { PowerActivityProps } from "../types/PowerActivityRenderer.js";
import type { PowerActivityResource } from "../types/PowerActivityResource.js";
import { action_id, activity_tone, input_args, is_chinese, output_data, record_value, short_text, text_value } from "./Activity.js";

/** 不通过调用方 Workspace 或默认活动状态覆盖目标身份。 */
export function session_activity_resource(props: PowerActivityProps): PowerActivityResource | undefined {
  if (props.tool.state !== "completed" || activity_tone(props) !== "complete") return;
  const action = action_id(props);
  if (!["start", "input", "check", "messages", "part", "reply", "stop", "archive"].includes(action)) return;
  const args = input_args(props);
  const data = output_data(props);
  const session = record_value(data.session);
  const session_id = text_value(session.session_id) || text_value(data.session_id);
  if (!session_id || action === "check" && !text_value(args.session_id)) return;
  const session_type = text_value(session.session_type) || text_value(data.session_type) || text_value(args.session_type)
    || (["start", "input", "reply", "stop", "archive"].includes(action) ? "work" : "");
  if (!session_type) return;
  const workspace_id = text_value(session.workspace_id);
  const archived = action === "archive" || session.archived === true || data.archived === true || args.archived === true;
  const label = short_text(session.title) || short_text(args.title) || (session_type === "work"
    ? is_chinese(props.locale) ? "工作会话" : "Work session" : is_chinese(props.locale) ? "聊天会话" : "Chat session");
  return { type: "session", session_id, session_type, archived, label, ...(workspace_id ? { workspace_id } : {}) };
}
