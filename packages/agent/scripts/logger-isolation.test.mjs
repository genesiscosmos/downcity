/**
 * @file 验证 logger 实例不会跨 workspace 共享落盘目录。
 *
 * 关键点（中文）
 * - 每次 get_logger 调用都应返回独立实例。
 * - 两个实例并发写日志时，只能写入各自绑定数据根的 `logs`。
 */

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { get_logger } from "../bin/index.js";

/**
 * 读取项目日志目录内的全部 JSONL 文本。
 */
async function read_project_logs(project_root) {
  const logs_dir = path.join(project_root, "logs");
  const files = await fs.readdir(logs_dir);
  const jsonl_files = files.filter((file) => file.endsWith(".jsonl"));
  const chunks = await Promise.all(
    jsonl_files.map((file) => fs.readFile(path.join(logs_dir, file), "utf8")),
  );
  return chunks.join("\n");
}

test("get_logger keeps concurrent workspace logs isolated", async () => {
  const root_a = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-logger-isolation-a-"),
  );
  const root_b = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-logger-isolation-b-"),
  );
  const logger_a = get_logger(root_a);
  const logger_b = get_logger(root_b);

  assert.notEqual(logger_a, logger_b);
  await Promise.all([
    logger_a.log("info", "workspace_a_only"),
    logger_b.log("info", "workspace_b_only"),
  ]);
  await Promise.all([logger_a.save_all_logs(), logger_b.save_all_logs()]);

  const [logs_a, logs_b] = await Promise.all([
    read_project_logs(root_a),
    read_project_logs(root_b),
  ]);
  assert.match(logs_a, /workspace_a_only/);
  assert.doesNotMatch(logs_a, /workspace_b_only/);
  assert.match(logs_b, /workspace_b_only/);
  assert.doesNotMatch(logs_b, /workspace_a_only/);
});
