/** Desktop 内置 Agent 头像池的资源发现与随机选择测试。 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  list_builtin_agent_avatar_paths,
  select_builtin_agent_avatar_path,
} from "../src/main/agent/BuiltinAgentAvatar.ts";

/** 将头像文件转换为 AgentRepository 返回的 WebP 数据地址。 */
function to_webp_data_url(avatar_path: string): string {
  return `data:image/webp;base64,${fs.readFileSync(avatar_path).toString("base64")}`;
}

test("发现按名称排序的内置 WebP 头像", () => {
  const avatar_paths = list_builtin_agent_avatar_paths();
  assert.equal(avatar_paths.length > 0, true);
  assert.deepEqual(avatar_paths, [...avatar_paths].sort((left, right) => left.localeCompare(right)));
  assert.equal(avatar_paths.every((avatar_path) => path.extname(avatar_path) === ".webp"), true);
});

test("头像池存在多个候选时避开当前头像", () => {
  const avatar_paths = list_builtin_agent_avatar_paths();
  const current_avatar_path = avatar_paths[0];
  const selected_avatar_path = select_builtin_agent_avatar_path(to_webp_data_url(current_avatar_path));
  assert.equal(avatar_paths.includes(selected_avatar_path), true);
  assert.notEqual(selected_avatar_path, current_avatar_path);
});
