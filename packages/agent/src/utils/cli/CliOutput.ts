/**
 * CLI 输出工具。
 *
 * 关键点（中文）
 * - 统一支持 JSON / 文本输出。
 * - 保持 shell 调用与 AI 调用都可稳定解析。
 */
import {
  print_panel,
  render_key_value_lines,
  type StatusTone,
} from "@/utils/cli/PrettyStatus.js";

/**
 * 标准化输出结果。
 *
 * 输出策略（中文）
 * - 默认 JSON（便于脚本解析）。
 * - `asJson=false` 时输出可读文本。
 */
export function print_result(params: {
  asJson?: boolean;
  success: boolean;
  title: string;
  payload: Record<string, unknown>;
}): void {
  const asJson = params.asJson !== false;
  const payload = {
    success: params.success,
    ...params.payload,
  };

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const entries = Object.entries(payload).filter(
    ([key, value]) => key !== "success" && value !== undefined,
  );
  const lines = renderObject(entries, 0);
  const tone: StatusTone = params.success ? "success" : "error";
  print_panel({
    title: params.title,
    tone,
    lines: lines.length > 0 ? lines : ["  no details"],
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function renderScalar(
  key: string,
  value: string | number | boolean | null,
  indent: number,
): string[] {
  return render_key_value_lines(
    [[key, value === null ? "null" : String(value)]],
    indent,
  );
}

function renderArray(
  key: string,
  value: unknown[],
  indent: number,
): string[] {
  const lines: string[] = [];
  const [header] = render_key_value_lines([[key, value.length === 0 ? "[]" : ""]], indent);
  if (header) lines.push(header);
  if (value.length === 0) {
    return lines;
  }

  for (const [index, item] of value.entries()) {
    if (isPlainObject(item)) {
      lines.push(`${" ".repeat(indent + 2)}- [${index + 1}]`);
      lines.push(...renderObject(Object.entries(item), indent + 4));
      continue;
    }
    if (Array.isArray(item)) {
      lines.push(`${" ".repeat(indent + 2)}- [${index + 1}] (array)`);
      lines.push(...renderArray("items", item, indent + 4));
      continue;
    }
    lines.push(`${" ".repeat(indent + 2)}- [${index + 1}] ${String(item)}`);
  }
  return lines;
}

function renderObject(entries: Array<[string, unknown]>, indent: number): string[] {
  if (entries.length === 0) return [];
  const ordered = [...entries].sort((a, b) => {
    if (a[0] === "error") return 1;
    if (b[0] === "error") return -1;
    return a[0].localeCompare(b[0]);
  });
  const lines: string[] = [];

  for (const [key, value] of ordered) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      lines.push(...renderScalar(key, value, indent));
      continue;
    }

    if (Array.isArray(value)) {
      lines.push(...renderArray(key, value, indent));
      continue;
    }

    if (isPlainObject(value)) {
      const [header] = render_key_value_lines([[key, ""]], indent);
      if (header) lines.push(header);
      lines.push(...renderObject(Object.entries(value), indent + 2));
      continue;
    }

    lines.push(...renderScalar(key, String(value), indent));
  }
  return lines;
}
