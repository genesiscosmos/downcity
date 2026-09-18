/**
 * Power 工具输入 schema。
 *
 * 关键点（中文）
 * - 每个 power 工具共享同一份输入契约 `{ action, args }`，差异只由运行时注册状态决定。
 * - `args` 用开放对象表达，避免 JSON Schema 转换后把 additionalProperties 收窄为 false。
 * - 不在这里枚举 action：可用动作由运行时索引给出，静态枚举会与注册状态漂移。
 */

/** 所有 power 工具共用的输入 schema。 */
export const power_tool_input_schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      description:
        "Action id inside this power, for example env.get. Omit to list the actions of this power.",
    },
    args: {
      type: "object",
      additionalProperties: true,
      default: {},
      description: "JSON arguments passed to the action.",
    },
  },
};
