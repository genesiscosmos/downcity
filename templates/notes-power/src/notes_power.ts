/** Notes 后端：一个 City 内的唯一实例，与各宿主 Renderer 共享业务契约。 */
import { Power, type PowerLifecycleContext } from "@downcity/city/power";
import type { NotesListResult } from "../shared/notes_contract.js";

/** 只读演示数据；真实应用应在所属 Power 的存储中管理用户数据。 */
export class NotesPower extends Power {
  /** 项目内稳定名称，扩展宿主为它分配全局命名空间。 */
  readonly name = "notes";
  /** 用户看到的标题。 */
  readonly title = "Notes";
  /** 本演示的业务用途。 */
  readonly description = "Browse a small set of notes.";
  /** 各协议静态入口，后端不会导入这些模块。 */
  readonly renderers = {
    "downcity.desktop.react.v1": {
      entry: "./ui/desktop/renderer.tsx",
      capabilities: { page: true, config: false },
    },
    // 示例协议尚无 Downcity 适配器，仅保留声明，不编译或执行。
    "acme.web.react.v1": {
      entry: "./ui/acme_web/renderer.ts",
      capabilities: { page: true, settings: false },
    },
  };

  /** 为宿主界面登记业务动作；多入口不会重复调用 initialize。 */
  initialize({ power }: PowerLifecycleContext): void {
    power.action({ id: "notes.list", run: () => {
      const result: NotesListResult = { notes: [{ note_id: "welcome", title: "Welcome" }] };
      return { notes: result.notes.map((note) => ({ ...note })) };
    } });
  }
}
