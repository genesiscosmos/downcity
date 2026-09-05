/** Desktop locale 映射和格式化测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { format_date, format_number, get_intl_locale } from "../src/renderer/locales/format.ts";

test("Desktop 语言映射到稳定 Intl locale", () => {
  assert.equal(get_intl_locale("en"), "en-US");
  assert.equal(get_intl_locale("zh"), "zh-CN");
});

test("数字和日期按显式语言格式化", () => {
  assert.equal(format_number(1234, "en"), "1,234");
  assert.equal(format_number(1234, "zh"), "1,234");
  assert.equal(format_date("invalid", "en"), "invalid");
  assert.equal(format_date("2026-09-05T00:00:00.000Z", "en", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }), "Sep 5, 2026");
  assert.equal(format_date("2026-09-05T00:00:00.000Z", "zh", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }), "2026年9月5日");
});
