/**
 * 消息正文排版类的守卫。
 *
 * ## 为什么需要这个文件
 *
 * 这里记录的是真实发生过的缺陷：消息字号改用自定义工具类 `text-message` 之后，
 * 连续多轮「调整字号」都没有任何视觉效果，表现得像「改了没反应」。
 *
 * `cn` 底层的 tailwind-merge 不认识自定义字号，会把它归到**文字颜色**组
 * （颜色组接受任意自由值），于是：
 *
 * ```text
 * twMerge("text-message text-foreground") → "text-foreground"
 * ```
 *
 * 字号类被当成「与 text-foreground 冲突的颜色」直接删掉。这个失效**完全静默**：
 *
 * - TypeScript 检查不到（类名就是字符串）；
 * - Tailwind 也确实生成了 `.text-message` 规则；
 * - `chat_message_layout.test.ts` 断言源码里的类名常量也全部通过；
 * - 只有浏览器里字号悄悄退回 `inherit`。
 *
 * 结论不是「给 twMerge 打补丁」，而是**不要让字号依赖工具类**：类名改成普通 CSS 类
 * `chat-message-text`（定义在 `styles/chat.css`），既不参与 twMerge 归类，
 * 也不依赖 Tailwind 扫描器产物。
 *
 * 本文件守住这个决定，包含三部分：
 *
 * 1. 类名不能是 Tailwind 工具类形状（否则 twMerge 可能归类并删除）；
 * 2. `cn()` 在四个真实调用点必须原样保留它（跑真正的 `cn`，不是比对源码文本）；
 * 3. CSS 规则必须存在、且只引用 `--text-message` 令牌。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { cn } from "../src/renderer/lib/utils.ts";

const renderer_root = path.join(import.meta.dirname, "../src/renderer");
const messages_root = path.join(renderer_root, "features/chat/components/messages");

const layout_source = fs.readFileSync(path.join(messages_root, "message_layout.ts"), "utf8");
const chat_styles = fs.readFileSync(path.join(renderer_root, "styles/chat.css"), "utf8");

/** 取出一条导出的类名常量值。 */
function read_class_name(name: string): string {
  const match = new RegExp(`${name} = "([^"]*)"`).exec(layout_source);
  assert.ok(match, `message_layout 里找不到 ${name}`);
  return match![1]!;
}

test("消息排版类必须是普通 CSS 类，不能是 Tailwind text-* 工具类", () => {
  const value = read_class_name("chat_message_text_class_name");
  const classes = value.split(/\s+/);

  // 允许的 Tailwind 工具类只有颜色、尺寸这类无歧义的。
  const tailwind_like = classes.filter((name) => /^text-(?!center|left|right|justify|ellipsis|wrap|nowrap|balance|pretty|clip|foreground|muted-foreground|subtle-foreground|primary|destructive|background|inherit|current)/.test(name));
  assert.deepEqual(
    tailwind_like,
    [],
    `消息排版类里出现了 text-* 形状的类：${tailwind_like.join(", ")}。\n` +
      "自定义字号写成 tooltip 工具类时，twMerge 会把它当文字颜色删除，且不报错。请改用 styles/chat.css 里的普通类。",
  );

  const own = classes.find((name) => name === "chat-message-text");
  assert.ok(own, `消息排版类应当包含 chat-message-text，实际为：${value}`);
});

test("styles/chat.css 里的 .chat-message-text 只引用 --text-message 令牌", () => {
  const rule = /\.chat-message-text\s*\{([\s\S]*?)\}/.exec(chat_styles);
  assert.ok(rule, "chat.css 里找不到 .chat-message-text 规则；字号必须由样式表提供，不依赖扫描器生成工具类");
  assert.ok(/font-size:\s*var\(--text-message\)/.test(rule[1]), `.chat-message-text 没有引用 --text-message：${rule[1]}`);
  assert.ok(/line-height:\s*var\(--text-message--line-height\)/.test(rule[1]), `.chat-message-text 没有引用 --text-message--line-height：${rule[1]}`);
  // 反向：不得在这里写死数值，否则令牌不再是唯一来源。
  assert.ok(!/font-size:\s*[\d.]+(?:rem|px)/.test(rule[1]), ".chat-message-text 用字面量写死了字号");
});

/**
 * 核心断言：真实调用点的 `cn()` 必须原样保留排版类。
 *
 * 四处的写法取自组件源码，包含类名在不同位置、以及条件类同时存在的情况——
 * 这正是当初被删除的场景（`text-foreground` 与字号类同时出现）。
 */
test("cn() 在真实调用点保留 chat-message-text", () => {
  const size_class = read_class_name("chat_message_text_class_name");
  const call_sites = {
    "AgentMessageContent": ["min-h-[1lh] text-foreground", size_class],
    "UserMessageContent": ["user-message-text-part", size_class, "is-inline"],
    "GroupView(agent)": ["min-w-0 max-w-full break-words text-foreground", size_class],
    "GroupView(user)": ["break-words", size_class],
  };

  for (const [name, input] of Object.entries(call_sites)) {
    const merged = cn(...input);
    for (const class_name of ["chat-message-text", "text-foreground"]) {
      assert.ok(
        merged.split(/\s+/).includes(class_name),
        `${name} 的 cn() 丢掉了 ${class_name}：得到「${merged}」`,
      );
    }
  }
});

/**
 * 反向确认：守卫不是恒真。
 *
 * 用当初出问题的那种写法（自定义字号做成工具类）重复同样的调用。
 * 它必须**被删除**——如果它存活了，说明上面几条断言无法捕获真实缺陷。
 */
test("当初的 text-* 写法确实会被吞掉（证明上面几条断言有效）", () => {
  const merged = cn("text-message text-foreground");
  assert.ok(
    !merged.split(/\s+/).includes("text-message"),
    "自定义 text-* 工具类竟然存活了：本文件的断言可能恒真，无法捕获真实缺陷",
  );
});
