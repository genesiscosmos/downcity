/** Desktop Chat 渲染缓存容量策略测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { project_chat_render_cache, touch_chat_render_cache } from "../src/renderer/lib/chat/chat_render_cache.ts";

test("访问 Session 时将它移动到最近顺序首位且不保留重复项", () => {
  const current = ["second", "first"];
  assert.equal(touch_chat_render_cache(current, "second"), current);
  assert.deepEqual(touch_chat_render_cache(current, "first"), ["first", "second"]);
  assert.deepEqual(touch_chat_render_cache(current, "third"), ["third", "second", "first"]);
});

test("超出容量时优先淘汰最久未访问的渲染缓存", () => {
  const projection = project_chat_render_cache({
    cached_session_keys: ["first", "second", "third"],
    recent_session_keys: ["third", "second", "first"],
    protected_session_keys: new Set(),
    recent_cache_limit: 2,
  });
  assert.deepEqual(projection.evicted_session_keys, ["first"]);
  assert.deepEqual(projection.recent_session_keys, ["third", "second"]);
});

test("激活和快照请求中的 Session 不受最近缓存容量限制", () => {
  const projection = project_chat_render_cache({
    cached_session_keys: ["active", "pending", "recent", "old"],
    recent_session_keys: ["recent", "old", "pending", "active"],
    protected_session_keys: new Set(["active", "pending"]),
    recent_cache_limit: 1,
  });
  assert.deepEqual(projection.evicted_session_keys, ["old"]);
  assert.deepEqual(projection.recent_session_keys, ["recent", "pending", "active"]);
});

test("没有最近访问记录的非保护缓存会被视为最旧项", () => {
  const projection = project_chat_render_cache({
    cached_session_keys: ["known", "orphan"],
    recent_session_keys: ["known"],
    protected_session_keys: new Set(),
    recent_cache_limit: 8,
  });
  assert.deepEqual(projection.evicted_session_keys, ["orphan"]);
});
