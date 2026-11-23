/** CLI 模型验证显式注入临时 Federation，禁止读取默认远端或真实模型凭据。 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AIService, Downtown } from "@downcity/downtown";
import { Database } from "../../implementations/databases/sqlite/bin/index.js";
import { resolve_local_city_id } from "@downcity/city/local";
import { create_city_ai_model_client } from "../bin/city/runtime/city-model/CityAiServiceBinding.js";

test("模型仅消费注入的 Federation，模型和用户视图使用宿主稳定来源", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "downcity-model-source-"));
  const previous_root = process.env.DC_PLATFORM_ROOT;
  const previous_fetch = globalThis.fetch;
  process.env.DC_PLATFORM_ROOT = root;
  globalThis.fetch = async () => { throw new Error("Unexpected network request in model verification"); };
  const federation = new Downtown({ database: new Database({ filename: ":memory:" }) });
  const ai = new AIService();
  ai.use({ id: "test-model", name: "Test", runtime: { actions: {}, stream: async () => ({ stream: new ReadableStream({ start(controller) { controller.close(); } }) }) } });
  federation.use(ai);
  const sources = [];
  ai.hook.before((ctx) => { sources.push(ctx.city_id); });
  // 测试宿主明确注入可信身份；没有监听端口或获取真实用户凭据。
  const serve = federation.fetch;
  federation.fetch = (request, options) => serve(request, { ...options, trusted_identity: { level: "user", user: { user_id: "test-user" } } });
  try {
    const model = await create_city_ai_model_client({ model_id: "test-model", federation });
    assert.equal(model.id, "test-model");
    const city_id = resolve_local_city_id(root);
    await federation.user.with_city(city_id).ai.catalog();
    assert.deepEqual(sources, [city_id, city_id]);
  } finally {
    await federation.dispose();
    globalThis.fetch = previous_fetch;
    if (previous_root === undefined) delete process.env.DC_PLATFORM_ROOT; else process.env.DC_PLATFORM_ROOT = previous_root;
    await rm(root, { recursive: true, force: true });
  }
});
