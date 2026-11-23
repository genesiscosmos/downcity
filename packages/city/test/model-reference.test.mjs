/** 模型来源契约回归：规范地址、原始 ID、身份隔离与直接客户端的执行生命周期。 */
import assert from "node:assert/strict";
import test from "node:test";
import { Downtown } from "@downcity/downtown";
import { is_model_reference, same_model } from "@downcity/type";
import { Town, create_downtown_id, normalize_downtown_url } from "../bin/index.js";

const call = { messages: [] };

/** 用真实 Downtown HTTP 边界记录传往每个来源的模型 ID。 */
function source(url, requests) {
  return new Downtown({ url, user_token: "test-token", fetch: async (input, init) => {
    if (new URL(input).pathname === "/v1/ai/models") return Response.json({ items: [{
      id: "same:model/名称", name: "Same model", model_type: "language", description: "", modalities: ["stream"], tags: [], meta: {},
    }] });
    requests.push({ url, body: JSON.parse(init.body) });
    const events = [{ type: "model_start", request_id: "test", model_id: "same:model/名称" }, { type: "model_usage", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } }, { type: "model_finish", finish_reason: "stop" }];
    return new Response(events.map((event) => `data: ${JSON.stringify({ protocol_version: 1, event })}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  } });
}

test("Downtown 地址规范化生成稳定且不暴露地址的内部 ID", () => {
  const id = create_downtown_id("HTTPS://EXAMPLE.COM:443/a///");
  assert.equal(id, create_downtown_id("https://example.com/a"));
  assert.equal(id.length, 22);
  assert.equal(normalize_downtown_url("HTTPS://EXAMPLE.COM:443/"), "https://example.com");
  for (const url of ["http://example.com/a", "https://example.com:444/a", "https://example.com/b"]) assert.notEqual(create_downtown_id(url), id);
  for (const url of ["ftp://example.com", "https://user:secret@example.com", "https://example.com?token=x", "https://example.com#token"]) assert.throws(() => create_downtown_id(url));
});

test("结构引用跨 JSON 往返仍按来源相等，双来源与编码字符串被拒绝", () => {
  const model = { downtown: "a", id: "same:model/名称" };
  assert.ok(same_model(model, JSON.parse(JSON.stringify(model))));
  assert.equal(same_model(model, { downtown: "b", id: model.id }), false);
  assert.equal(same_model(model, { client: "a", id: model.id }), false);
  assert.equal(is_model_reference("same:model/名称"), false);
  assert.equal(is_model_reference({ ...model, client: "b" }), false);
});

test("同名模型在两个 Downtown 隔离，传输层只收到原始 ID", async () => {
  const requests = [];
  const first = source("https://first.example", requests);
  const second = source("https://second.example", requests);
  const town = new Town("test");
  town.add("first", first, { auth_scope_id: "account-a" });
  town.add("second", second, { auth_scope_id: "account-b" });
  try {
    const { items } = await town.models.list();
    assert.equal(items.length, 2);
    assert.equal(same_model(items[0].model, items[1].model), false);
    for (const item of items) {
      const model = town.models.client(JSON.parse(JSON.stringify(item.model)), { binding_id: item.binding_id });
      assert.equal(model.id, "same:model/名称");
      const events = [];
      for await (const event of await model.stream(call)) events.push(event);
      assert.deepEqual(events.map((event) => event.type), ["model_start", "model_usage", "model_finish"]);
    }
    assert.deepEqual(requests.map((request) => request.url), [first.url, second.url]);
    assert.ok(requests.every((request) => request.body.model_id === "same:model/名称"));
    assert.throws(() => town.models.client(items[0].model, { binding_id: "account-b" }), { code: "town_model_identity_confirmation_required" });
  } finally { await town.close(); await first.dispose(); await second.dispose(); }
});

test("同地址更换账号使旧模型句柄失效，换地址必须新登记", async () => {
  const requests = [];
  const first = source("https://first.example", requests);
  const another = source("https://another.example", requests);
  const town = new Town("test");
  town.add("first", first, { auth_scope_id: "account-a" });
  const old = town.models.client({ downtown: "first", id: "same:model/名称" });
  try {
    await town.replace("first", { client: first, auth_scope_id: "account-b" });
    await assert.rejects(old.stream(call), { code: "town_model_identity_confirmation_required" });
    await assert.rejects(town.replace("first", { client: another, auth_scope_id: "account-c" }), { code: "town_endpoint_requires_new_identity" });
    assert.equal(requests.length, 0);
  } finally { await town.close(); await first.dispose(); await another.dispose(); }
});

test("直接模型保留原始身份；取消流释放门禁，重新登记要求确认新绑定", async () => {
  const town = new Town("test");
  const client = { id: "local/original", stream: async () => new ReadableStream() };
  const reference = town.models.register({ source_id: "extension-model", client });
  assert.deepEqual(reference, { client: "extension-model", id: "local/original" });
  const handle = town.models.client(reference);
  try {
    const stream = await handle.stream(call);
    assert.throws(() => town.models.unregister(reference), { code: "town_connection_busy" });
    await stream.cancel();
    town.models.unregister(reference);
    town.models.register({ source_id: "extension-model", client });
    await assert.rejects(handle.stream(call), { code: "town_model_identity_confirmation_required" });
    assert.equal((await town.models.list()).items[0].source_kind, "client");
  } finally { await town.close(); }
});
