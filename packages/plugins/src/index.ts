/**
 * @downcity/plugins 公开入口。
 *
 * 关键点（中文）
 * - 这个包专门承载 Downcity 内建 plugin 的对外消费入口。
 * - 本包根入口汇总具体 plugin class；按需消费应优先使用对应子路径。
 * - 注册、目录、HTTP、CLI、action 执行都由 `@downcity/agent` 的通用能力处理。
 */

export * from "./chat.js";
export * from "./contact.js";
export * from "./image.js";
export * from "./memory.js";
export * from "./skill.js";
export * from "./sound.js";
export * from "./task.js";
export * from "./web.js";
export * from "./workboard.js";
export {
  create_builtin_plugin_registrations,
} from "./builtin/BuiltinPluginTypes.js";
export type {
  BuiltinPluginDefinition,
  BuiltinPluginRegistration,
  BuiltinPluginRegistrationsOptions,
} from "./builtin/BuiltinPluginTypes.js";
