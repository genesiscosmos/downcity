/**
 * Env 管理 API 的公开契约。
 *
 * 目录只暴露字段定义和占位示例，真实配置值仅通过管理员业务接口读取。
 * schema 描述现有输入转换行为，不额外增加运行时参数校验。
 */
import type { ApiDocumentation } from "../../types/ServiceDiscovery.js";

const key_schema = { type: "string", description: "环境变量名；写入时去除首尾空格并转换为大写，须匹配 [A-Z_][A-Z0-9_]*。" };
const success_schema = { type: "boolean", const: true };
const count_schema = { type: "integer", minimum: 0 };
const key_result_schema = {
  type: "object", required: ["success", "key"],
  properties: { success: success_schema, key: { type: "string" } },
};

/** 所有 Env action 的文档，与注册 ID 一一对应。 */
export const env_api_documentation: Record<string, ApiDocumentation> = {
  list: {
    description: "从持久化存储刷新并列出全部环境变量。响应包含明文值，只允许可信管理员读取。",
    request_schema: { type: "object", properties: {}, additionalProperties: false },
    response_schema: {
      type: "object", required: ["items"], properties: {
        items: { type: "array", items: {
          type: "object", required: ["key", "value", "source"], properties: {
            key: key_schema, value: { type: "string", description: "环境变量明文值。" },
            source: { type: "string", const: "database" },
          },
        } },
      },
    },
    examples: [{ name: "读取配置", request: {}, response: { items: [{ key: "EXAMPLE_KEY", value: "example-value", source: "database" }] } }],
  },
  upsert: {
    description: "新增或覆盖一项环境变量，并同步当前运行实例的环境缓存。key/value 会转换为字符串，省略 value 时写入空字符串。",
    request_schema: { type: "object", required: ["key"], properties: { key: key_schema, value: { type: "string", default: "" } } },
    response_schema: key_result_schema,
    errors: [{ status: 500, description: "变量名不符合规则，或存储写入失败。" }],
    examples: [{ name: "写入占位配置", request: { key: "EXAMPLE_KEY", value: "example-value" }, response: { success: true, key: "EXAMPLE_KEY" } }],
  },
  remove: {
    description: "删除变量并移除当前实例缓存；不存在的变量也返回成功。响应 key 保留请求中的字符串形式。",
    request_schema: { type: "object", required: ["key"], properties: { key: key_schema } },
    response_schema: key_result_schema,
    errors: [{ status: 500, description: "变量名不符合规则，或存储删除失败。" }],
    examples: [{ name: "删除配置", request: { key: "EXAMPLE_KEY" }, response: { success: true, key: "EXAMPLE_KEY" } }],
  },
  import: {
    description: "按行导入 dotenv 文本，支持 export 前缀、注释及引号；忽略空行和没有等号的行，逐项写入。非事务导入，失败前的写入会保留。",
    request_schema: { type: "object", properties: { raw: { type: "string", description: "dotenv 内容；省略或空内容时不写入。", default: "" } } },
    response_schema: { type: "object", required: ["success", "count", "keys"], properties: {
      success: success_schema, count: count_schema, keys: { type: "array", items: { type: "string" } },
    } },
    errors: [{ status: 500, description: "变量名不符合规则，或某项写入失败；此前写入不会回滚。" }],
    examples: [{ name: "导入 dotenv", request: { raw: "EXAMPLE_KEY=example-value\n" }, response: { success: true, count: 1, keys: ["EXAMPLE_KEY"] } }],
  },
  refresh: {
    description: "从数据库重新载入当前实例的全部环境变量缓存，返回刷新后的变量数量。适合直接修改数据库后显式刷新。",
    request_schema: { type: "object", properties: {}, additionalProperties: false },
    response_schema: { type: "object", required: ["success", "count"], properties: { success: success_schema, count: count_schema } },
    examples: [{ name: "刷新缓存", request: {}, response: { success: true, count: 1 } }],
  },
};
