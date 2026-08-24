/**
 * Session Question Interaction 内联回答面板。
 *
 * 关键点（中文）
 * - 面板只解释 canonical Question 请求并收集结构化回答，不复制 Session 状态。
 * - 一次 Interaction 的多个问题按顺序填写，全部完成后一次性提交 answers。
 * - Esc / Ctrl+C 交给协调器停止当前 Turn，确保等待中的 Interaction 正确取消。
 */

import {
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  type Component,
  type Focusable,
} from "@earendil-works/pi-tui";
import type {
  SessionInteractionAnswer,
  SessionInteractionQuestion,
  SessionInteractionRequest,
} from "@downcity/agent";

import { SELECT_POINTER } from "@/city/agent/tui/constant/symbols.js";
import { current_theme } from "@/city/agent/tui/theme/index.js";

const BORDER_HORIZONTAL = "─";
const ELLIPSIS = "…";
const MAX_VISIBLE_OPTIONS = 6;

/** Question 面板构造参数。 */
export interface QuestionPanelOptions {
  /** Session 持久化的 Question Interaction 请求。 */
  request: SessionInteractionRequest;
  /** 全部问题完成后的结构化回答回调。 */
  on_submit: (answers: SessionInteractionAnswer[]) => void;
  /** 用户主动取消回答时触发，由协调器停止当前 Turn。 */
  on_cancel: () => void;
}

/** 支持文本、单选和多选的 Question Interaction 面板。 */
export class QuestionPanelComponent implements Component, Focusable {
  private readonly request: SessionInteractionRequest;
  private readonly on_submit: (answers: SessionInteractionAnswer[]) => void;
  private readonly on_cancel: () => void;
  private readonly answers: SessionInteractionAnswer[] = [];
  private input = new Input();
  private question_index = 0;
  private selected_option_index = 0;
  private selected_values = new Set<string>();

  focused = false;

  /** 创建面板并准备第一个问题。 */
  constructor(options: QuestionPanelOptions) {
    this.request = options.request;
    this.on_submit = options.on_submit;
    this.on_cancel = options.on_cancel;
    this.prepare_current_question();
  }

  /** 把键盘输入路由到当前问题对应的输入方式。 */
  handleInput(data: string): void {
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, "ctrl+c") ||
      matchesKey(data, "ctrl+d")
    ) {
      this.on_cancel();
      return;
    }

    const question = this.current_question;
    if (!question) return;
    if (question.response_type === "text") {
      this.input.handleInput(data);
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.move_option(-1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.move_option(1);
      return;
    }
    if (question.response_type === "multi_select" && matchesKey(data, Key.space)) {
      this.toggle_current_option();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.submit_select_answer(question);
    }
  }

  /** 渲染当前问题、输入控件和操作提示。 */
  render(width: number): string[] {
    const safe_width = Math.max(0, width);
    if (safe_width <= 0) return [""];
    const inner_width = Math.max(1, safe_width - 2);
    const question = this.current_question;
    if (!question) return [];

    const lines = [
      current_theme.fg("primary", BORDER_HORIZONTAL.repeat(safe_width)),
      this.render_title(inner_width),
      this.render_prompt(inner_width, question),
      "",
      ...this.render_answer_control(inner_width, question),
      "",
      this.render_hint(inner_width, question),
      current_theme.fg("primary", BORDER_HORIZONTAL.repeat(safe_width)),
    ];
    return lines.map((line) => truncateToWidth(line, safe_width, ELLIPSIS));
  }

  /** 清理文本输入组件的渲染缓存。 */
  invalidate(): void {
    this.input.invalidate();
  }

  private get current_question(): SessionInteractionQuestion | undefined {
    return this.questions[this.question_index];
  }

  private get questions(): SessionInteractionQuestion[] {
    const payload = this.request.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
    const questions = (payload as { questions?: unknown }).questions;
    return Array.isArray(questions) ? questions as SessionInteractionQuestion[] : [];
  }

  /** 为当前问题重置临时输入状态。 */
  private prepare_current_question(): void {
    this.selected_option_index = 0;
    this.selected_values = new Set<string>();
    this.input = new Input();
    this.input.onSubmit = (value) => this.commit_answer(value);
  }

  /** 记录当前答案；最后一题完成时提交完整 answers。 */
  private commit_answer(value: string | string[]): void {
    const question = this.current_question;
    if (!question) return;
    this.answers.push({ question_id: question.question_id, value });
    if (this.answers.length === this.questions.length) {
      this.on_submit([...this.answers]);
      return;
    }
    this.question_index += 1;
    this.prepare_current_question();
  }

  /** 提交当前单选或多选答案。 */
  private submit_select_answer(question: SessionInteractionQuestion): void {
    const options = question.options ?? [];
    if (question.response_type === "multi_select") {
      this.commit_answer(
        options
          .map((option) => option.value)
          .filter((value) => this.selected_values.has(value)),
      );
      return;
    }
    const option = options[this.selected_option_index];
    if (option) this.commit_answer(option.value);
  }

  /** 在当前问题的选项中循环移动。 */
  private move_option(delta: number): void {
    const count = this.current_question?.options?.length ?? 0;
    if (count <= 0) return;
    this.selected_option_index = (this.selected_option_index + delta + count) % count;
  }

  /** 切换当前多选项。 */
  private toggle_current_option(): void {
    const option = this.current_question?.options?.[this.selected_option_index];
    if (!option) return;
    if (this.selected_values.has(option.value)) {
      this.selected_values.delete(option.value);
    } else {
      this.selected_values.add(option.value);
    }
  }

  private render_title(inner_width: number): string {
    const progress = `${this.question_index + 1}/${this.questions.length}`;
    const title = current_theme.bold_fg(
      "accent",
      ` ${this.request.title || "需要输入"} · ${progress} `,
    );
    return " " + truncateToWidth(title, inner_width, ELLIPSIS);
  }

  private render_prompt(
    inner_width: number,
    question: SessionInteractionQuestion,
  ): string {
    return " " + truncateToWidth(
      current_theme.bold_fg("text", question.prompt),
      inner_width,
      ELLIPSIS,
    );
  }

  private render_answer_control(
    inner_width: number,
    question: SessionInteractionQuestion,
  ): string[] {
    if (question.response_type === "text") {
      this.input.focused = this.focused;
      return this.input
        .render(Math.max(1, inner_width - 2))
        .map((line) => `  ${line}`);
    }

    const options = question.options ?? [];
    const start = Math.max(
      0,
      Math.min(
        this.selected_option_index - Math.floor(MAX_VISIBLE_OPTIONS / 2),
        options.length - MAX_VISIBLE_OPTIONS,
      ),
    );
    return options
      .slice(start, start + MAX_VISIBLE_OPTIONS)
      .map((option, offset) => {
        const index = start + offset;
        const selected = index === this.selected_option_index;
        const checked = question.response_type === "multi_select"
          ? (this.selected_values.has(option.value) ? "●" : "○")
          : "";
        const pointer = selected ? `${SELECT_POINTER} ` : "  ";
        const label = selected
          ? current_theme.bold_fg("primary", option.label)
          : current_theme.fg("text", option.label);
        const description = option.description
          ? current_theme.dim_fg("textMuted", ` · ${option.description}`)
          : "";
        return ` ${pointer}${checked}${checked ? " " : ""}${label}${description}`;
      });
  }

  private render_hint(
    inner_width: number,
    question: SessionInteractionQuestion,
  ): string {
    const hint = question.response_type === "text"
      ? "Enter submit · Esc stop turn"
      : question.response_type === "multi_select"
        ? "↑↓ navigate · Space toggle · Enter submit · Esc stop turn"
        : "↑↓ navigate · Enter submit · Esc stop turn";
    return " " + truncateToWidth(
      current_theme.dim_fg("textMuted", hint),
      inner_width,
      ELLIPSIS,
    );
  }
}
