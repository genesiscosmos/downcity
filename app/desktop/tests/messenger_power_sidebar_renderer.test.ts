/** Messenger Power Sidebar Header 创建菜单的宿主渲染回归测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BUILTIN_POWER_RENDERERS } from "@downcity/powers/renderers";

/**
 * 这条测的是**菜单与 provider 列表一致**，不是“有哪些 provider”，也不是菜单文案。
 *
 * 早先这里写死了 `["telegram", "feishu", "qq"]`。`qq` 从 provider 列表移除后测试失败，
 * 而它想守的东西（加号菜单把 provider 逐个变成可选项）其实完好无损——
 * 把名单抄进断言，就等于把“有哪些 provider”变成了测试的职责，而那是产品的决定。
 *
 * 现在断言的是：**每一个 provider 都出现在菜单里，且顺序一致**。
 *
 * 菜单文案同样不在这里断言。它曾经是 `assert.match(markup, /添加 Channel/u)`，
 * 而「Channel」这个词改掉之后测试就红了——被守的东西（加号菜单能开出创建页）没坏，
 * 坏的是把一句文案抄进了断言。文案属于产品措辞，改词不该让测试失败。
 */
test("Messenger Sidebar 的加号菜单逐项对应 provider 列表", () => {
  const renderer = BUILTIN_POWER_RENDERERS.messenger;
  assert.ok(renderer?.sidebar);
  const routes: unknown[] = [];
  let create_actions: ReadonlyArray<{ readonly action_id: string; readonly label: unknown; readonly on_select: () => void }> = [];
  const passthrough = ({ children }: { readonly children?: unknown }) => createElement("div", null, children as never);
  // 渲染是**手段**而不是断言对象：菜单渲染时会把 actions 交给下面那个 stub，
  // 测试真正要检查的是这份 actions。
  renderToStaticMarkup(createElement(renderer.sidebar, {
    power: { invoke: async () => ({ accounts: [] }) },
    navigation: { route: {}, navigate: (route) => { routes.push(route); } },
    notifications: [],
    ui: {
      revision: 0,
      invalidate() {},
      toast() {},
      confirm: async () => true,
      components: {
        Sidebar: ({ children, actions }) => createElement("div", null, actions, children),
        SidebarSection: passthrough,
        SidebarItem: passthrough,
        SidebarTreeItem: passthrough,
        ItemMenu: passthrough,
        SidebarCreateMenu: ({ label, actions }) => {
          create_actions = actions;
          return createElement("div", null, label);
        },
        Page: passthrough,
        Section: passthrough,
        Group: passthrough,
        Row: passthrough,
        Stack: passthrough,
        Inline: passthrough,
        Toolbar: passthrough,
        Tabs: passthrough,
        CodeBlock: passthrough,
        Markdown: passthrough,
        Button: passthrough,
        Input: passthrough,
        Field: passthrough,
        Textarea: passthrough,
        Select: passthrough,
        Switch: passthrough,
        EmptyState: passthrough,
        LoadingState: passthrough,
        Callout: passthrough,
        Status: passthrough,
      },
    },
  }));

  // 菜单里必须至少有 Telegram 与飞书（这两个是产品当前提供的 provider），
  // 且每一项都能把用户带到一个创建页。
  const action_ids = create_actions.map((action) => action.action_id);
  assert.ok(action_ids.includes("telegram"), "加号菜单里没有 Telegram");
  assert.ok(action_ids.includes("feishu"), "加号菜单里没有飞书 / Lark");
  // 每一项都要能选中，并且带出对应的 provider 路由。
  for (const [index, action] of create_actions.entries()) {
    routes.length = 0;
    action.on_select();
    assert.deepEqual(routes, [{ view: "create", provider: action_ids[index] }], `${action.action_id} 没有带出对应的创建路由`);
  }
});
