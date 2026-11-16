/**
 * Desktop 用户偏好的离线转换：只处理明确的置顶和 Session 模型/推理设置。
 * 登录信息、服务配置、Group 独立身份和已废弃格式的惰性历史键保持原值。
 */
import { check_integrity, fail } from "./session-v7-database.mjs";

/** 置顶保存的是旧精确记录 UUID，转换时不通过逻辑地址重新选择主会话。 */
function rewrite_pin(key, context) {
  if (!key.startsWith("agent-record:")) return key;
  let value;
  try { value = JSON.parse(key.slice("agent-record:".length)); } catch { fail("desktop_pin_invalid"); }
  if (!Array.isArray(value) || value.length !== 3 || value[2] !== false) fail("desktop_pin_invalid");
  const rows = context.agents.find(agent => agent.agent_id === value[0])?.identities.filter(row => row.source_storage_id === value[1]);
  if (rows?.length !== 1 || rows[0].archived) fail("desktop_pin_reference_missing");
  return `agent-record:${JSON.stringify([value[0], rows[0].session_id, false])}`;
}

/** 只改正式五元组中的 Session 段，其余字段继续表达路由和一致性校验。 */
function rewrite_preferences(value, context) {
  return Object.fromEntries(Object.entries(value).map(([key, setting]) => {
    const segments = key.split("\0");
    // 当前宿主已经忽略的更早历史键不是可执行 Session 引用，保留原始偏好事实。
    if (segments.length !== 5) return [key, setting];
    segments[2] = context.resolve(segments[0], segments[2], segments[3], undefined, true);
    return [segments.join("\0"), setting];
  }));
}

/** 平台库通过完整副本转换，其他表和明文/加密账户字段不进入日志或报告。 */
export function convert_platform_database(database, context) {
  database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;");
  try {
    const rows = database.prepare("SELECT key,value_json FROM platform_settings WHERE key IN ('desktop.settings','desktop.session-models','desktop.session-reasoning')").all();
    for (const row of rows) {
      const value = JSON.parse(row.value_json);
      let next = value;
      if (row.key === "desktop.settings" && value.session_pins) next = { ...value, session_pins: value.session_pins.map(key => rewrite_pin(key, context)) };
      else if (row.key !== "desktop.settings") next = rewrite_preferences(value, context);
      database.prepare("UPDATE platform_settings SET value_json=? WHERE key=?").run(JSON.stringify(next), row.key);
    }
    check_integrity(database); database.exec("COMMIT;");
  } catch (error) { database.exec("ROLLBACK;"); throw error; }
}
