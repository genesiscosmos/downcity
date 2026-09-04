/**
 * 共享全屏 TUI 运行时。
 *
 * 关键点（中文）
 * - 业务组件仍使用 pi-tui 的 Component / Focusable / ProcessTerminal 输入模型。
 * - 渲染层不使用 pi-tui 的差分刷新；菜单类界面每次直接清屏全量重绘。
 * - 这样可以避免不同终端 scrollback / viewport / 右边界自动换行导致旧帧堆叠。
 */

import {
  isKeyRelease,
  isKeyRepeat,
  ProcessTerminal,
  type Component,
  type Focusable,
} from "@earendil-works/pi-tui";
import {
  format_tui_table,
  TuiDashboardComponent,
  TuiInputComponent,
  TuiLoadingComponent,
  TuiMultiSelectComponent,
  TuiSelectComponent,
  TuiTextViewComponent,
} from "@/shared/tui/TuiComponents.js";
import type {
  tui_dashboard_item,
  tui_message_kind,
  tui_prompt_option,
  tui_table_input,
} from "@/shared/types/TuiPrompt.js";

/**
 * 共享 TUI runtime 构造参数。
 */
export interface managed_tui_runtime_input {
  /** 终端窗口标题。 */
  title: string;
}

/**
 * dashboard 循环的视图状态。
 */
export interface managed_tui_dashboard_state {
  /** dashboard 顶部标题。 */
  title: string;
  /** dashboard 顶部副标题。 */
  subtitle: string;
  /** dashboard 底部帮助文案。 */
  footer: string;
  /** dashboard 列表项。 */
  items: tui_dashboard_item[];
}

/**
 * dashboard 动作结果。
 */
export type managed_tui_action_result = "refresh" | "quit";

/**
 * dashboard 循环构造参数。
 */
export interface managed_tui_dashboard_loop_input<Action extends string> {
  /** 每次打开面板时使用的终端标题。 */
  runtime_title: string;
  /** 构建最新 dashboard 状态。 */
  build_state: () => managed_tui_dashboard_state | Promise<managed_tui_dashboard_state>;
  /** 执行选中的业务动作。 */
  run_action: (action: Action) => managed_tui_action_result | Promise<managed_tui_action_result>;
}

/**
 * 运行标准 dashboard 循环。
 *
 * 关键点（中文）
 * - 每一轮选择结束后立即关闭当前 runtime，再执行业务动作。
 * - 如果业务动作会打开子 TUI，终端里始终只有一个全屏 runtime 存活。
 * - 动作结束后重新创建父 runtime，避免父子面板互相补帧。
 */
export async function run_managed_dashboard_loop<Action extends string>(
  input: managed_tui_dashboard_loop_input<Action>,
): Promise<void> {
  while (true) {
    const runtime = new ManagedTuiRuntime({ title: input.runtime_title });
    let selection: string | undefined;
    try {
      selection = await runtime.dashboard(await input.build_state());
    } finally {
      runtime.close();
    }

    if (!selection) {
      return;
    }

    const result = await input.run_action(selection as Action);
    if (result === "quit") {
      return;
    }
  }
}

/**
 * 共享全屏 TUI runtime。
 */
export class ManagedTuiRuntime {
  private readonly terminal: ProcessTerminal;
  private component: (Component & Partial<Focusable>) | null = null;
  private started = false;
  private closed = false;
  private render_scheduled = false;
  private loading_interval: ReturnType<typeof setInterval> | undefined;

  /**
   * @param input runtime 构造参数。
   */
  constructor(input: managed_tui_runtime_input) {
    this.terminal = new ProcessTerminal();
    this.terminal.setTitle(input.title);
  }

  /**
   * 关闭 runtime。
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.loading_interval) {
      clearInterval(this.loading_interval);
      this.loading_interval = undefined;
    }
    this.component = null;
    this.clear_screen();
    this.terminal.showCursor();
    if (this.started) {
      this.terminal.stop();
    }
  }

  /**
   * 显示 dashboard 并等待用户选择。
   */
  async dashboard(input: {
    title: string;
    subtitle: string;
    footer: string;
    items: tui_dashboard_item[];
  }): Promise<string | undefined> {
    return await this.run_component<string | undefined>((finish) =>
      new TuiDashboardComponent({
        ...input,
        on_finish: finish,
      }),
    );
  }

  /**
   * 显示选择菜单并等待用户选择。
   */
  async select(input: {
    title: string;
    subtitle?: string;
    footer: string;
    options: tui_prompt_option[];
    show_detail?: boolean;
    initial_index?: number;
  }): Promise<string | undefined> {
    return await this.run_component<string | undefined>((finish) =>
      new TuiSelectComponent({
        ...input,
        show_detail: input.show_detail ?? true,
        on_finish: finish,
      }),
    );
  }

  /**
   * 显示多选菜单并等待用户提交。
   */
  async multiselect(input: {
    title: string;
    subtitle?: string;
    footer: string;
    options: tui_prompt_option[];
    initial_values?: string[];
  }): Promise<string[] | undefined> {
    return await this.run_component<string[] | undefined>((finish) =>
      new TuiMultiSelectComponent({
        ...input,
        on_finish: finish,
      }),
    );
  }

  /**
   * 显示文本输入并等待提交。
   */
  async text(input: {
    title: string;
    placeholder?: string;
    password?: boolean;
  }): Promise<string | undefined> {
    return await this.run_component<string | undefined>((finish) =>
      new TuiInputComponent({
        ...input,
        on_finish: finish,
      }),
    );
  }

  /**
   * 显示可滚动文本。
   */
  async show_text(title: string, content: string): Promise<void> {
    await this.run_component<void>((finish) =>
      new TuiTextViewComponent({
        title,
        content,
        footer: "Enter / Esc 返回 · ↑↓ / PageUp PageDown 滚动",
        on_finish: finish,
      }),
    );
  }

  /**
   * 显示表格。
   */
  async show_table(input: tui_table_input): Promise<void> {
    await this.show_text(input.title, format_tui_table(input));
  }

  /**
   * 显示 JSON。
   */
  async show_json(title: string, data: unknown): Promise<void> {
    await this.show_text(title, JSON.stringify(data, null, 2));
  }

  /**
   * 显示短消息。
   */
  async show_message(kind: tui_message_kind, message: string): Promise<void> {
    await this.show_text(kind.toUpperCase(), message);
  }

  /**
   * 显示 loading 并执行异步任务。
   */
  async with_loading<T>(title: string, task: () => Promise<T>): Promise<T> {
    this.ensure_started();
    const component = new TuiLoadingComponent({
      title,
      message: title,
    });
    this.set_component(component);
    this.loading_interval = setInterval(() => {
      component.tick();
      this.request_render();
    }, 80);
    try {
      return await task();
    } finally {
      if (this.loading_interval) {
        clearInterval(this.loading_interval);
        this.loading_interval = undefined;
      }
    }
  }

  /**
   * 运行自定义组件。
   *
   * 关键点（中文）
   * - 复杂业务屏幕可以通过这个扩展点复用 shared runtime 的生命周期。
   * - 组件内部仍只负责 render / handleInput，不直接接触 ProcessTerminal。
   */
  async run_custom<T>(
    create_component: (
      finish: (value: T) => void,
      request_render: () => void,
    ) => Component & Partial<Focusable>,
  ): Promise<T> {
    return await this.run_component<T>((finish) =>
      create_component(finish, () => this.request_render()),
    );
  }

  private async run_component<T>(
    create_component: (finish: (value: T) => void) => Component & Partial<Focusable>,
  ): Promise<T> {
    this.ensure_started();
    return await new Promise<T>((resolve) => {
      let finished = false;
      const finish = (value: T): void => {
        if (finished) return;
        finished = true;
        this.component = null;
        this.clear_screen();
        setImmediate(() => resolve(value));
      };
      this.set_component(create_component(finish));
    });
  }

  private ensure_started(): void {
    if (this.started) return;
    this.started = true;
    this.terminal.start(
      (data) => this.handle_input(data),
      () => this.request_render(),
    );
    this.terminal.hideCursor();
    this.request_render();
  }

  private set_component(component: Component & Partial<Focusable>): void {
    if (this.component && "focused" in this.component) {
      this.component.focused = false;
    }
    this.component = component;
    if ("focused" in component) {
      component.focused = true;
    }
    this.request_render();
  }

  private handle_input(data: string): void {
    if (this.closed || !this.component) return;
    if (isKeyRelease(data) && !wants_key_release(this.component)) {
      return;
    }
    if (isKeyRepeat(data) && !wants_key_repeat(this.component)) {
      return;
    }
    this.component.handleInput?.(data);
    this.request_render();
  }

  private request_render(): void {
    if (this.closed || this.render_scheduled) return;
    this.render_scheduled = true;
    process.nextTick(() => {
      this.render_scheduled = false;
      this.render();
    });
  }

  private render(): void {
    if (this.closed || !this.component) return;
    const width = this.terminal.columns;
    const lines = this.component.render(width);
    const output = ["\x1b[?2026h", "\x1b[2J\x1b[H\x1b[3J"];
    output.push(...lines.map((line, index) => index === 0 ? line : `\r\n${line}`));
    output.push("\x1b[?2026l");
    this.terminal.write(output.join(""));
    this.terminal.hideCursor();
  }

  private clear_screen(): void {
    this.terminal.write("\x1b[?2026h\x1b[2J\x1b[H\x1b[3J\x1b[?2026l");
  }
}

function wants_key_release(component: Component & Partial<Focusable>): boolean {
  return (component as { wantsKeyRelease?: unknown }).wantsKeyRelease === true;
}

function wants_key_repeat(component: Component & Partial<Focusable>): boolean {
  return (component as { wantsKeyRepeat?: unknown }).wantsKeyRepeat === true;
}
