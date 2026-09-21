/**
 * City 跨包最小运行协议。
 *
 * City 是 Agent 的可选组合根。Agent 与 Group 只依赖这份能力投影，不依赖具体 City
 * package，也不理解 Power、Transport 或其他 City 内部实现。
 *
 * 关键点（中文）
 * - 这是「环境句柄」：主体在绑定时收下它，之后只读，不向容器索取、不反向通知。
 * - 环境是活的：容器可以在运行期增删 Power，主体读到的始终是当前值，不需要失效通知。
 * - 不含 Workspace 查询：Workspace 由调用方在 `sessions.create({ workspace })` 时
 *   显式传入，主体不回查容器；归属校验属于容器边界职责。
 */

import type { AgentTool, ToolHookSet } from "../tool/index.js";
import type { StorageProvider } from "../storage/Storage.js";

/** 容器当前生效的 Power 能力产物。 */
export interface PowerSurface {
  /** 当前 Power 工具集合，键为 power 名。 */
  readonly tools: Readonly<Record<string, AgentTool>>;

  /** 当前 Power 检查点处理器集合。 */
  readonly hooks: ToolHookSet;
}

/** 主体加入容器后可以使用的容器运行环境。 */
export interface CityRuntime {
  /** 容器为主体私有运行数据提供的底层存储。 */
  readonly storage: StorageProvider;

  /** 容器当前生效的 Power 工具集合，键为 power 名；主体只读，不缓存。 */
  readonly power_tools: Readonly<Record<string, AgentTool>>;

  /** 容器当前生效的 Power 检查点处理器；主体只读，不缓存。 */
  readonly power_hooks: ToolHookSet;
}
