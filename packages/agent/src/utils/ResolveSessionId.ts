/**
 * 解析 session_id。
 *
 * 优先级（中文）
 * 1) 显式参数 `input.session_id`
 * 2) `DC_SESSION_ID`
 */
export function resolve_session_id(input?: {
  session_id?: string;
}): string | undefined {
  const explicit = String(input?.session_id || "").trim();
  if (explicit) return explicit;

  const envSessionId = String(process.env.DC_SESSION_ID || "").trim();
  if (envSessionId) return envSessionId;

  return undefined;
}
