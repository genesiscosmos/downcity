/** Desktop 结构化模型价格投影测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { build_model_pricing } from "../src/renderer/lib/model/model_pricing.ts";

test("将结构化 token 价格换算到每 1M tokens 美元价格", () => {
  assert.deepEqual(build_model_pricing([{
    model_id: "model-a",
    name: "Model A",
    description: "",
    modalities: ["text"],
    tags: [],
    pricing: [{
      currency: "USD",
      unit: "token",
      scale: 1_000,
      rates: { input: 2, output: 6 },
    }],
  }]), [{
    model_id: "model-a",
    model_name: "Model A",
    input_usd_per_1m: 2000,
    output_usd_per_1m: 6000,
  }]);
});

test("不猜测缺失或非美元 token 价格", () => {
  assert.deepEqual(build_model_pricing([{
    model_id: "model-a",
    name: "Model A",
    description: "",
    modalities: ["text"],
    tags: [],
    pricing: [{
      currency: "USD",
      unit: "token",
      scale: 1_000,
      rates: { input: 2 },
    }],
  }, {
    model_id: "model-b",
    name: "Model B",
    description: "",
    modalities: ["text"],
    tags: [],
    pricing: [{
      currency: "CNY",
      unit: "request",
      rates: { input: 1, output: 2 },
    }],
  }]), []);
});

test("多个条件价格方案使用最高输入输出价格", () => {
  assert.deepEqual(build_model_pricing([{
    model_id: "gpt",
    name: "GPT",
    description: "",
    modalities: ["text"],
    tags: [],
    pricing: [{
      currency: "USD",
      unit: "token",
      scale: 1_000_000,
      rates: { input: 1.6, output: 6.4 },
      dimensions: { context: "272k" },
    }, {
      currency: "USD",
      unit: "token",
      scale: 1_000_000,
      rates: { input: 3.2, output: 12.8 },
      dimensions: { context: "1m" },
    }],
  }]), [{ model_id: "gpt", model_name: "GPT", input_usd_per_1m: 3.2, output_usd_per_1m: 12.8 }]);
});
