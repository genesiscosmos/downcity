/**
 * task.toml 编解码的回环验证：拿真实任务的正文做往返。
 *
 * 这里断言的是「文件层」的性质，不涉及领域语义——语义由 Model 的测试覆盖。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import yaml from "js-yaml";
import {
  build_task_document,
  parse_task_document,
} from "../bin/task/runtime/TaskDocument.js";

const tasks_dir = path.join(process.env.HOME, ".downcity/powers/task/tasks");

/** 读取现有任务正文，用于回环：新格式读 `prompt`，历史目录读 `task.md`。 */
function read_existing_bodies() {
  if (!fs.existsSync(tasks_dir)) return [];
  const bodies = [];
  for (const id of fs.readdirSync(tasks_dir)) {
    const toml_path = path.join(tasks_dir, id, "task.toml");
    if (fs.existsSync(toml_path)) {
      const parsed = parse_task_document(fs.readFileSync(toml_path, "utf8"));
      if (parsed.ok && parsed.document.multiline.prompt) {
        bodies.push({ id, body: parsed.document.multiline.prompt });
      }
      continue;
    }
    const markdown_path = path.join(tasks_dir, id, "task.md");
    if (!fs.existsSync(markdown_path)) continue;
    const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(fs.readFileSync(markdown_path, "utf8"));
    if (!m) continue;
    bodies.push({ id, body: m[2].replace(/\n+$/, "") });
  }
  return bodies;
}

test("标量保持类型：字符串不会被变成数字或日期", () => {
  const text = build_task_document({
    scalars: {
      title: "2026",
      when: "@manual",
      kind: "user",
      count: 3,
      enabled: true,
    },
  });
  const parsed = parse_task_document(text);
  assert.equal(parsed.ok, true);
  assert.equal(typeof parsed.document.scalars.title, "string");
  assert.equal(parsed.document.scalars.title, "2026");
  assert.equal(parsed.document.scalars.count, 3);
  assert.equal(parsed.document.scalars.enabled, true);
});

test("多行正文：反斜杠与引号原样保留", () => {
  const body = [
    "# 标题",
    "",
    '看到 "双引号" 与反斜杠：C:\\Users\\test',
    "字面 \\n 两个字符",
  ].join("\n");
  const text = build_task_document({
    scalars: { title: "t" },
    multiline: [{ key: "prompt", value: body }],
  });
  const parsed = parse_task_document(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.document.multiline.prompt, body);
});

test("正文自带三引号时降级，仍然无损", () => {
  const body = "写一个函数：\n\n```python\ndef f():\n    '''doc'''\n    pass\n```";
  const text = build_task_document({
    scalars: { title: "t" },
    multiline: [{ key: "prompt", value: body }],
  });
  const parsed = parse_task_document(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.document.multiline.prompt, body);
});

test("正文里的 Markdown 代码块与引号混排无损", () => {
  const fence = String.fromCharCode(96).repeat(3);
  const body = [fence + "json", '{"a": "b"}', fence, "", "注意 **不要** 用爬虫。"].join("\n");
  const text = build_task_document({
    scalars: { title: "t" },
    multiline: [{ key: "prompt", value: body }],
  });
  const parsed = parse_task_document(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.document.multiline.prompt, body);
});

test("数组表排在标量之后，且能回读", () => {
  const text = build_task_document({
    scalars: { title: "t", schedule: "enabled" },
    arrays: [
      {
        key: "occurrences",
        value: [
          { occurrence_id: "2026-10-20 10:00", planned_at: "2026-10-20T02:00:00.022Z", status: "pending" },
        ],
      },
      {
        key: "inbox",
        value: [
          { item_id: "reminder:x", kind: "reminder", message: "到点了", created_at: "2026-10-20T02:00:00.022Z", resolved: false },
        ],
      },
    ],
  });
  const parsed = parse_task_document(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.document.arrays.occurrences.length, 1);
  assert.equal(parsed.document.arrays.inbox.length, 1);
  assert.equal(parsed.document.arrays.inbox[0].resolved, false);
});

test("空表与空数组不写入文件", () => {
  const text = build_task_document({
    scalars: { title: "t" },
    tables: [{ key: "preparing", value: {} }],
    arrays: [{ key: "occurrences", value: [] }],
  });
  assert.equal(text.includes("preparing"), false);
  assert.equal(text.includes("occurrences"), false);
});

test("undefined 标量被省略，不写成空值", () => {
  const text = build_task_document({
    scalars: { title: "t", agent_id: undefined, workspace_id: "" },
  });
  assert.equal(text.includes("agent_id"), false);
  assert.equal(/\n\ntitle/.test(text), false, "首行不应有空行");
  assert.equal(parse_task_document(text).ok, true);
});

test("无法解析的文本返回明确错误，而不是抛异常", () => {
  const parsed = parse_task_document("这不 = = 是 TOML [[[");
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /Invalid TOML/);
});

test("真实任务的正文全部往返无损", () => {
  const bodies = read_existing_bodies();
  assert.ok(bodies.length > 0, "需要至少一个现有任务用于回环验证");
  for (const { id, body } of bodies) {
    const text = build_task_document({
      scalars: { title: "t" },
      multiline: [{ key: "prompt", value: body }],
    });
    const parsed = parse_task_document(text);
    assert.equal(parsed.ok, true, id);
    assert.equal(parsed.document.multiline.prompt, body.replace(/\n+$/, ""), id);
  }
});
