/**
 * 终端状态渲染工具。
 *
 * 设计目标（中文）
 * - 为 status 类命令提供统一、可读性更强的“面板化”输出。
 * - 保持零依赖：不引入第三方库，直接使用 ANSI 转义序列。
 * - 在非 TTY 或 NO_COLOR 场景自动降级为无色输出。
 */

export type StatusTone = "success" | "error" | "warning" | "info" | "neutral";

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  fgGreen: "\u001b[32m",
  fgRed: "\u001b[31m",
  fgYellow: "\u001b[33m",
  fgCyan: "\u001b[36m",
  fgGray: "\u001b[90m",
};

function colorEnabled(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function paint(input: string, code: string): string {
  if (!colorEnabled()) return input;
  return `${code}${input}${ANSI.reset}`;
}

export function tone_tag(tone: StatusTone): string {
  if (tone === "success") return paint("OK", ANSI.fgGreen);
  if (tone === "error") return paint("ERR", ANSI.fgRed);
  if (tone === "warning") return paint("WARN", ANSI.fgYellow);
  if (tone === "info") return paint("INFO", ANSI.fgCyan);
  return paint("STATE", ANSI.fgGray);
}

export function dim(input: string): string {
  return paint(input, ANSI.dim);
}

export function bold(input: string): string {
  return paint(input, ANSI.bold);
}

/**
 * 打印面板。
 */
export function print_panel(params: {
  title: string;
  tone?: StatusTone;
  lines: string[];
}): void {
  const tone = params.tone || "neutral";
  const title = `${tone_tag(tone)} ${bold(params.title)}`;
  const contentLines = [title, ...params.lines];

  const maxLineLength = Math.max(
    24,
    ...contentLines.map((line) => stripAnsi(line).length),
  );
  const border = "─".repeat(maxLineLength + 2);

  console.log(`┌${border}┐`);
  for (const line of contentLines) {
    const plain = stripAnsi(line).length;
    const pad = " ".repeat(Math.max(0, maxLineLength - plain));
    console.log(`│ ${line}${pad} │`);
  }
  console.log(`└${border}┘`);
}

/**
 * 渲染对齐字段行。
 */
export function render_key_value_lines(
  entries: Array<[string, string]>,
  indent: number = 2,
): string[] {
  if (entries.length === 0) return [];
  const keyWidth = Math.max(...entries.map(([key]) => key.length), 8);
  const pad = " ".repeat(Math.max(0, indent));
  return entries.map(([key, value]) => {
    const left = `${pad}${dim(key.padEnd(keyWidth, " "))}`;
    return `${left} : ${value}`;
  });
}

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, "");
}

