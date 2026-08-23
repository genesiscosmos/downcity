/** Desktop 模型推理强度文案测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { format_default_model_reasoning, format_model_reasoning, get_default_model_reasoning } from "../src/renderer/lib/model/model_reasoning.ts";

test("格式化模型推理档位和默认档位", () => {
  const model = {
    reasoning: {
      efforts: [
        { id: "low", name: "低" },
        { id: "high", name: "高" },
      ],
      default_effort: "low",
    },
  };
  assert.equal(format_model_reasoning(model), "推理：低 / 高");
  assert.equal(format_default_model_reasoning(model), "默认：低");
  assert.equal(get_default_model_reasoning(model)?.id, "low");
});

test("默认档位不存在时不生成误导性文案", () => {
  const model = { reasoning: { efforts: [{ id: "low", name: "低" }], default_effort: "unknown" } };
  assert.equal(get_default_model_reasoning(model), undefined);
  assert.equal(format_default_model_reasoning(model), "");
});

test("空档位不会阻止其它有效档位展示", () => {
  const model = { reasoning: { efforts: [{ id: "", name: "" }, { id: "high", name: "高" }] } };
  assert.equal(format_model_reasoning(model), "推理：高");
});

test("没有推理能力时不显示推理文案", () => {
  assert.equal(format_model_reasoning({}), "");
  assert.equal(format_default_model_reasoning({}), "");
});
