/**
 * CLI 输出工具（统一出口）。
 *
 * 关键点（中文）
 * - 所有命令通过 printResult 输出，不再直接调用 emitCliBlock / emitCliList / console.log。
 * - asJson=true → 结构化 JSON（脚本友好）；asJson=false → 委托 CliReporter 渲染人类可读文本。
 * - 支持两种输出类型：block（单段落）和 list（列表分组）。
 */

import {
  emitCliBlock,
  emitCliList,
} from "@/shared/CliReporter.js";
import type {
  CliReportFact,
  CliReportListItem,
  CliReportTone,
} from "@/shared/types/CliReporter.js";

/**
 * printResult 统一参数。
 *
 * 说明（中文）
 * - type="block" 时直接按 CliReportBlock 渲染。
 * - type="list" 时直接按 CliReportList 渲染。
 */
export type PrintResultParams = {
  /** 是否以 JSON 格式输出（默认 true，保持历史行为）。 */
  asJson?: boolean;
  /** 当前操作是否成功（影响 JSON 的 success 字段和色调默认值）。 */
  success: boolean;
  /** 输出标题（JSON 中作为 title，人类可读中作为 heading）。 */
  title: string;

  /** 输出类型。 */
  type: "block" | "list";

  // --- block / list 共享 ---
  /** 视觉语气。 */
  tone?: CliReportTone;
  /** 标题右侧补充摘要。 */
  summary?: string;

  // --- block 专用 ---
  /** 详情键值对。 */
  facts?: CliReportFact[];
  /** 附注文本。 */
  note?: string;

  // --- list 专用 ---
  /** 列表项。 */
  items?: CliReportListItem[];

  /** JSON 模式下的结构化业务数据。 */
  data?: Record<string, unknown>;

};

/**
 * 统一 CLI 输出入口。
 *
 * 行为（中文）
 * - asJson=true：输出 `{ success, title, ... }` 到 stdout。
 * - asJson=false：
 *   - type="block" → emitCliBlock
 *   - type="list" → emitCliList
 */
export function printResult(params: PrintResultParams): void {
  const asJson = params.asJson !== false;

  if (asJson) {
    const output: Record<string, unknown> = { success: params.success };

    if (params.type === "block") {
      output.title = params.title;
      if (params.summary) output.summary = params.summary;
      if (params.facts && params.facts.length > 0) output.facts = params.facts;
      if (params.note) output.note = params.note;
    } else if (params.type === "list") {
      output.title = params.title;
      if (params.summary) output.summary = params.summary;
      if (params.items && params.items.length > 0) output.items = params.items;
    }
    if (params.data) output.data = params.data;

    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // --- 人类可读模式 ---
  if (params.type === "block") {
    emitCliBlock({
      tone: params.tone || (params.success ? "success" : "error"),
      title: params.title,
      summary: params.summary,
      facts: params.facts,
      note: params.note,
    });
    return;
  }

  if (params.type === "list") {
    emitCliList({
      tone: params.tone || "accent",
      title: params.title,
      summary: params.summary,
      items: params.items || [],
    });
    return;
  }

  throw new Error(`Unsupported CLI output type: ${params.type}`);
}
