# Plugin Call Payload Schema 修复 PRD

## 1. 文档目的

本文档描述 `@downcity/agent` 中 `plugin_call.payload` 工具输入 schema 的修复方案。

这次修复要解决一个核心问题：

- `plugin_call.payload` 运行时本应允许任意 JSON object，但暴露给模型的 JSON Schema 变成了 `additionalProperties: false`，导致严格遵循 schema 的模型无法生成 plugin action 需要的 payload 字段。

典型失败场景：

```json
{
  "plugin": "skill",
  "action": "lookup",
  "payload": {}
}
```

而 `skill.lookup` 实际需要：

```json
{
  "plugin": "skill",
  "action": "lookup",
  "payload": {
    "name": "web-access"
  }
}
```

## 2. 背景与现状结论

当前 `plugin_call` 的输入 schema 定义在：

```text
packages/agent/src/executor/tools/plugin/PluginToolSchemas.ts
```

当前实现：

```ts
export const plugin_call_input_schema = z.object({
  plugin: z.string().describe("Registered plugin name to call, for example image."),
  action: z.string().describe("Plugin action name to execute, for example image_create."),
  payload: z
    .object({})
    .passthrough()
    .optional()
    .default({})
    .describe("JSON payload passed to the plugin action."),
});
```

代码意图是正确的：`payload` 是通用 plugin action bridge 的透传对象，不应该由 `plugin_call` 外层理解或限制具体字段。

但在当前依赖组合下：

```text
@downcity/agent: 1.1.199
ai: ^6.0.193
zod: ^4.4.3
```

`z.object({}).passthrough()` 经 AI SDK `zodSchema()` 转换后，暴露给模型的 JSON Schema 会变成：

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false,
  "default": {}
}
```

这会告诉模型：`payload` 里不允许出现任何字段。

因此模型即使通过 `plugin_read` 读取到 `skill.lookup` 的 action metadata，知道内层 action 需要 `payload.name`，也可能因为外层 `plugin_call` schema 的限制而只能生成 `{}`。

## 3. 非目标

本次修复不做以下事情：

- 不修改 `skill` plugin。
- 不修改 `skill.lookup` 的 action schema。
- 不把 `skill.lookup.name` 提升到 `plugin_call` 外层。
- 不为每个 plugin action 动态生成独立模型 tool。
- 不改变 `PluginRegistry.run_action()` 的 payload 校验职责。
- 不改变现有 plugin action 的 `input_schema.zod` 与 `input_schema.json_schema` 设计。

`skill.lookup` 要求 `name` 是正确的业务约束，问题发生在 `plugin_call` 外层通用透传 schema。

## 4. 根因分析

### 4.1 Zod parse 行为没有问题

以下 Zod schema 在 parse 时都可以接受并保留：

```json
{
  "name": "web-access"
}
```

测试对象：

```ts
z.object({}).passthrough()
z.looseObject({})
z.object({}).catchall(z.unknown())
z.object({}).catchall(z.any())
z.record(z.string(), z.unknown())
z.record(z.string(), z.any())
```

这些 schema 的运行时 parse 行为不是问题。

### 4.2 AI SDK 的 Zod schema 导出会收窄开放对象

问题发生在模型 tool schema 序列化阶段。

实测：

```ts
import { z } from "zod";
import { zodSchema } from "ai";

const schema = z.object({
  plugin: z.string(),
  action: z.string(),
  payload: z.object({}).passthrough().optional().default({}),
});

console.log(zodSchema(schema).jsonSchema.properties.payload);
```

当前结果：

```json
{
  "default": {},
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

这与 `plugin_call.payload` 的真实语义冲突。

### 4.3 official edge-worker 可用不代表 schema 正确

official edge-worker 能正常调用 plugin action，主要是模型/provider 链路容错差异。

local-node 的 Kimi Coding 走通用 OpenAI-compatible provider，模型对 tool schema 更严格，因此会被 `additionalProperties: false` 卡住。

official edge-worker 的 Kimi provider 走自定义 Moonshot provider 和服务端 tool 转换链路，可能没有严格裁剪 `payload` 字段，因此能绕过该问题。

因此不能用 official 能跑作为 schema 正确性的依据。

## 5. 目标设计

`plugin_call` 暴露给模型的 JSON Schema 必须明确表达：

- `plugin` 必填，字符串。
- `action` 必填，字符串。
- `payload` 可选，默认 `{}`。
- `payload` 必须是 object。
- `payload` 允许任意字段。
- `plugin_call` 外层不允许除 `plugin`、`action`、`payload` 以外的字段。

目标 schema：

```json
{
  "type": "object",
  "required": ["plugin", "action"],
  "additionalProperties": false,
  "properties": {
    "plugin": {
      "type": "string",
      "description": "Registered plugin name to call, for example image."
    },
    "action": {
      "type": "string",
      "description": "Plugin action name to execute, for example image_create."
    },
    "payload": {
      "type": "object",
      "additionalProperties": true,
      "default": {},
      "description": "JSON payload passed to the plugin action."
    }
  }
}
```

## 6. 建议实现

### 6.1 修改位置

修改文件：

```text
packages/agent/src/executor/tools/plugin/PluginToolSchemas.ts
```

### 6.2 实现方式

对 `plugin_call_input_schema` 使用 AI SDK `jsonSchema()` 显式声明 JSON Schema。

`plugin_read_input_schema` 可以继续使用 Zod，因为它没有任意对象透传需求。

建议实现：

```ts
/**
 * Plugin tool 输入 schema。
 *
 * 关键点（中文）
 * - plugin_call 是 agent 内置的最低层 plugin action 桥。
 * - plugin_call.payload 是透传给具体 plugin action 的 JSON object。
 * - 这里不用 Zod 表达 payload 的开放对象语义，避免 AI SDK zodSchema 转换后把 additionalProperties 收窄为 false。
 */

import { jsonSchema } from "ai";
import { z } from "zod";

export const plugin_call_input_schema = jsonSchema({
  type: "object",
  required: ["plugin", "action"],
  additionalProperties: false,
  properties: {
    plugin: {
      type: "string",
      description: "Registered plugin name to call, for example image.",
    },
    action: {
      type: "string",
      description: "Plugin action name to execute, for example image_create.",
    },
    payload: {
      type: "object",
      additionalProperties: true,
      default: {},
      description: "JSON payload passed to the plugin action.",
    },
  },
});

export const plugin_read_input_schema = z.object({
  plugin: z
    .string()
    .optional()
    .describe("Registered plugin name to inspect. Omit to list plugins."),
  action: z
    .string()
    .optional()
    .describe("Plugin action name to inspect. Requires plugin."),
});
```

### 6.3 为什么不用 `z.object()`

不建议再尝试以下写法：

```ts
z.object({}).passthrough()
z.looseObject({})
z.object({}).catchall(z.unknown())
z.object({}).catchall(z.any())
z.record(z.string(), z.unknown())
z.record(z.string(), z.any())
```

这些写法的 Zod parse 行为是开放的，但在当前 AI SDK `zodSchema()` 导出给模型时仍会变成 `additionalProperties: false`。

`plugin_call.payload` 的关键目标是“模型看到的工具 schema 正确”，因此这里应该直接使用 `jsonSchema()`。

## 7. 测试方案

### 7.1 单元测试：schema 序列化

新增或扩展测试，验证 `plugin_call` 的实际 tool schema。

建议测试目标：

```text
packages/agent/src/executor/tools/plugin/PluginToolSchemas.ts
```

或通过 `create_plugin_tools()` 间接读取 tool schema。

核心断言：

```ts
assert.equal(
  plugin_call_schema.properties.payload.additionalProperties,
  true,
);
```

完整断言建议：

```ts
assert.equal(plugin_call_schema.type, "object");
assert.deepEqual(plugin_call_schema.required, ["plugin", "action"]);
assert.equal(plugin_call_schema.additionalProperties, false);
assert.equal(plugin_call_schema.properties.payload.type, "object");
assert.equal(plugin_call_schema.properties.payload.additionalProperties, true);
```

### 7.2 集成测试：CityModel tool loop

扩展已有测试：

```text
packages/agent/scripts/city-model-tool-loop.test.mjs
```

新增一个模拟工具，使用开放 payload：

```ts
plugin_call({
  plugin: "skill",
  action: "lookup",
  payload: {
    name: "web-access",
  },
});
```

测试服务端收到的 OpenAI function tool schema 中：

```json
{
  "function": {
    "name": "plugin_call",
    "parameters": {
      "properties": {
        "payload": {
          "additionalProperties": true
        }
      }
    }
  }
}
```

### 7.3 手动验证：local-node + Kimi Coding

在 local-node 使用 Kimi Coding 模型时，触发 skill lookup：

```text
读取 web-access skill
```

期望模型调用：

```json
{
  "plugin": "skill",
  "action": "lookup",
  "payload": {
    "name": "web-access"
  }
}
```

不应再出现：

```json
{
  "plugin": "skill",
  "action": "lookup",
  "payload": {}
}
```

## 8. 验收标准

本次修复完成后必须满足：

- `plugin_call.payload` 暴露给模型的 JSON Schema 为 `additionalProperties: true`。
- `plugin_call` 外层仍保持 `additionalProperties: false`。
- `skill.lookup` 不做任何改动。
- `PluginRegistry.run_action()` 仍负责具体 action payload 的运行时校验。
- local-node + Kimi Coding 可以正常生成 `payload.name`。
- existing tool loop 测试仍通过。
- `@downcity/agent` typecheck 通过。

## 9. 发布影响

这是 `@downcity/agent` 的用户可见行为修复。

如果准备提交发布，按仓库约定运行：

```bash
pnpm agent:patch:build
```

如果只做本地验证且不需要 bump，可使用对应 no-bump 验证命令，但正式提交用户可见修复时应执行 patch 构建流程。

## 10. 后续观察

本次修复只解决通用透传 schema 被错误收窄的问题。

后续可以继续观察：

- 是否需要为 `plugin_call.payload` 支持 JSON primitive 或 array。
- 是否需要为部分高频 plugin action 生成独立 tool，提升模型调用稳定性。
- 是否需要在 City client 的 tool 序列化层增加 schema 快照测试，避免未来 AI SDK/Zod 升级再次改变行为。
