/** Chat Plugin Sidebar Header 创建菜单的宿主渲染回归测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BUILTIN_PLUGIN_RENDERERS } from "@downcity/plugins/renderers";

test("Chat Sidebar 通过 Header 加号菜单选择具体 Channel", () => {
  const renderer = BUILTIN_PLUGIN_RENDERERS.chat;
  assert.ok(renderer?.sidebar);
  const routes: unknown[] = [];
  let create_actions: ReadonlyArray<{ readonly action_id: string; readonly label: unknown; readonly on_select: () => void }> = [];
  const passthrough = ({ children }: { readonly children?: unknown }) => createElement("div", null, children as never);
  const markup = renderToStaticMarkup(createElement(renderer.sidebar, {
    plugin: { invoke: async () => ({ accounts: [] }) },
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

  assert.match(markup, /添加 Channel/u);
  assert.deepEqual(create_actions.map((action) => action.action_id), ["telegram", "feishu", "qq"]);
  create_actions[1]?.on_select();
  assert.deepEqual(routes, [{ view: "create", provider: "feishu" }]);
});
