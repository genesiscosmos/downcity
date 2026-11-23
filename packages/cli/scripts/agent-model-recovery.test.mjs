/**
 * Agent 启动模型恢复决策测试。
 *
 * 关键点（中文）
 * - 验证切换 Downtown 后旧模型失配会进入选择流程。
 * - 验证当前 Downtown 无模型时不会构造无意义选择器。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  resolve_agent_execution_model_recovery,
} from "../bin/city/agent/AgentExecutionModelRecovery.js";

test("已保存模型仍在当前 Downtown 时无需恢复", () => {
  assert.deepEqual(
    resolve_agent_execution_model_recovery({
      configured_model: { downtown: "first", id: "model_a" },
      available_models: [{ downtown: "first", id: "model_a" }, { downtown: "first", id: "model_b" }],
    }),
    {
      kind: "ready",
      model: { downtown: "first", id: "model_a" },
    },
  );
});

test("切换 Downtown 后旧模型失配时要求重新选择", () => {
  assert.deepEqual(
    resolve_agent_execution_model_recovery({
      configured_model: { downtown: "first", id: "deepseek-v4-flash" },
      available_models: [{ downtown: "first", id: "kimi-for-coding" }, { downtown: "first", id: "kimi-for-coding-alt" }],
    }),
    {
      kind: "selection_required",
      previous_model: { downtown: "first", id: "deepseek-v4-flash" },
    },
  );
});

test("当前 Downtown 没有模型时返回不可用", () => {
  assert.deepEqual(
    resolve_agent_execution_model_recovery({
      configured_model: { downtown: "first", id: "deepseek-v4-flash" },
      available_models: [],
    }),
    {
      kind: "unavailable",
      previous_model: { downtown: "first", id: "deepseek-v4-flash" },
    },
  );
});

test("同名模型在另一个 Downtown 不视为原选择", () => {
  const previous = { downtown: "first", id: "shared" };
  assert.deepEqual(resolve_agent_execution_model_recovery({ configured_model: previous, available_models: [{ downtown: "second", id: "shared" }] }), {
    kind: "selection_required", previous_model: previous,
  });
});

test("未配置模型时要求显式选择", () => {
  assert.deepEqual(resolve_agent_execution_model_recovery({ configured_model: null, available_models: [{ downtown: "first", id: "shared" }] }), {
    kind: "selection_required", previous_model: null,
  });
});
