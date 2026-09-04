/**
 * Federation Admin TUI runtime 适配层。
 *
 * 关键说明（中文）
 * - 业务命令继续依赖 admin_tui_runtime 接口。
 * - 内部统一委托 shared pi-tui runtime，和其它 CLI TUI 保持同一套框架。
 */

import { ManagedTuiRuntime } from "@/shared/tui/ManagedTuiRuntime.js";
import type {
  admin_tui_message_kind,
  admin_tui_runtime,
  admin_tui_select_option,
  admin_tui_table_input,
} from "@/federation/types/AdminTui.js";

/**
 * 创建 admin TUI runtime。
 */
export function create_admin_tui_runtime(title = "Admin"): admin_tui_runtime {
  const runtime = new ManagedTuiRuntime({ title });

  return {
    close(): void {
      runtime.close();
    },

    async select_nav(nav_title: string, options: admin_tui_select_option[]): Promise<string | undefined> {
      return await runtime.select({
        title: nav_title,
        footer: "Enter 选择 · Esc 返回 · ↑↓ 切换",
        options,
        show_detail: true,
      });
    },

    async select(section_title: string, options: admin_tui_select_option[]): Promise<string | undefined> {
      return await runtime.select({
        title: section_title,
        footer: "Enter 选择 · Esc 返回 · ↑↓ 切换",
        options,
        show_detail: true,
      });
    },

    async text(section_title: string, placeholder?: string): Promise<string | undefined> {
      return await runtime.text({
        title: section_title,
        placeholder,
      });
    },

    async password(section_title: string, placeholder?: string): Promise<string | undefined> {
      return await runtime.text({
        title: section_title,
        placeholder,
        password: true,
      });
    },

    async with_loading<T>(section_title: string, task: () => Promise<T>): Promise<T> {
      return await runtime.with_loading(section_title, task);
    },

    async show_text(section_title: string, content: string): Promise<void> {
      await runtime.show_text(section_title, content);
    },

    async show_table(input: admin_tui_table_input): Promise<void> {
      await runtime.show_table(input);
    },

    async show_json(section_title: string, data: unknown): Promise<void> {
      await runtime.show_json(section_title, data);
    },

    async show_message(kind: admin_tui_message_kind, message: string): Promise<void> {
      await runtime.show_message(kind, message);
    },
  };
}
