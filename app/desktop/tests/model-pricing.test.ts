/** Desktop 模型价格文案解析测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { build_model_pricing } from "../src/renderer/lib/model/model_pricing.ts";

test("解析中英文输入输出价格并换算到每 1M tokens 美元价格", () => {
  assert.deepEqual(build_model_pricing([{
    model_id: "model-a",
    name: "Model A",
    description: "",
    modalities: ["text"],
    tags: [],
    price: ["输入：2 credits / 1K tokens", "Output: 6 credits / 1K tokens"],
  }]), [{
    model_id: "model-a",
    model_name: "Model A",
    input_usd_per_1m: 2000,
    output_usd_per_1m: 6000,
  }]);
});

test("不猜测缺失或无法解析的价格", () => {
  assert.deepEqual(build_model_pricing([{
    model_id: "model-a",
    name: "Model A",
    description: "",
    modalities: ["text"],
    tags: [],
    price: ["输入：2 credits / 1K tokens"],
  }, {
    model_id: "model-b",
    name: "Model B",
    description: "",
    modalities: ["text"],
    tags: [],
    price: ["按量计费"],
  }]), []);
});

test("忽略输入上下文档位，只解析实际价格分母", () => {
  assert.deepEqual(build_model_pricing([{
    model_id: "gpt",
    name: "GPT",
    description: "",
    modalities: ["text"],
    tags: [],
    price: ["Input (up to 272K input): $1.6 / 1M tokens", "Input (up to 1M input): $3.2 / 1M tokens", "Output: $12.8 / 1M tokens"],
  }]), [{ model_id: "gpt", model_name: "GPT", input_usd_per_1m: 3.2, output_usd_per_1m: 12.8 }]);
});
