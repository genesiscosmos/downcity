/**
 * Action JSON 输入协议：空体代表无参数，非空体必须为 JSON 对象。
 * 原始协议入口由路由显式声明 raw，不能让非法 JSON 静默退化为空对象。
 */
import { httpError } from "../../utils/helpers.js";

/** 解析 Action 参数；错误说明不包含请求正文、凭据或解析器内部诊断。 */
export function parse_action_input(raw_body: string): Record<string, unknown> {
  if (!raw_body.trim()) return {};
  let value: unknown;
  try { value = JSON.parse(raw_body); }
  catch { throw httpError(400, "INVALID_JSON: Request body must be valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw httpError(400, "INVALID_INPUT: Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

/** 读取失败同样是无效请求，不能替换成空体继续执行。 */
export async function read_request_text(request: Request): Promise<string> {
  try { return await request.text(); }
  catch { throw httpError(400, "INVALID_BODY: Unable to read request body"); }
}
