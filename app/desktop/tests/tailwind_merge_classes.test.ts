/**
 * `cn()` 与语义字号的守卫。
 *
 * ## 为什么需要这个文件
 *
 * 这里记录的是真实发生过的缺陷：消息字号连续多轮「调整」在浏览器里毫无视觉效果，
 * 表现得像「改了没反应」。
 *
 * `cn` 底层是 tailwind-merge，它的合并规则来自一份内置的 Tailwind 类名表。
 * 本应用的字号档位（`text-3xs` … `text-3xl`）不在那张表里，或者与表里的含义不同，
 * 于是被按「`text-` + 自由值 = 文字颜色」处理：
 *
 * ```text
 * twMerge("text-sm text-foreground") → "text-foreground"
 * ```
 *
 * 字号类被当成「与 `text-foreground` 冲突的颜色」直接删掉。这个失效**完全静默**：
 *
 * - TypeScript 检查不到（类名就是字符串）；
 * - Tailwind 也确实生成了 `.text-sm` 规则；
 * - `chat_message_layout.test.ts` 断言源码里的类名常量也全部通过；
 * - 只有浏览器里字号悄悄退回 `inherit`。
 *
 * ## 当时的结论与现在的结论
 *
 * 当时的结论是绕开工具类：字号改用普通 CSS 类 `.chat-message-text`，
 * 既不参与 twMerge 归类，也不依赖扫描器产物。那个决定救回了字号，但代价是
 * **字号被移出 Tailwind 的语义体系**，应用里多了一套只此一处的例外写法。
 *
 * 现在字号收敛为 9 级语义档位并要求全部走 Tailwind 工具类，
 * 所以必须把根因修掉而不是绕开：`lib/utils.ts` 用 `extendTailwindMerge`
 * 把这 9 个档位注册进 `font-size` 组。
 *
 * 这个文件守住那个修复。绕开与修复两个方向都会**静默**失败，
 * 因此断言必须调用真正的 `cn`，而不是比对源码文本。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { twMerge } from "tailwind-merge";
import { cn, font_size_scale } from "../src/renderer/lib/utils.ts";

const renderer_root = path.join(import.meta.dirname, "../src/renderer");
const messages_root = path.join(renderer_root, "features/chat/components/messages");
const layout_source = fs.readFileSync(path.join(messages_root, "message_layout.ts"), "utf8");

/** 取出一条导出的类名常量值。 */
function read_class_name(name: string): string {
  const match = new RegExp(`${name} = "([^"]*)"`).exec(layout_source);
  assert.ok(match, `message_layout 里找不到 ${name}`);
  return match![1]!;
}

/**
 * 核心断言：真实调用点的 `cn()` 必须原样保留语义字号。
 *
 * 四处写法取自组件源码，包含类名在不同位置、以及条件类同时存在的情况——
 * 这正是当初被删除的场景（`text-foreground` 与字号类同时出现）。
 */
test("cn() 在真实调用点保留语义字号", () => {
  const size_class = read_class_name("chat_message_text_class_name");
  const call_sites: Record<string, string[]> = {
    AgentMessageContent: ["min-h-[1lh] text-foreground", size_class],
    UserMessageContent: ["user-message-text-part", size_class, "is-inline"],
    "GroupView(agent)": ["min-w-0 max-w-full break-words text-foreground", size_class],
    "GroupView(user)": ["break-words", size_class],
  };

  for (const [name, input] of Object.entries(call_sites)) {
    const merged = cn(...input);
    for (const class_name of ["text-sm", "leading-reading", "text-foreground"]) {
      assert.ok(
        merged.split(/\s+/).includes(class_name),
        `${name} 的 cn() 丢掉了 ${class_name}：得到「${merged}」`,
      );
    }
  }
});

/**
 * 逐个档位验证：任何一级与文字颜色同处一个 `cn()` 都必须存活。
 *
 * 只测 `base` 不够——注册表是逐项列举的，漏一项就只影响那一项，
 * 而它恰好是「某几个界面的字号不对」这种最难归因的缺陷。
 */
test("每一级语义字号都能穿过 cn()", () => {
  for (const size of font_size_scale) {
    const merged = cn(`text-${size}`, "text-foreground");
    assert.ok(
      merged.split(/\s+/).includes(`text-${size}`),
      `cn() 丢掉了 text-${size}：得到「${merged}」。lib/utils.ts 的 font_size_scale 漏了它。`,
    );
  }
});

/**
 * 反向确认：守卫不是恒真。
 *
 * 取一个 tailwind-merge 完全不认识的档名（当初缺陷里的 `text-message` 同形），
 * 它必须**被删除**。如果它存活了，说明上面几条断言无法捕获真实缺陷
 * （那意味着 tailwind-merge 的归类行为已经变了，本文件的结论需要重新推导）。
 *
 * 注意不能用 `text-4xl` 做这个反例：tailwind-merge 的内置表认得它（会当 font-size 保留），
 * 但 Tailwind 又不会为它生成规则（已被 `--text-*: initial` 清掉）。
 * 那个「保留但无规则」的缺口由 `font_scale.test.ts` 的第 9 条断言负责。
 */
test("tailwind-merge 不认识的自定义档名确实会被吞掉（证明上面几条断言有效）", () => {
  const merged = twMerge("text-size-99 text-foreground");
  assert.ok(
    !merged.split(/\s+/).includes("text-size-99"),
    "未注册的自定义档名竟然存活了：本文件的断言可能恒真，无法捕获真实缺陷",
  );
});

/**
 * 同一组内的覆盖关系必须正常。
 *
 * 语义字号都属 font-size 组，因此后者覆盖前者；这与普通 Tailwind 行为一致，
 * 也是组件用 `cn(base, override)` 覆盖字号的依据。
 */
test("字号之间仍然是后者覆盖前者", () => {
  assert.equal(cn("text-xs", "text-sm"), "text-sm");
  assert.equal(cn("text-sm", "text-xs"), "text-xs");
  // 行高不属 font-size 组，不能被字号顺手清掉。
  assert.ok(cn("text-sm", "leading-reading").split(/\s+/).includes("leading-reading"));
});

/**
 * 消息正文的字号与行高必须来自语义档位，不能再退回普通 CSS 类。
 *
 * `styles/chat.css` 是无图层 CSS，优先级高于 `@layer utilities`。
 * 如果那里又出现一条给消息正文定字号的规则，工具类会被盖掉且很难排查。
 */
test("消息正文不再依赖 styles 里的普通类", () => {
  const text = read_class_name("chat_message_text_class_name");
  assert.ok(!/\bchat-message-text\b/.test(text), `消息正文又用回了普通 CSS 类：${text}`);

  const chat_styles = fs.readFileSync(path.join(renderer_root, "styles/chat.css"), "utf8");
  assert.ok(!/\.chat-message-text\s*\{/.test(chat_styles), "chat.css 里又出现了 .chat-message-text 规则：无图层 CSS 会盖掉工具类");
});
