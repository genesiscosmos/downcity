/**
 * @file 验证 assistant file part 会把资源落盘为 Agent 根目录相对路径。
 *
 * 关键点（中文）
 * - 历史消息不应长期保存图片 base64。
 * - 送模型前可以从 Agent 根目录相对路径临时 hydrate 回 data URL。
 */

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import http from "node:http";
import { pathToFileURL } from "node:url";

import { materialize_assistant_file_parts } from "../bin/executor/messages/AssistantFileResource.js";
import {
  hydrate_user_prompt_file_parts,
  hydrate_file_url_parts_for_model,
  inject_file_parts_from_attachments,
} from "../bin/executor/messages/SessionAttachmentMapper.js";

function resource_path_from_relative_path(project_root, relative_path) {
  return path.join(project_root, String(relative_path || ""));
}

test("materialize_assistant_file_parts stores data URL images under .downcity/resources", async () => {
  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-assistant-resource-"),
  );
  const bytes = Buffer.from("png-bytes-for-test", "utf8");
  const data_url = `data:image/png;base64,${bytes.toString("base64")}`;

  const parts = await materialize_assistant_file_parts({
    project_root: project_root,
    parts: [
      {
        type: "file",
        mediaType: "image/png",
        filename: "image-1.png",
        url: data_url,
      },
    ],
  });

  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "file");
  assert.equal(parts[0].mediaType, "image/png");
  assert.equal(parts[0].filename, "image-1.png");
  assert.match(parts[0].url, /^\.downcity\/resources\//);
  assert.equal(parts[0].url.includes("base64"), false);

  const resource_path = resource_path_from_relative_path(project_root, parts[0].url);
  assert.equal(
    path.dirname(resource_path),
    path.join(project_root, ".downcity", "resources"),
  );
  assert.deepEqual(await fs.readFile(resource_path), bytes);
});

test("materialize_assistant_file_parts downloads remote file URLs into resources", async () => {
  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-assistant-remote-resource-"),
  );
  const bytes = Buffer.from("remote-png-bytes-for-test", "utf8");
  const server = http.createServer((_, response) => {
    response.writeHead(200, { "content-type": "image/png" });
    response.end(bytes);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const remote_url = `http://127.0.0.1:${address.port}/image.png`;

    const parts = await materialize_assistant_file_parts({
      project_root: project_root,
      parts: [
        {
          type: "file",
          mediaType: "image/png",
          filename: "remote.png",
          url: remote_url,
        },
      ],
    });

    assert.match(parts[0].url, /^\.downcity\/resources\//);
    assert.equal(parts[0].url.startsWith("http://"), false);
    assert.deepEqual(
      await fs.readFile(resource_path_from_relative_path(project_root, parts[0].url)),
      bytes,
    );
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("materialize_assistant_file_parts rejects oversized remote resources before download", async () => {
  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-assistant-large-resource-"),
  );
  const server = http.createServer((_, response) => {
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(26 * 1024 * 1024),
    });
    response.end("oversized");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const remote_url = `http://127.0.0.1:${address.port}/large.bin`;
    const parts = await materialize_assistant_file_parts({
      project_root: project_root,
      parts: [
        {
          type: "file",
          mediaType: "application/octet-stream",
          url: remote_url,
        },
      ],
    });

    assert.equal(parts[0].url, remote_url);
    const resources_path = path.join(project_root, ".downcity", "resources");
    await assert.rejects(fs.access(resources_path));
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("materialize_assistant_file_parts resolves relative local file URLs from agent project root", async () => {
  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-assistant-relative-resource-"),
  );
  const bytes = Buffer.from("relative-local-png-bytes", "utf8");
  await fs.writeFile(path.join(project_root, "input.png"), bytes);

  const parts = await materialize_assistant_file_parts({
    project_root: project_root,
    parts: [
      {
        type: "file",
        mediaType: "image/png",
        filename: "input.png",
        url: "./input.png",
      },
    ],
  });

  assert.match(parts[0].url, /^\.downcity\/resources\//);
  assert.deepEqual(
    await fs.readFile(resource_path_from_relative_path(project_root, parts[0].url)),
    bytes,
  );
});

test("hydrate_file_url_parts_for_model converts relative resource paths back to data URLs in memory", async () => {
  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-assistant-hydrate-"),
  );
  const bytes = Buffer.from("hydrate-bytes-for-test", "utf8");
  const materialized = await materialize_assistant_file_parts({
    project_root: project_root,
    parts: [
      {
        type: "file",
        mediaType: "image/png",
        filename: "image-1.png",
        url: `data:image/png;base64,${bytes.toString("base64")}`,
      },
    ],
  });

  const messages = await hydrate_file_url_parts_for_model(
    [
      {
        id: "a:test:1",
        role: "assistant",
        metadata: {
          v: 1,
          ts: Date.now(),
          session_id: "session_test",
        },
        parts: materialized,
      },
    ],
    project_root,
  );

  const hydrated_part = messages[0]?.parts[0];
  assert.equal(hydrated_part?.type, "file");
  assert.equal(hydrated_part?.mediaType, "image/png");
  assert.equal(
    hydrated_part?.url,
    `data:image/png;base64,${bytes.toString("base64")}`,
  );
  assert.match(materialized[0].url, /^\.downcity\/resources\//);
});

test("hydrate_user_prompt_file_parts converts local image paths to data URLs before persistence", async () => {
  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-user-prompt-image-"),
  );
  const bytes = Buffer.from("user-prompt-image-bytes", "utf8");
  const image_path = path.join(project_root, "image.png");
  await fs.writeFile(image_path, bytes);

  const parts = await hydrate_user_prompt_file_parts(
    [
      {
        type: "text",
        text: "这张图写了啥",
      },
      {
        type: "file",
        mediaType: "image/png",
        filename: "image.png",
        url: image_path,
      },
    ],
    project_root,
  );

  assert.equal(parts[0]?.type, "text");
  assert.equal(parts[1]?.type, "file");
  assert.equal(parts[1]?.mediaType, "image/png");
  assert.equal(
    parts[1]?.url,
    `data:image/png;base64,${bytes.toString("base64")}`,
  );
});

test("hydrate_user_prompt_file_parts keeps existing data URLs and non-image files unchanged", async () => {
  const data_url = "data:image/png;base64,already-base64";
  const pdf_url = "/tmp/input.pdf";
  const parts = await hydrate_user_prompt_file_parts(
    [
      {
        type: "file",
        mediaType: "image/png",
        filename: "image.png",
        url: data_url,
      },
      {
        type: "file",
        mediaType: "application/pdf",
        filename: "input.pdf",
        url: pdf_url,
      },
    ],
    process.cwd(),
  );

  assert.equal(parts[0]?.url, data_url);
  assert.equal(parts[1]?.url, pdf_url);
});

test("hydrate_file_url_parts_for_model keeps old file URLs compatible", async () => {
  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-assistant-file-url-"),
  );
  const bytes = Buffer.from("legacy-file-url-bytes", "utf8");
  const file_path = path.join(project_root, "legacy.png");
  await fs.writeFile(file_path, bytes);

  const messages = await hydrate_file_url_parts_for_model(
    [
      {
        id: "a:test:legacy",
        role: "assistant",
        metadata: {
          v: 1,
          ts: Date.now(),
          session_id: "session_test",
        },
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            filename: "legacy.png",
            url: pathToFileURL(file_path).href,
          },
        ],
      },
    ],
    project_root,
  );

  const hydrated_part = messages[0]?.parts[0];
  assert.equal(hydrated_part?.type, "file");
  assert.equal(
    hydrated_part?.url,
    `data:image/png;base64,${bytes.toString("base64")}`,
  );
});

test("inject_file_parts_from_attachments resolves relative file tags from agent project root", async () => {
  const project_root = await fs.mkdtemp(
    path.join(os.tmpdir(), "downcity-agent-attachment-relative-"),
  );
  const bytes = Buffer.from("attachment-relative-png-bytes", "utf8");
  await fs.writeFile(path.join(project_root, "input.png"), bytes);

  const messages = await inject_file_parts_from_attachments(
    [
      {
        id: "u:test:attachment",
        role: "user",
        metadata: {
          v: 1,
          ts: Date.now(),
          session_id: "session_test",
        },
        parts: [
          {
            type: "text",
            text: '<file type="photo">./input.png</file>',
          },
        ],
      },
    ],
    project_root,
  );

  const injected_part = messages[0]?.parts[1];
  assert.equal(injected_part?.type, "file");
  assert.equal(injected_part?.mediaType, "image/png");
  assert.equal(
    injected_part?.url,
    `data:image/png;base64,${bytes.toString("base64")}`,
  );
});
