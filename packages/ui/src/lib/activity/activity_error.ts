/**
 * 统一工具错误的只读宿主边界。原文只从完整 canonical output/error 取值；
 * 沿用私密引用脱敏，并保护 Shell stdin 回显及私密问答，不读取 model_output 或预览。
 */
import type { SessionAgentToolPart } from "@downcity/type";
import { object_value, redact_private, text_value } from "./activity_detail_shared.ts";

/** 为本次失败提供完整可复制原文；没有可靠来源或无法安全公开时不提供复制。 */
export function activity_error_original(tool: SessionAgentToolPart): string | undefined {
  const input = object_value(tool.input);
  const args = object_value(input?.args);
  const shell_send = tool.tool_name === "shell" && input?.action === "session_send";
  const stdin = text_value(args?.input);
  // 现有 Shell 展示规则会整体隐藏无法匹配私密替换值的回显；复制也遵循相同边界。
  if (shell_send && (!stdin || stdin.length > 4096 || /\$\{secrets\.|\[redacted\]|\[private\]|<redacted>|\*{3,}/i.test(stdin))) return undefined;
  if (tool.tool_name === "ask_user" && (Array.isArray(input?.questions) && input.questions.some(item => object_value(item)?.type === "secret")
    || tool.interactions?.some(item => {
      const payload = object_value(item.request.payload);
      return Array.isArray(payload?.questions) && payload.questions.some(question => object_value(question)?.type === "secret");
    }))) return undefined;
  let original: string | undefined;
  try {
    original = tool.output !== undefined && tool.output !== null
      ? typeof tool.output === "string" ? tool.output : JSON.stringify(tool.output, null, 2)
      : tool.error || undefined;
  } catch { return undefined; }
  if (!original?.trim()) return undefined;
  if (tool.error && !original.includes(tool.error)) original += `\n\n${tool.error}`;
  if (shell_send) {
    const trimmed = stdin.trim();
    for (const fragment of [trimmed, ...trimmed.split(/\r?\n/)].filter(Boolean)) {
      original = original.split(fragment).join("[input hidden]");
      const escaped = JSON.stringify(fragment).slice(1, -1);
      original = original.split(escaped).join("[input hidden]");
    }
  }
  return redact_private(original);
}

/** 只有本次调用信封失败；不从目标对象的 state/status/failure 猜测。 */
export function activity_call_failed(tool: SessionAgentToolPart): boolean {
  return tool.state === "failed" || tool.state === "completed" && object_value(tool.output)?.success === false;
}
