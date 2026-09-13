/**
 * 注意力标记契约测试。
 *
 * 标记统一为实心圆，仅通过颜色区分等级。由于颜色是唯一视觉差异，可读文案是颜色之外唯一可靠的
 * 信息来源，因此文案必须存在且两两不同——它会被并入 Rail 按钮名称，让颜色不承担唯一的信息职责。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { attention_visual } from "../src/renderer/lib/notification/attention.ts";

test("每个注意力等级都有文案与颜色", () => {
  for (const [attention, visual] of Object.entries(attention_visual)) {
    assert.ok(visual.label_key, `${attention} 缺少文案 key`);
    assert.ok(visual.mark_class, `${attention} 缺少标记颜色`);
    assert.ok(visual.icon_class, `${attention} 缺少图标配色`);
  }
});

test("标记只声明颜色，形状不由 token 决定", () => {
  for (const [attention, visual] of Object.entries(attention_visual)) {
    assert.match(visual.mark_class, /bg-/, `${attention} 的标记必须是实心填充`);
    // 形状统一由调用方固定为实心圆；token 里不应再出现形状或描边，避免两处定义互相打架。
    assert.doesNotMatch(visual.mark_class, /rounded|border/, `${attention} 的标记不应声明形状`);
  }
});

test("三个等级的标记颜色两两不同", () => {
  const marks = Object.values(attention_visual).map((visual) => visual.mark_class);
  assert.equal(new Set(marks).size, marks.length);
});

test("文案两两不同，保证颜色之外仍有可区分的信息", () => {
  const labels = Object.values(attention_visual).map((visual) => visual.label_key);
  assert.equal(new Set(labels).size, labels.length);
});
