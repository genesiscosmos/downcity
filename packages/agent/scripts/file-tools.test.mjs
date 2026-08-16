/**
 * @file 验证 Workspace 可装配的结构化文件工具。
 *
 * 关键点（中文）
 * - 覆盖读取分页、二进制识别、原子写入和精确编辑。
 * - 覆盖项目根目录边界、符号链接逃逸和并发 hash 保护。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Workspace } from "@downcity/agent";

async function create_fixture(t) {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-file-tools-"));
  const outside_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-file-tools-outside-"));
  t.after(async () => {
    await fs.rm(root_path, { recursive: true, force: true });
    await fs.rm(outside_path, { recursive: true, force: true });
  });
  return {
    root_path,
    outside_path,
    tools: new Workspace({ id: "test_workspace", path: root_path, data_root_path: path.join(root_path, "data") }).tools,
  };
}

async function execute_tool(tools, name, input) {
  return (await execute_action_tool(tools, name, input)).output;
}

async function execute_action_tool(tools, name, input) {
  const execute = tools[name]?.execute;
  assert.equal(typeof execute, "function", `${name} tool must be executable`);
  return await execute(input, {
    toolCallId: `test-${name}`,
    messages: [],
    abortSignal: new AbortController().signal,
  });
}

test("write creates parents and read paginates text with a stable hash", async (t) => {
  const fixture = await create_fixture(t);
  const written = await execute_tool(fixture.tools, "write", {
    file_path: "nested/example.txt",
    content: "first\r\nsecond\r\nthird\r\nfourth\r\n",
  });
  assert.equal(written.success, true);
  assert.equal(written.overwritten, false);
  assert.equal(written.lines_written, 4);
  assert.equal(
    await fs.readFile(path.join(fixture.root_path, "nested/example.txt"), "utf8"),
    "first\nsecond\nthird\nfourth\n",
  );

  const first_page = await execute_tool(fixture.tools, "read", {
    file_path: "nested/example.txt",
    limit: 2,
  });
  assert.equal(first_page.success, true);
  assert.equal(first_page.content, "first\nsecond");
  assert.equal(first_page.total_lines, 4);
  assert.equal(first_page.start_line, 0);
  assert.equal(first_page.end_line, 1);
  assert.equal(first_page.truncated, true);
  assert.equal(first_page.next_offset, 2);
  assert.match(first_page.sha256, /^[a-f0-9]{64}$/);

  const second_page = await execute_tool(fixture.tools, "read", {
    file_path: "nested/example.txt",
    offset: first_page.next_offset,
    limit: 2,
  });
  assert.equal(second_page.success, true);
  assert.equal(second_page.content, "third\nfourth");
  assert.equal(second_page.truncated, false);
});

test("write rejects implicit overwrite and preserves file permissions", async (t) => {
  const fixture = await create_fixture(t);
  const file_path = path.join(fixture.root_path, "mode.txt");
  await fs.writeFile(file_path, "before\n", { mode: 0o640 });

  const rejected = await execute_tool(fixture.tools, "write", {
    file_path: "mode.txt",
    content: "after\n",
  });
  assert.equal(rejected.success, false);
  assert.equal(rejected.error_code, "file_exists");
  assert.equal(await fs.readFile(file_path, "utf8"), "before\n");

  const replaced = await execute_tool(fixture.tools, "write", {
    file_path: "mode.txt",
    content: "after\n",
    overwrite: true,
  });
  assert.equal(replaced.success, true);
  assert.equal(replaced.overwritten, true);
  assert.equal((await fs.stat(file_path)).mode & 0o777, 0o640);
  assert.equal(await fs.readFile(file_path, "utf8"), "after\n");
});

test("read identifies binary files without returning raw bytes", async (t) => {
  const fixture = await create_fixture(t);
  await fs.writeFile(
    path.join(fixture.root_path, "image.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]),
  );
  const result = await execute_tool(fixture.tools, "read", {
    file_path: "image.png",
  });
  assert.equal(result.success, true);
  assert.equal(result.type, "binary");
  assert.equal(result.mime_type, "image/png");
  assert.equal(result.content, "");
  assert.equal(result.total_lines, 0);
});

test("read returns images as next-step User File Parts", async (t) => {
  const fixture = await create_fixture(t);
  const image = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x01, 0x02, 0x03,
  ]);
  await fs.writeFile(path.join(fixture.root_path, "input.bin"), image);

  const result = await execute_action_tool(fixture.tools, "read", {
    file_path: "input.bin",
  });
  assert.equal(result.output.success, true);
  assert.equal(result.output.type, "image");
  assert.equal(result.output.mime_type, "image/png");
  assert.equal(result.output.content, "");
  assert.deepEqual(result.messages, [{
    role: "user",
    parts: [{
      type: "file",
      url: result.output.file_path,
      mediaType: "image/png",
      filename: "input.bin",
    }],
  }]);
});

test("read returns PDFs as next-step User File Parts", async (t) => {
  const fixture = await create_fixture(t);
  await fs.writeFile(
    path.join(fixture.root_path, "document.pdf"),
    Buffer.from("%PDF-1.7\n% binary\u0000content", "utf8"),
  );

  const result = await execute_action_tool(fixture.tools, "read", {
    file_path: "document.pdf",
  });
  assert.equal(result.output.success, true);
  assert.equal(result.output.type, "binary");
  assert.equal(result.output.mime_type, "application/pdf");
  assert.deepEqual(result.messages, [{
    role: "user",
    parts: [{
      type: "file",
      url: result.output.file_path,
      mediaType: "application/pdf",
      filename: "document.pdf",
    }],
  }]);
});

test("file tools reject project escapes and symbolic-link escapes", async (t) => {
  const fixture = await create_fixture(t);
  const direct_escape = await execute_tool(fixture.tools, "write", {
    file_path: path.join(fixture.outside_path, "escape.txt"),
    content: "blocked",
  });
  assert.equal(direct_escape.success, false);
  assert.equal(direct_escape.error_code, "sandbox_denied");

  await fs.symlink(fixture.outside_path, path.join(fixture.root_path, "outside-link"));
  const symlink_escape = await execute_tool(fixture.tools, "write", {
    file_path: "outside-link/escape.txt",
    content: "blocked",
  });
  assert.equal(symlink_escape.success, false);
  assert.equal(symlink_escape.error_code, "sandbox_denied");
  await assert.rejects(fs.access(path.join(fixture.outside_path, "escape.txt")));
});

test("edit applies multiple exact replacements atomically and preserves CRLF", async (t) => {
  const fixture = await create_fixture(t);
  const file_path = path.join(fixture.root_path, "edit.txt");
  await fs.writeFile(file_path, "alpha\r\nvalue = 1\r\nomega\r\n", "utf8");
  const before = await execute_tool(fixture.tools, "read", {
    file_path: "edit.txt",
  });
  assert.equal(before.success, true);

  const edited = await execute_tool(fixture.tools, "edit", {
    file_path: "edit.txt",
    expected_sha256: before.sha256,
    edits: [
      { old_text: "value = 1", new_text: "value = 2" },
      { old_text: "omega", new_text: "done\nnext" },
    ],
  });
  assert.equal(edited.success, true);
  assert.equal(edited.applied, 2);
  assert.equal(edited.new_total_lines, 4);
  assert.equal(
    await fs.readFile(file_path, "utf8"),
    "alpha\r\nvalue = 2\r\ndone\r\nnext\r\n",
  );
});

test("edit rejects duplicate, overlapping, and stale operations without writes", async (t) => {
  const fixture = await create_fixture(t);
  const file_path = path.join(fixture.root_path, "guarded.txt");
  await fs.writeFile(file_path, "abc abc def\n", "utf8");

  const duplicate = await execute_tool(fixture.tools, "edit", {
    file_path: "guarded.txt",
    edits: [{ old_text: "abc", new_text: "x" }],
  });
  assert.equal(duplicate.success, false);
  assert.equal(duplicate.error_code, "duplicate_match");
  assert.equal(await fs.readFile(file_path, "utf8"), "abc abc def\n");

  await fs.writeFile(file_path, "abcdef\n", "utf8");
  const before = await execute_tool(fixture.tools, "read", {
    file_path: "guarded.txt",
  });
  assert.equal(before.success, true);
  const overlapping = await execute_tool(fixture.tools, "edit", {
    file_path: "guarded.txt",
    edits: [
      { old_text: "abc", new_text: "x" },
      { old_text: "bcd", new_text: "y" },
    ],
  });
  assert.equal(overlapping.success, false);
  assert.equal(overlapping.error_code, "overlapping_edits");
  assert.equal(await fs.readFile(file_path, "utf8"), "abcdef\n");

  await fs.writeFile(file_path, "changed\n", "utf8");
  const stale = await execute_tool(fixture.tools, "edit", {
    file_path: "guarded.txt",
    expected_sha256: before.sha256,
    edits: [{ old_text: "changed", new_text: "overwritten" }],
  });
  assert.equal(stale.success, false);
  assert.equal(stale.error_code, "file_changed");
  assert.equal(await fs.readFile(file_path, "utf8"), "changed\n");
});

test("edit preserves UTF-16LE encoding and BOM", async (t) => {
  const fixture = await create_fixture(t);
  const file_path = path.join(fixture.root_path, "utf16.txt");
  const original = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from("hello\r\n", "utf16le"),
  ]);
  await fs.writeFile(file_path, original);

  const read_result = await execute_tool(fixture.tools, "read", {
    file_path: "utf16.txt",
  });
  assert.equal(read_result.success, true);
  assert.equal(read_result.encoding, "utf-16le");
  assert.equal(read_result.content, "hello");

  const edit_result = await execute_tool(fixture.tools, "edit", {
    file_path: "utf16.txt",
    expected_sha256: read_result.sha256,
    edits: [{ old_text: "hello", new_text: "world" }],
  });
  assert.equal(edit_result.success, true);
  const next_buffer = await fs.readFile(file_path);
  assert.deepEqual([...next_buffer.subarray(0, 2)], [0xff, 0xfe]);
  assert.equal(next_buffer.subarray(2).toString("utf16le"), "world\r\n");
});
