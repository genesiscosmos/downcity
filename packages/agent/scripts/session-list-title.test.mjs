/**
 * @file 验证 session 列表从正确目录读取持久化 title。
 *
 * 关键点（中文）
 * - 普通列表只读取 `.downcity/agents/<agent_id>/sessions` 下的 meta。
 * - 归档列表只读取 `.downcity/agents/<agent_id>/archived-sessions` 下的 meta。
 * - title 允许为空；这里仅验证已由模型生成并落盘的 title 能被列表返回。
 */

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { MockLanguageModelV3 } from "ai/test";
import { Agent, Workspace } from "../bin/index.js";

function create_mock_title_model(title_text) {
  return new MockLanguageModelV3({
    modelId: "mock-session-list-title-model",
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "title" });
          controller.enqueue({
            type: "text-delta",
            id: "title",
            delta: title_text,
          });
          controller.enqueue({ type: "text-end", id: "title" });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: {
                total: 0,
                noCache: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: {
                total: 0,
                text: 0,
                reasoning: 0,
              },
            },
          });
          controller.close();
        },
      }),
    }),
  });
}

async function create_agent_with_titled_session(input) {
  const agent_path = await fs.mkdtemp(
    path.join(os.tmpdir(), input.tmp_prefix),
  );
  const agent = new Agent({
    id: input.agent_id,
    model: create_mock_title_model(input.title),
  });
  const entry = agent.enter(new Workspace({ id: "test_workspace", path: agent_path }));
  const collection = entry.sessions;
  const session = await collection.create({
    session_id: input.session_id,
  });
  await session.set({ model: create_mock_title_model(input.title) });

  await session.append_user_message({
    text: input.first_user_text,
  });
  const title_deadline = Date.now() + 1000;
  while (Date.now() < title_deadline) {
    if ((await session.get_info()).title === input.title) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal((await session.get_info()).title, input.title);

  return {
    agent,
    entry,
    collection,
    session,
  };
}

test("list_sessions returns persisted title from active session metadata", async () => {
  const { agent, entry, collection, session } = await create_agent_with_titled_session({
    tmp_prefix: "downcity-agent-session-list-title-",
    agent_id: "list_title_agent",
    session_id: "active_session",
    title: "列表标题",
    first_user_text: "Need the session list to show the generated title",
  });

  try {
    const page = await collection.list();
    const meta = JSON.parse(
      await fs.readFile(
        path.join(
          entry.workspace.path,
          ".downcity",
          "agents",
          encodeURIComponent(agent.id),
          "sessions",
          encodeURIComponent(session.id),
          "messages",
          "meta.json",
        ),
        "utf8",
      ),
    );

    assert.equal(page.total, 1);
    assert.equal(meta.message_count, 1);
    assert.equal(meta.preview_text, "Need the session list to show the generated title");
    const history_stat = await fs.stat(
      path.join(
        entry.workspace.path,
        ".downcity",
        "agents",
        encodeURIComponent(agent.id),
        "sessions",
        encodeURIComponent(session.id),
        "messages",
        "active.jsonl",
      ),
    );
    assert.equal(meta.historyBytes, history_stat.size);
    assert.deepEqual(
      page.items.map((item) => ({
        session_id: item.session_id,
        title: item.title,
        message_count: item.message_count,
      })),
      [
        {
          session_id: session.id,
          title: "列表标题",
          message_count: 1,
        },
      ],
    );
  } finally {
    await agent.dispose();
  }
});

test("list_sessions reflects canonical SessionMessages changes", async () => {
  const { agent, entry, collection, session } = await create_agent_with_titled_session({
    tmp_prefix: "downcity-agent-session-summary-repair-",
    agent_id: "summary_repair_agent",
    session_id: "summary_repair_session",
    title: "摘要修复",
    first_user_text: "Initial history",
  });
  const messages_dir = path.join(
    entry.workspace.path,
    ".downcity",
    "agents",
    encodeURIComponent(agent.id),
    "sessions",
    encodeURIComponent(session.id),
    "messages",
  );
  const messages_path = path.join(messages_dir, "active.jsonl");
  const meta_path = path.join(messages_dir, "meta.json");

  try {
    await session.append_assistant_message({
      text: "Recorder appended history",
    });
    await session.session_messages.compact_active({
      through_sequence: 1,
      summary: {
        record_type: "summary",
        session_id: session.id,
        summary_id: "summary-through-1",
        through_sequence: 1,
        text: "Initial history was compacted.",
        created_at: Date.now(),
      },
    });

    const page = await collection.list();
    const info = await session.get_info();
    const repaired_meta = JSON.parse(await fs.readFile(meta_path, "utf8"));
    const history_stat = await fs.stat(messages_path);
    const segment_stat = await fs.stat(path.join(
      messages_dir,
      "segments",
      "000000000001-000000000001.jsonl",
    ));

    assert.equal(page.items[0].message_count, 2);
    assert.equal(info.message_count, 2);
    assert.equal(page.items[0].preview_text, "Recorder appended history");
    assert.equal(repaired_meta.message_count, 2);
    assert.equal(repaired_meta.preview_text, "Recorder appended history");
    assert.equal(repaired_meta.historyBytes, history_stat.size + segment_stat.size);
  } finally {
    await agent.dispose();
  }
});

test("archive_sessions returns title from archived session metadata", async () => {
  const { agent, collection, session } = await create_agent_with_titled_session({
    tmp_prefix: "downcity-agent-archive-list-title-",
    agent_id: "archive_list_title_agent",
    session_id: "archived_session",
    title: "归档标题",
    first_user_text: "Archive this titled session",
  });

  try {
    await collection.archive({
      id: session.id,
    });

    const active_page = await collection.list();
    const archived_page = await collection.archived();

    assert.equal(active_page.total, 0);
    assert.equal(archived_page.total, 1);
    assert.deepEqual(
      archived_page.items.map((item) => ({
        session_id: item.session_id,
        title: item.title,
        message_count: item.message_count,
      })),
      [
        {
          session_id: session.id,
          title: "归档标题",
          message_count: 1,
        },
      ],
    );
  } finally {
    await agent.dispose();
  }
});
