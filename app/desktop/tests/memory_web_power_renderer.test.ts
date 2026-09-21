/**
 * Memory / Web Power 新 Renderer 的表面契约测试。
 *
 * 关键点（中文）
 * - 两个 Power 现在都声明了 Sidebar + Mainview；这里守住它们**真的**渲染出来，
 *   而不是只在注册表里出现一个对象。
 * - 静态渲染不会执行 effect，因此这里只断言同步可见的骨架与插槽契约；
 *   真实读写行为由 `@downcity/powers` 自己的 host action 测试覆盖。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BUILTIN_POWER_RENDERERS } from "@downcity/powers/renderers";

/** 透传容器，避免测试依赖宿主真实组件。 */
const passthrough = ({ children }: { readonly children?: ReactNode }) =>
  createElement("div", null, children as never);

/** 构造只记录调用、不依赖宿主实现的 UI Components。 */
function create_ui_components() {
  return {
    Sidebar: ({ children, actions }: { readonly children?: ReactNode; readonly actions?: ReactNode }) =>
      createElement("div", null, actions, children),
    SidebarSection: ({ label, children }: { readonly label?: ReactNode; readonly children?: ReactNode }) =>
      createElement("div", null, label, children),
    SidebarItem: ({ label, description, trailing }: {
      readonly label?: ReactNode;
      readonly description?: ReactNode;
      readonly trailing?: ReactNode;
    }) => createElement("div", null, label, description, trailing),
    SidebarTreeItem: passthrough,
    SidebarSubText: passthrough,
    ItemMenu: passthrough,
    SidebarCreateMenu: passthrough,
    Page: passthrough,
    Section: ({ title, children }: { readonly title?: ReactNode; readonly children?: ReactNode }) =>
      createElement("div", null, title, children),
    Group: passthrough,
    Row: ({ label, description, trailing }: {
      readonly label?: ReactNode;
      readonly description?: ReactNode;
      readonly trailing?: ReactNode;
    }) => createElement("div", null, label, description, trailing),
    Stack: passthrough,
    Inline: passthrough,
    Toolbar: ({ title }: { readonly title?: ReactNode }) => createElement("div", null, title),
    Tabs: passthrough,
    CodeBlock: ({ children }: { readonly children?: string }) => createElement("div", null, children),
    Markdown: ({ text }: { readonly text: string }) => createElement("div", null, text),
    Button: ({ children }: { readonly children?: ReactNode }) => createElement("div", null, children),
    Input: passthrough,
    Field: passthrough,
    Textarea: passthrough,
    Select: passthrough,
    Switch: passthrough,
    EmptyState: ({ title, description }: { readonly title?: ReactNode; readonly description?: ReactNode }) =>
      createElement("div", null, title, description),
    LoadingState: ({ label }: { readonly label?: ReactNode }) => createElement("div", null, label),
    Callout: ({ children }: { readonly children?: ReactNode }) => createElement("div", null, children),
    Status: ({ children }: { readonly children?: ReactNode }) => createElement("div", null, children),
  };
}

/** 构造只记录调用与路由、不访问宿主的 Renderer 属性。 */
function create_host(options: { readonly routes?: unknown[]; readonly route?: Record<string, unknown> }) {
  const invoked: string[] = [];
  return {
    invoked,
    props: {
      power: {
        invoke: async (action_id: string) => {
          invoked.push(action_id);
          throw new Error(`test host has no response for: ${action_id}`);
        },
      },
      navigation: {
        route: options.route ?? {},
        navigate: (route: Record<string, unknown>) => options.routes?.push(route),
      },
      notifications: [],
      ui: {
        revision: 0,
        invalidate() {},
        toast() {},
        confirm: async () => true,
        components: create_ui_components(),
      },
    },
  };
}

test("Memory 与 Web 都声明 Sidebar 与 Mainview", () => {
  for (const power_id of ["memory", "web"]) {
    const renderer = BUILTIN_POWER_RENDERERS[power_id];
    assert.ok(renderer, `${power_id} 没有注册 Renderer`);
    assert.equal(typeof renderer.sidebar, "function", `${power_id} 缺少 Sidebar`);
    assert.equal(typeof renderer.mainview, "function", `${power_id} 缺少 Mainview`);
  }
});

test("Web 保留独立 Config，并与 Mainview、Sidebar 分离", () => {
  const renderer = BUILTIN_POWER_RENDERERS.web;
  assert.equal(typeof renderer?.config, "function");
  assert.notEqual(renderer?.config, renderer?.mainview);
  assert.notEqual(renderer?.config, renderer?.sidebar);
});

test("Memory 与 Web 在拿到数据前先渲染加载态，而不是报错", () => {
  for (const power_id of ["memory", "web"]) {
    const host = create_host({});
    for (const slot of ["sidebar", "mainview"] as const) {
      const markup = renderToStaticMarkup(
        createElement(BUILTIN_POWER_RENDERERS[power_id]![slot]!, host.props),
      );
      assert.match(markup, /正在读取/u, `${power_id}.${slot} 首帧应显示加载态`);
    }
  }
});
