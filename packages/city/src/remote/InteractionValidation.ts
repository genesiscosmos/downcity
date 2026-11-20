/**
 * Agent interactions 的传输边界校验。
 *
 * 只接受完整原交互引用，不接受请求级 Agent 覆盖；校验错误始终使用静态文本，
 * 不把输入（尤其私密答案）拼入异常。业务校验由绑定 Agent 的原 Session 完成。
 */
import type { AgentListInteractionsInput, AgentRespondInteractionInput } from "@downcity/agent";

/** 校验对象结构，拒绝数组和空值。 */
function is_record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 列表只允许正整数 limit；Agent/Workspace 作用域由连接确定。 */
export function validate_interaction_list_input(input: unknown): AgentListInteractionsInput {
  if (input === undefined) return {};
  if (!is_record(input) || Object.keys(input).some((key) => key !== "limit")) {
    throw new Error("Invalid Agent interactions list input");
  }
  if (input.limit === undefined) return {};
  if (typeof input.limit !== "number" || !Number.isSafeInteger(input.limit) || input.limit < 1) {
    throw new Error("Agent interactions limit must be a positive integer");
  }
  return { limit: input.limit };
}

/** 返回不含额外主体字段的响应信封；不改变引用值，避免把错误引用映射到另一交互。 */
export function validate_interaction_response_input(input: unknown): AgentRespondInteractionInput {
  if (!is_record(input) || Object.keys(input).some((key) => key !== "reference" && key !== "response")) {
    throw new Error("Invalid Agent interaction response input");
  }
  const reference = input.reference;
  const reference_keys = ["session_type", "session_id", "turn_id", "interaction_id"];
  if (!is_record(reference) || Object.keys(reference).some((key) => !reference_keys.includes(key))
    || reference_keys.some((key) => typeof reference[key] !== "string" || !reference[key].trim())) {
    throw new Error("Agent Interaction requires a complete Session/Turn/Interaction reference");
  }
  const response = input.response;
  if (!is_record(response) || Object.keys(response).some((key) => !["type", "outcome", "payload"].includes(key))
    || typeof response.type !== "string" || !response.type.trim()
    || (response.outcome !== "resolved" && response.outcome !== "denied")
    || !("payload" in response)) {
    throw new Error("Invalid Agent interaction response envelope");
  }
  return input as unknown as AgentRespondInteractionInput;
}
