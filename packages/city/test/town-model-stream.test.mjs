/** Town 原生模型流路由回归：使用服务端实际声明的 stream 能力，保持来源与其他能力隔离。 */
import assert from "node:assert/strict";
import test from "node:test";
import { Downtown } from "@downcity/downtown";
import { Town } from "../bin/index.js";

const call = { messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }] };

test("Town routes stream-only language models to their original Downtown model", async () => {
  const { town, downtown, requests } = create_fixture(["stream"]);
  try {
    const model_id = { downtown: "official", id: "krill-gpt-6.1-sol" };
    const catalog = await town.models.list();
    assert.deepEqual(catalog.items[0].model, model_id);
    assert.equal(catalog.items[0].id, "krill-gpt-6.1-sol");
    assert.deepEqual(catalog.items[0].model, { downtown: "official", id: "krill-gpt-6.1-sol" });
    const client = town.models.client(catalog.items[0].model);
    assert.deepEqual(client.model_reference, catalog.items[0].model);
    const stream = await client.stream(call);
    const events = [];
    for await (const event of stream) events.push(event);
    assert.deepEqual(events.map((event) => event.type), ["model_start", "text_start", "text_delta", "model_usage", "text_finish", "model_finish"]);
    assert.equal(events.find((event) => event.type === "text_delta").delta, "OK");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model_id, "krill-gpt-6.1-sol");
    assert.deepEqual(requests[0].call, call);
  } finally {
    await town.close();
    await downtown.dispose();
  }
});

for (const modalities of [["image"], ["text"]]) {
  test(`Town refuses a model without stream capability (${modalities.join(",")}) before invoking it`, async () => {
    const { town, downtown, requests } = create_fixture(modalities);
    try {
      const client = town.models.client({ downtown: "official", id: "krill-gpt-6.1-sol" });
      const error = await client.stream(call).then(async (stream) => {
        await stream.cancel();
        return undefined;
      }, (error) => error);
      assert.equal(error?.code, "town_model_capability_unavailable");
      assert.equal(requests.length, 0);
    } finally {
      await town.close();
      await downtown.dispose();
    }
  });
}

/** 在 HTTP 边界提供目录与标准 SSE；路由和解析均使用真实 SDK。 */
function create_fixture(modalities) {
  const requests = [];
  const downtown = new Downtown({
    url: "https://official.example",
    user_token: "test-token",
    fetch: async (url, init) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/v1/ai/models") return Response.json({ items: [{
        id: "krill-gpt-6.1-sol", name: "GPT-6.1 Sol (Krill)", model_type: "language",
        description: "", modalities, tags: ["krill"], meta: {},
      }] });
      assert.equal(pathname, "/v1/ai/stream");
      requests.push(JSON.parse(init.body));
      const events = [
        { type: "model_start", request_id: "req_test", model_id: "krill-gpt-6.1-sol" },
        { type: "text_start", content_id: "text_1" },
        { type: "text_delta", content_id: "text_1", delta: "OK" },
        { type: "model_usage", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
        { type: "text_finish", content_id: "text_1" },
        { type: "model_finish", finish_reason: "stop" },
      ];
      return new Response(events.map((event) => `data: ${JSON.stringify({ protocol_version: 1, event })}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  const town = new Town("city_test");
  town.add("official", downtown);
  return { town, downtown, requests };
}
