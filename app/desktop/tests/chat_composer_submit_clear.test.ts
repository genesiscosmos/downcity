/**
 * Chat Composer 发送后清空的守卫。
 *
 * ## 为什么需要这个文件
 *
 * 输入清空曾经是「间接生效」的：`use_desktop.send_message` 会删除 composer store 中的草稿，
 * 编辑器再靠 `draft_content` 的变化回灌成空文档。这条链路有一个时间窗口——
 * 草稿写入 store 有 300ms 防抖，用户快速输入后立刻回车时 store 里**还没有**该 Session 的键，
 * 删除不产生任何状态变化，编辑器收不到清空信号，输入框就留下已经发出去的内容。
 * 于是缺陷表现为「有时候清得掉，有时候清不掉」，只在快速输入时复现。
 *
 * 现在清空由编辑器在提交时同步完成，不依赖 store 往返。本文件锁住两件事：
 *
 * 1. 提交路径必须自己清空编辑器，且清空不得派发 update（否则清空会被当成新输入写回 store）；
 * 2. 提交不得再依赖 store 删除草稿来清空——即不再出现「只删除、不清空」的写法。
 *
 * 断言源码而不是渲染结果，是因为本仓库的测试不引入 DOM 环境（见 design_token_drift）。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const editor_path = path.join(
  import.meta.dirname,
  "../src/renderer/features/chat/composer/RichTextEditor.tsx",
);

/** 读取渲染层文件，去掉注释——注释里会引用被禁止的写法来解释为什么禁止。 */
function read_without_comments(file_path: string): string {
  return fs.readFileSync(file_path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const source = read_without_comments(editor_path);

/** 取出提交函数的函数体，避免用整文件断言误伤其他位置的 clearContent。 */
function read_submit_body(): string {
  const match = /const submit_message = useCallback\([\s\S]*?\n  \}, \[[^\]]*\]\);/.exec(source);
  assert.ok(match, "RichTextEditor 里找不到 submit_message 定义");
  return match![0];
}

test("提交路径同步清空编辑器，且清空不派发 update", () => {
  const body = read_submit_body();

  assert.ok(
    /clear_editor_after_submit\(\)/.test(body),
    "submit_message 没有调用 clear_editor_after_submit：发送后输入可能残留",
  );

  const clear = /const clear_editor_after_submit = useCallback\(([\s\S]*?)\n  \}, \[\]\);/.exec(source);
  assert.ok(clear, "RichTextEditor 里找不到 clear_editor_after_submit 定义");
  assert.ok(
    /commands\.clearContent\(false\)/.test(clear![1]!),
    "清空必须用 clearContent(false)：派发 update 会把清空当成新输入写回草稿",
  );
});

test("清空后把空文档登记为本地已发布草稿", () => {
  const clear = /const clear_editor_after_submit = useCallback\(([\s\S]*?)\n  \}, \[\]\);/.exec(source);
  assert.ok(clear, "RichTextEditor 里找不到 clear_editor_after_submit 定义");
  assert.ok(
    /locally_published_draft_ref\.current = empty_chat_content/.test(clear![1]!),
    "清空后没有登记本地已发布草稿：store 的删除动作会再回灌一次，产生无意义的编辑器写入",
  );
});

test("提交先丢弃防抖草稿，避免迟到计时器把已发送内容写回", () => {
  const body = read_submit_body();

  assert.ok(
    /discard_pending_draft\(\)/.test(body),
    "submit_message 没有先 discard_pending_draft：300ms 防抖计时器会把已发送内容重新写回草稿",
  );
  assert.ok(
    body.indexOf("discard_pending_draft()") < body.indexOf("clear_editor_after_submit()"),
    "必须先丢弃防抖草稿再清空编辑器，否则清空后仍可能被迟到回写覆盖",
  );
});

test("提交失败不能让编辑器停留在无法恢复的状态", () => {
  const body = read_submit_body();

  assert.ok(
    /\.catch\(\(\) => undefined\)/.test(body),
    "send_message 的拒绝未被接住：失败时应在 finally 中复位提交状态，而不是让异常逃逸出编辑器",
  );
  assert.ok(
    /finally \{[\s\S]*submitting_ref\.current = false/.test(body),
    "提交状态没有在 finally 中复位：失败后输入框会永久禁用",
  );
});
