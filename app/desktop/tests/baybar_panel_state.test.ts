/**
 * 右侧 BayBar 的域 / 分区选择规则测试。
 *
 * 直接验证生产模块，锁定核心不变量：
 * 1. 展开右侧一定有内容可看，不给空面板；
 * 2. 选择失效时逐级回退（域存在则保留域、分区回退到第一个）；
 * 3. 序列化往返稳定，且不同视图互相隔离。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { baybar_storage_key, format_selection, parse_selection, resolve_domain_switch, resolve_selection } from "../src/renderer/layouts/baybarPanelState.ts";
import type { BayBarDomain } from "../src/renderer/layouts/baybarPanelState.ts";

/** 构造一个域。 */
function domain(id: string, section_ids: string[]): BayBarDomain {
  return { id, label: id, sections: section_ids.map((section_id) => ({ id: section_id, label: section_id, content: null })) };
}

// Agent 对话：两个域，分区数不同。
const agent_chat = [domain("agent", ["identity", "model", "soul"]), domain("turn", ["file-diff"])];
// Agent 配置：单域。
const agent_config = [domain("agent", ["identity", "model", "soul"])];

test("没有历史选择时落在第一个域的第一个分区", () => {
  assert.deepEqual(resolve_selection(agent_chat, null), { domain_id: "agent", section_id: "identity" });
});

test("历史选择仍然有效时保持不变", () => {
  const previous = { domain_id: "turn", section_id: "file-diff" };
  assert.deepEqual(resolve_selection(agent_chat, previous), previous);
});

test("域仍存在但分区消失时，回退到该域的第一个分区", () => {
  // 例如某域内的分区集合变化，用户不该被踢到别的域。
  assert.deepEqual(
    resolve_selection(agent_config, { domain_id: "agent", section_id: "plugins" }),
    { domain_id: "agent", section_id: "identity" },
  );
});

test("域整体消失时，回退到第一个域的第一个分区", () => {
  // 从 Agent 对话切到 Agent 配置后，"turn" 域不再存在。
  assert.deepEqual(
    resolve_selection(agent_config, { domain_id: "turn", section_id: "file-diff" }),
    { domain_id: "agent", section_id: "identity" },
  );
});

test("没有域时没有选择，右侧整体不存在", () => {
  assert.equal(resolve_selection([], { domain_id: "agent", section_id: "identity" }), null);
});

test("域内没有分区时该域不成立", () => {
  assert.equal(resolve_selection([domain("empty", [])], null), null);
});

test("切换到某个域时进入它的第一个分区", () => {
  assert.deepEqual(resolve_domain_switch(agent_chat, "turn"), { domain_id: "turn", section_id: "file-diff" });
});

test("切换到不存在的域时不产生选择", () => {
  assert.equal(resolve_domain_switch(agent_chat, "missing"), null);
});

test("任意输入下都只会返回集合内的值或 null", () => {
  const cases: Array<[BayBarDomain[], { domain_id: string; section_id: string } | null]> = [
    [agent_chat, null],
    [agent_chat, { domain_id: "turn", section_id: "file-diff" }],
    [agent_chat, { domain_id: "agent", section_id: "missing" }],
    [agent_chat, { domain_id: "missing", section_id: "identity" }],
    [agent_config, { domain_id: "turn", section_id: "file-diff" }],
    [[], null],
  ];
  for (const [domains, previous] of cases) {
    const resolved = resolve_selection(domains, previous);
    if (resolved === null) continue;
    const target = domains.find((item) => item.id === resolved.domain_id);
    assert.ok(target, `${JSON.stringify(previous)} → 域 ${resolved.domain_id} 不存在`);
    assert.ok(target.sections.some((section) => section.id === resolved.section_id), `${JSON.stringify(previous)} → 分区 ${resolved.section_id} 不在域内`);
  }
});

test("选择序列化可无损往返", () => {
  const selection = { domain_id: "turn", section_id: "file-diff" };
  assert.deepEqual(parse_selection(format_selection(selection)), selection);
});

test("非法持久化内容被安全忽略", () => {
  assert.equal(parse_selection(null), null);
  assert.equal(parse_selection(""), null);
  assert.equal(parse_selection("没有分隔符"), null);
  assert.equal(parse_selection(":only-section"), null);
  assert.equal(parse_selection("only-domain:"), null);
});

test("不同视图的选择状态互相隔离", () => {
  assert.notEqual(baybar_storage_key("agent-session:a:1"), baybar_storage_key("agent-session:a:2"));
  assert.equal(baybar_storage_key("agent:demo"), "downcity.baybar_selection:agent:demo");
});
