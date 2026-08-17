import test from "node:test";
import assert from "node:assert/strict";
import { calculate_model_price, select_model_pricing } from "../bin/index.js";

test("选择匹配 dimensions 的模型价格方案并计算 token 金额", () => {
  const pricing = [
    { currency: "USD", unit: "token", scale: 1_000_000, rates: { input: 0.22 }, dimensions: { period: "off_peak" } },
    { currency: "USD", unit: "token", scale: 1_000_000, rates: { input: 0.44 }, dimensions: { period: "peak" } },
  ];
  const selected = select_model_pricing(pricing, { period: "peak" });
  assert.equal(selected?.rates.input, 0.44);
  assert.equal(calculate_model_price(selected, { input: 1_000_000 }), 0.44);
});

test("request 价格支持多个命名档位", () => {
  const selected = { currency: "USD", unit: "request", rates: { default: 0.0085, "2k": 0.014 } };
  assert.equal(calculate_model_price(selected, { "2k": 1 }), 0.014);
});
