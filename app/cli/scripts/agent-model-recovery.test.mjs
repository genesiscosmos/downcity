/**
 * Agent 启动模型恢复决策测试。
 *
 * 关键点（中文）
 * - 验证切换 Federation 后旧模型失配会进入选择流程。
 * - 验证当前 Federation 无模型时不会构造无意义选择器。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  resolve_agent_execution_model_recovery,
} from "../bin/city/agent/AgentExecutionModelRecovery.js";

test("已保存模型仍在当前 Federation 时无需恢复", () => {
  assert.deepEqual(
    resolve_agent_execution_model_recovery({
      configured_model_id: "model_a",
      available_model_ids: ["model_a", "model_b"],
    }),
    {
      kind: "ready",
      model_id: "model_a",
    },
  );
});

test("切换 Federation 后旧模型失配时要求重新选择", () => {
  assert.deepEqual(
    resolve_agent_execution_model_recovery({
      configured_model_id: "deepseek-v4-flash",
      available_model_ids: ["kimi-for-coding", "kimi-for-coding-alt"],
    }),
    {
      kind: "selection_required",
      previous_model_id: "deepseek-v4-flash",
    },
  );
});

test("当前 Federation 没有模型时返回不可用", () => {
  assert.deepEqual(
    resolve_agent_execution_model_recovery({
      configured_model_id: "deepseek-v4-flash",
      available_model_ids: [],
    }),
    {
      kind: "unavailable",
      previous_model_id: "deepseek-v4-flash",
    },
  );
});

test("模型目录会忽略空 ID 并去重", () => {
  assert.deepEqual(
    resolve_agent_execution_model_recovery({
      configured_model_id: "",
      available_model_ids: ["", "model_a", "model_a"],
    }),
    {
      kind: "selection_required",
      previous_model_id: "",
    },
  );
});
