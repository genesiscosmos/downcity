/**
 * City 跨包最小运行协议。
 *
 * City 是 Agent 的可选组合根。Agent 只依赖这份能力投影，不依赖具体 City package，
 * 也不理解 Power、Transport 或其他 City 内部实现。
 *
 * 关键点（中文）
 * - 这里只描述 Agent 需要「向 City 取用」的能力。
 * - 反向推送（City 把编译后的 Power 产物交给 Agent）不需要进入本协议：City 持有
 *   Agent 实例，直接调用 Agent 的公开方法即可。
 */

import type { StorageProvider } from "../storage/Storage.js";
import type { WorkspaceRuntime } from "../workspace/WorkspaceRuntime.js";

/** Agent 加入 City 后可以使用的最小 City 运行能力。 */
export interface CityRuntime {
  /** City 为 Agent 私有运行数据提供的底层存储。 */
  readonly storage: StorageProvider;

  /** City 当前持有的 Workspace 查询入口。 */
  readonly workspaces: {
    /** 按稳定 ID 读取 Workspace；不存在或正在移除时返回 null。 */
    get(workspace_id: string): WorkspaceRuntime | null;
  };

  /** Agent 主动释放时清除 City 持有的运行时引用。 */
  release_agent(agent: {
    /** Agent 的全局稳定标识。 */
    readonly id: string;
  }): Promise<void>;
}
