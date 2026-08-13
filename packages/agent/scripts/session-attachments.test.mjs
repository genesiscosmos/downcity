/**
 * @file 验证 Session prompt 的 Data URL 附件会先落盘，再以路径持久化。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalFileSystem } from "../bin/workspace/LocalFileSystem.js";
import { LocalSessionDataStore } from "../bin/workspace/store/LocalSessionDataStore.js";
import { SessionMessages } from "../bin/session/SessionMessages.js";

async function create_harness() {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-session-attachment-"));
  const files = new LocalFileSystem(root_path);
  const store = new LocalSessionDataStore({
    files,
    agent_id: "attachment-test-agent",
    session_id: "attachment-test-session",
  });
  const messages = new SessionMessages({
    session_id: "attachment-test-session",
    store: store.messages,
    attachment_store: store.attachments,
    publish: () => {},
  });
  await messages.initialize();
  return { root_path, store, messages };
}

test("Data URL 落盘后保留用户文件名并保存相对路径", async () => {
  const harness = await create_harness();
  const result = await harness.messages.append_prompt_message({
    turn_id: "turn-1",
    input_type: "prompt",
    prompt: {
      query: [{
        type: "file",
        mediaType: "image/png",
        url: "data:image/png;base64,aGVsbG8=",
        filename: "diagram.png",
      }],
    },
    project_root: harness.root_path,
  });

  const part = result.parts[0];
  assert.equal(part.type, "file");
  assert.match(part.url, /^\.downcity\/agents\/attachment-test-agent\/sessions\/attachment-test-session\/attachments\/att_/);
  assert.equal(part.url.endsWith(".png"), true);
  assert.equal(part.filename, "diagram.png");
  assert.equal(
    (await fs.readFile(path.join(harness.root_path, part.url))).toString(),
    "hello",
  );
  assert.equal(part.url.includes("base64"), false);
});

test("视频 Data URL 使用 MIME 类型和扩展名落盘", async () => {
  const harness = await create_harness();
  const result = await harness.messages.append_prompt_message({
    turn_id: "turn-1",
    input_type: "prompt",
    prompt: {
      query: [{
        type: "file",
        mediaType: "video/mp4",
        url: "data:video/mp4;base64,AQID",
        filename: "demo.mp4",
      }],
    },
    project_root: harness.root_path,
  });

  const part = result.parts[0];
  assert.equal(part.url.endsWith(".mp4"), true);
  assert.deepEqual(
    [...await fs.readFile(path.join(harness.root_path, part.url))],
    [1, 2, 3],
  );
});

test("无效 Data URL 不会写入 Session Message", async () => {
  const harness = await create_harness();
  await assert.rejects(
    harness.messages.append_prompt_message({
      turn_id: "turn-1",
      input_type: "prompt",
      prompt: {
        query: [{
          type: "file",
          mediaType: "image/png",
          url: "data:image/png;base64",
        }],
      },
      project_root: harness.root_path,
    }),
    /Invalid data URL/,
  );
  assert.deepEqual(await harness.store.messages.list_messages(), []);
});
