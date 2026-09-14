/**
 * 模型数值格式化测试。
 *
 * 这个模块是把 Settings 与 ChatModelSelector 里两份不一致的实现合并而来的：
 * 设置页不认识百万级（1_000_000 会显示成 1000K），聊天用的是 tokens 而设置页写 context，
 * 同屏两处对同一个数字给出两种说法。这里锁住合并后的唯一行为。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { format_compact_number, format_credit_amount, format_token_count, format_usd_price } from "../src/renderer/lib/model/model_format.ts";

test("上下文规模在千与百万处换挡", () => {
  assert.equal(format_token_count(128), "128");
  assert.equal(format_token_count(500), "500");
  assert.equal(format_token_count(1_000), "1K");
  assert.equal(format_token_count(128_000), "128K");
  assert.equal(format_token_count(1_000_000), "1M");
  assert.equal(format_token_count(1_500_000), "1.5M");
  assert.equal(format_token_count(2_000_000), "2M");
});

test("未知或非法规模不显示 NaN", () => {
  assert.equal(format_token_count(0), "0");
  assert.equal(format_token_count(-1), "0");
  assert.equal(format_token_count(Number.NaN), "0");
});

test("价格最多三位有效数字", () => {
  assert.equal(format_usd_price(0.000123456), "0.000123");
  assert.equal(format_usd_price(3), "3");
  assert.equal(format_usd_price(15.5), "15.5");
});

test("Credits 整数不带小数、小数最多两位", () => {
  assert.equal(format_credit_amount(1200), "1,200");
  assert.equal(format_credit_amount(12.3456), "12.35");
});

test("汇总数字使用紧凑写法", () => {
  assert.equal(format_compact_number(1_234_567), "1.2M");
});
