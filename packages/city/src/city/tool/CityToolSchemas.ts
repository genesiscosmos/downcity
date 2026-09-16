/**
 * city tool 工具输入 schema。
 *
 * 关键点（中文）
 * - 工具固定一个入口：namespace + action + args，避免能力增长时工具清单持续膨胀。
 * - args 是开放对象，这里不用 Zod 表达，避免 JSON Schema 转换后把 additionalProperties 收窄为 false。
 * - 省略 action 时返回该 namespace 的动作清单，因此两个字段都不是必填。
 */

/** `city` 工具对模型暴露的输入 schema。 */
export const city_tool_input_schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    namespace: {
      type: "string",
      description:
        "Namespace to use, for example env or sandbox. Omit to list the namespaces you can use.",
    },
    action: {
      type: "string",
      description:
        "Action inside the namespace, for example get. Omit to list the actions of that namespace.",
    },
    args: {
      type: "object",
      additionalProperties: true,
      default: {},
      description: "JSON arguments passed to the action.",
    },
  },
};
