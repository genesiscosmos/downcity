/**
 * Agent SDK 公开命名约束测试。
 *
 * 关键点（中文）
 * - 类型名保持 PascalCase。
 * - Downcity 自有公开函数、方法和字段统一使用 snake_case。
 * - 第三方 AI SDK 原始结构不纳入本检查。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const package_root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const public_declaration_files = [
  "types/agent/AgentOptions.d.ts",
  "types/agent/SessionActor.d.ts",
  "types/agent/SessionTypes.d.ts",
  "types/agent/RemoteAgentOptions.d.ts",
  "types/agent/RemoteAgentPluginAction.d.ts",
  "types/sdk/AgentSessionPrompt.d.ts",
  "types/sdk/AgentSessionStop.d.ts",
  "types/sdk/AgentSessionTurn.d.ts",
  "types/session/SessionOptions.d.ts",
  "types/session/SessionPort.d.ts",
  "types/plugin/PluginContext.d.ts",
  "types/plugin/PluginRuntime.d.ts",
  "types/plugin/PluginAction.d.ts",
  "types/plugin/PluginCommand.d.ts",
  "types/plugin/PluginHttp.d.ts",
  "types/plugin/PluginRunContext.d.ts",
  "types/plugin/PluginSetup.d.ts",
  "plugin/types/ActionSchedule.d.ts",
];

/** 删除声明文件注释，避免示例文本参与标识符检查。 */
function strip_comments(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

test("Agent SDK public members use snake_case", () => {
  const failures = [];
  const camel_member_pattern =
    /^\s+(?:readonly\s+)?([a-z][A-Za-z0-9_]*[A-Z][A-Za-z0-9_]*)(?:\??:|\??\()/gm;

  for (const relative_path of public_declaration_files) {
    const file_path = path.join(package_root, "bin", relative_path);
    const content = strip_comments(fs.readFileSync(file_path, "utf8"));
    for (const match of content.matchAll(camel_member_pattern)) {
      failures.push(`${relative_path}: ${match[1]}`);
    }
  }

  assert.deepEqual(failures, []);
});

test("Agent SDK root exports do not expose camelCase functions", () => {
  const file_path = path.join(package_root, "bin", "index.d.ts");
  const content = strip_comments(fs.readFileSync(file_path, "utf8"))
    .replace(/from\s+["'][^"']+["']/g, "")
    .replace(/export\s+\*\s+["'][^"']+["']/g, "");
  const camel_function_exports = [
    ...content.matchAll(/\b([a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*)\b/g),
  ].map((match) => match[1]);

  assert.deepEqual([...new Set(camel_function_exports)], []);
});
