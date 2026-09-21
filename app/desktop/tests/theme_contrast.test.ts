/**
 * 全主题文字对比度守卫。
 *
 * 为什么需要它：界面有 9 套配色 × 明暗共 18 种组合，而文字颜色全部来自每套主题各自的
 * `--theme-fg` / `--theme-muted-fg`。任何一套调色板变浅一点，都会让整套主题的次要文字
 * 掉到不可读，而单看截图很难判断「4.4:1 和 4.5:1」的差别。
 *
 * 本测试直接按 WCAG 相对亮度公式计算每套主题、每种表面上的实际对比度。
 * 改动调色板或改语义令牌的混合比例时，它会立刻指出是哪一套、差多少。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const styles_root = path.join(import.meta.dirname, "../src/renderer/styles");

/** 解析 #rrggbb。 */
function parse_hex(value: string): [number, number, number] {
  const hex = value.trim().replace("#", "");
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}

/** WCAG 相对亮度。 */
function luminance([r, g, b]: readonly [number, number, number]): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** 两个不透明色的对比度。 */
function contrast(foreground: readonly [number, number, number], background: readonly [number, number, number]): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** 把带透明度的前景合成到背景上。 */
function composite(foreground: readonly [number, number, number], background: readonly [number, number, number], alpha: number): [number, number, number] {
  return [0, 1, 2].map((index) => foreground[index]! * alpha + background[index]! * (1 - alpha)) as [number, number, number];
}

/** 一套主题的一组变量。 */
interface ThemePalette {
  name: string;
  mode: "light" | "dark";
  variables: Record<string, string>;
}

function read_palettes(): ThemePalette[] {
  const source = fs.readFileSync(path.join(styles_root, "theme/themes.css"), "utf8");
  return [...source.matchAll(/\[data-theme="([a-z]+)"\](\.dark)?\s*\{([^}]*)\}/g)].map((match) => ({
    name: match[1]!,
    mode: match[2] ? "dark" : "light",
    variables: Object.fromEntries([...match[3]!.matchAll(/--theme-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((pair) => [pair[1]!, pair[2]!])),
  }));
}

/** 读取语义令牌里 `--subtle-foreground` 的实际混合比例。 */
function read_subtle_ratio(): number {
  const source = fs.readFileSync(path.join(styles_root, "semantic-colors.css"), "utf8");
  const match = source.match(/--subtle-foreground:\s*color-mix\(in srgb, var\(--muted-foreground\) (\d+)%/);
  assert.ok(match, "无法从 semantic-colors.css 解析 --subtle-foreground 的混合比例");
  return Number(match[1]) / 100;
}

const palettes = read_palettes();
const subtle_ratio = read_subtle_ratio();

test("每套主题都被解析到，明暗成对", () => {
  assert.equal(palettes.length, 18, `解析到 ${palettes.length} 组调色板，期望 18 组（9 主题 × 明暗）`);
  for (const palette of palettes) {
    for (const key of ["bg", "fg", "surface", "muted", "muted-fg"]) {
      assert.ok(palette.variables[key], `${palette.name} ${palette.mode} 缺少 --theme-${key}`);
    }
  }
});

test("正文与次要文字在页面背景上达到 WCAG AA", () => {
  const failures: string[] = [];
  for (const { name, mode, variables } of palettes) {
    const background = parse_hex(variables.bg!);
    const body = contrast(parse_hex(variables.fg!), background);
    const muted = contrast(parse_hex(variables["muted-fg"]!), background);
    // 正文按 AAA 要求（≥7:1），因为它是消息内容的主体；次要文字按 AA（≥4.5:1）。
    if (body < 7) failures.push(`${name} ${mode} 正文 ${body.toFixed(2)}:1 < 7:1`);
    if (muted < 4.5) failures.push(`${name} ${mode} 次要文字 ${muted.toFixed(2)}:1 < 4.5:1`);
  }
  assert.deepEqual(failures, [], `对比度不达标：\n  ${failures.join("\n  ")}`);
});

test("正文在卡片表面上也达到 WCAG AA", () => {
  const failures: string[] = [];
  for (const { name, mode, variables } of palettes) {
    const surface = parse_hex(variables.surface!);
    const body = contrast(parse_hex(variables.fg!), surface);
    if (body < 4.5) failures.push(`${name} ${mode} 卡片正文 ${body.toFixed(2)}:1 < 4.5:1`);
  }
  assert.deepEqual(failures, [], `对比度不达标：\n  ${failures.join("\n  ")}`);
});

test("装饰文字在全部主题下不低于非文本下限 3:1", () => {
  const failures: string[] = [];
  for (const { name, mode, variables } of palettes) {
    const background = parse_hex(variables.bg!);
    const subtle = contrast(composite(parse_hex(variables["muted-fg"]!), background, subtle_ratio), background);
    if (subtle < 3) failures.push(`${name} ${mode} 装饰文字 ${subtle.toFixed(2)}:1 < 3:1`);
  }
  assert.deepEqual(failures, [], `对比度不达标：\n  ${failures.join("\n  ")}`);
});

test("次要文字落在次级容器上不低于 3.9:1（已知未达 AA，此处防止继续恶化）", () => {
  // 实测：6 套浅色主题下，次要文字落在 --theme-muted 上只有 3.99:1 ~ 4.35:1，低于 AA 4.5:1。
  // 修它需要整体调深 6 套调色板的 muted-fg，属于视觉改版，因此此处只设一条防退化下限，
  // 真正的修复留给调色板批次（详见交付说明）。
  const failures: string[] = [];
  const measured: string[] = [];
  for (const { name, mode, variables } of palettes) {
    const muted_surface = parse_hex(variables.muted!);
    const ratio = contrast(parse_hex(variables["muted-fg"]!), muted_surface);
    measured.push(`${name} ${mode} ${ratio.toFixed(2)}:1`);
    if (ratio < 3.9) failures.push(`${name} ${mode} ${ratio.toFixed(2)}:1 < 3.9:1`);
  }
  assert.deepEqual(failures, [], `次级容器上的次要文字退化：\n  ${failures.join("\n  ")}\n\n当前全部取值：\n  ${measured.join("\n  ")}`);
});
