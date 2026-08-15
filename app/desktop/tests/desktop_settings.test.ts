/** Desktop 设置归一化测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { normalize_settings } from "../src/main/settings/DesktopSettingsController.ts";

test("缺失设置使用稳定默认值", () => {
  assert.deepEqual(normalize_settings(), {
    show_reasoning: true,
    auto_scroll: true,
    default_agent_id: "",
    open_empty_chat_on_start: false,
    send_message_on_enter: true,
    spellcheck_enabled: false,
    appearance_mode: "system",
    color_theme: "duobox",
    ui_scale: 1,
    proxy_enabled: false,
    proxy_url: "",
    default_text_model_id: "",
    default_image_model_id: "",
  });
});

test("外观枚举与缩放被限制在公开范围内", () => {
  const settings = normalize_settings({
    appearance_mode: "invalid" as never,
    color_theme: "invalid" as never,
    ui_scale: 9,
    default_agent_id: "  writer  ",
    proxy_url: "  http://127.0.0.1:7890  ",
  });
  assert.equal(settings.appearance_mode, "system");
  assert.equal(settings.color_theme, "duobox");
  assert.equal(settings.ui_scale, 1.2);
  assert.equal(settings.default_agent_id, "writer");
  assert.equal(settings.proxy_url, "http://127.0.0.1:7890");
});
