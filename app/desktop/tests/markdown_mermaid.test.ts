/**
 * Desktop Mermaid 管线的纯函数测试。
 *
 * 覆盖三处最容易悄悄坏掉、又不会被类型系统发现的地方：围栏改写是否只命中 Mermaid、主题令牌
 * 是否真的进了 Mermaid 配置、位图导出的尺寸收敛是否还在安全区内。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import type { Element, Root } from "hast";
import { mermaid_diagram_tag_name, rehype_mermaid_blocks } from "../src/renderer/components/markdown/rehype_mermaid_blocks.ts";
import { markdown_rehype_plugins, markdown_remark_plugins } from "../src/renderer/components/markdown/markdown_plugins.ts";
import { build_chart_palette, build_mermaid_config, mix_color, DEFAULT_MERMAID_THEME_TOKENS } from "../src/renderer/components/markdown/mermaid/mermaid_theme.ts";
import { get_mermaid_raster_size, read_mermaid_svg_size } from "../src/renderer/components/markdown/mermaid/mermaid_image.ts";

/** 构造一个围栏代码块元素。 */
function build_code_block(language: string | null, source: string, extra_class_names: string[] = []): Element {
  return {
    type: "element",
    tagName: "pre",
    properties: {},
    children: [
      {
        type: "element",
        tagName: "code",
        properties: language ? { className: [...extra_class_names, `language-${language}`] } : { className: extra_class_names },
        children: [{ type: "text", value: source }],
      },
    ],
  };
}

/** 构造一个行内代码元素。 */
function build_inline_code(source: string): Element {
  return { type: "element", tagName: "code", properties: {}, children: [{ type: "text", value: source }] };
}

/** 运行一次转换。 */
function transform(root: Root): Root {
  rehype_mermaid_blocks()(root);
  return root;
}

test("Mermaid 围栏被改写成图表节点并原样保留源码", () => {
  const source = "graph TD\n  A[开始] --> B[结束]";
  const root = transform({ type: "root", children: [build_code_block("mermaid", source)] });

  assert.equal(root.children.length, 1);
  const diagram = root.children[0];
  assert.equal(diagram?.type, "element");
  assert.equal(diagram?.type === "element" ? diagram.tagName : "", mermaid_diagram_tag_name);
  assert.deepEqual(diagram?.type === "element" ? diagram.children : [], [{ type: "text", value: source }]);
});

test("非 Mermaid 代码块与行内代码保持原样", () => {
  const json_block = build_code_block("json", "{\"a\": 1}");
  const plain_block = build_code_block(null, "plain text");
  const inline_code = build_inline_code("mermaid");
  const root = transform({ type: "root", children: [json_block, plain_block, inline_code] });

  assert.deepEqual(root.children, [json_block, plain_block, inline_code]);
});

test("语言类名大小写不敏感，且与其他类名共存时仍然命中", () => {
  const root = transform({ type: "root", children: [build_code_block("MERMAID", "graph LR", ["hljs"])] });
  assert.equal(root.children[0]?.type === "element" ? root.children[0].tagName : "", mermaid_diagram_tag_name);
});

test("嵌套结构内的围栏同样被改写", () => {
  const container: Element = { type: "element", tagName: "blockquote", properties: {}, children: [build_code_block("mermaid", "graph TD")] };
  const root = transform({ type: "root", children: [container] });

  assert.equal(container.children[0]?.type === "element" ? container.children[0].tagName : "", mermaid_diagram_tag_name);
});

test("多张图表与普通代码块按原顺序保留", () => {
  const root = transform({ type: "root", children: [build_code_block("mermaid", "graph TD"), build_code_block("ts", "const a = 1;"), build_code_block("mermaid", "sequenceDiagram")] });

  assert.deepEqual(
    root.children.map((child) => (child.type === "element" ? child.tagName : child.type)),
    [mermaid_diagram_tag_name, "pre", mermaid_diagram_tag_name],
  );
});

test("没有 code 子节点的 pre 不被改写", () => {
  const empty_pre: Element = { type: "element", tagName: "pre", properties: {}, children: [{ type: "text", value: "graph TD" }] };
  const root = transform({ type: "root", children: [empty_pre] });

  assert.deepEqual(root.children, [empty_pre]);
  assert.equal(empty_pre.tagName, "pre");
});

test("颜色混合按权重取值，无法解析的颜色保持原值", () => {
  assert.equal(mix_color("rgb(0, 0, 0)", "rgb(255, 255, 255)", 0.5), "rgb(128, 128, 128)");
  assert.equal(mix_color("#ffffff", "#000000", 0.25), "rgb(191, 191, 191)");
  assert.equal(mix_color("rgb(10, 20, 30)", "rgb(0, 0, 0)", 2), "rgb(0, 0, 0)");
  assert.equal(mix_color("oklch(0.5 0.1 20)", "rgb(0, 0, 0)", 0.5), "oklch(0.5 0.1 20)");
});

test("色阶以主色为中心，向背景端与前景端单调展开", () => {
  const palette = build_chart_palette({ primary: "#aabbcc", background: "#ffffff", foreground: "#000000" });

  assert.equal(palette.length, 5);
  assert.equal(palette[2], "#aabbcc");

  const red = palette.map(read_red_channel);
  assert.deepEqual([...red].sort((left, right) => right - left), red);
});

test("真实 Markdown 管线把 Mermaid 围栏交给图表组件", () => {
  const html = renderToStaticMarkup(
    createElement(Streamdown, {
      mode: "static",
      rehypePlugins: markdown_rehype_plugins,
      remarkPlugins: markdown_remark_plugins,
      // 只替掉图表节点，其余元素仍由 Streamdown 自己的默认组件处理。
      components: {
        [mermaid_diagram_tag_name]: (props: { children?: unknown }) => createElement("div", { "data-mermaid-source": String(props.children) }),
      } as never,
      children: "流程如下。\n\n```mermaid\ngraph TD\n  A --> B\n```\n",
    }),
  );

  // 围栏改写成图表节点：源码原样保留，且不再作为代码块存在。
  assert.match(html, /data-mermaid-source="graph TD\n  A --&gt; B/);
  assert.doesNotMatch(html, /language-mermaid/);
});

/** 读取颜色的红色通道；色阶中既有 rgb() 字面量，也有原样保留的十六进制主色。 */
function read_red_channel(color: string): number {
  const rgb_channels = color.match(/\d+/g);
  return rgb_channels ? Number(rgb_channels[0]) : Number.parseInt(color.slice(1, 3), 16);
}

test("主题令牌进入 Mermaid 配置", () => {
  const config = build_mermaid_config(DEFAULT_MERMAID_THEME_TOKENS, "seed-1");
  const theme_variables = config.themeVariables as Record<string, unknown>;

  assert.equal(config.theme, "base");
  assert.equal(config.securityLevel, "strict");
  assert.equal(config.deterministicIDSeed, "seed-1");
  assert.equal(config.suppressErrorRendering, true);
  assert.equal(theme_variables["primaryColor"], DEFAULT_MERMAID_THEME_TOKENS.card);
  assert.equal(theme_variables["lineColor"], DEFAULT_MERMAID_THEME_TOKENS.muted_foreground);
  assert.equal(theme_variables["c0"], DEFAULT_MERMAID_THEME_TOKENS.chart_palette[0]);
  assert.equal(theme_variables["c4"], DEFAULT_MERMAID_THEME_TOKENS.chart_palette[4]);
  assert.match(config.themeCSS ?? "", /\.flowchart-link/);
  assert.match(config.themeCSS ?? "", new RegExp(DEFAULT_MERMAID_THEME_TOKENS.muted_foreground.replace(/[()]/g, "\\$&")));
});

test("SVG 尺寸优先取 viewBox，其次取宽高属性", () => {
  assert.deepEqual(read_mermaid_svg_size('<svg viewBox="0 0 640 480" width="100%"></svg>'), { width: 640, height: 480 });
  assert.deepEqual(read_mermaid_svg_size('<svg width="320" height="200"></svg>'), { width: 320, height: 200 });
  assert.equal(read_mermaid_svg_size("<svg></svg>"), null);
});

test("位图导出尺寸按倍数放大并收敛在安全范围内", () => {
  assert.deepEqual(get_mermaid_raster_size({ width: 320, height: 200 }), { width: 640, height: 400 });
  assert.deepEqual(get_mermaid_raster_size({ width: 20_000, height: 10 }), { width: 8192, height: 4 });
  assert.deepEqual(get_mermaid_raster_size({ width: 10_000, height: 10_000 }), { width: 5657, height: 5657 });
});
