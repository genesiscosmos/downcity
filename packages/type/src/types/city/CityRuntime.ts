/**
 * City 跨包最小运行协议。
 *
 * City 是 Agent 的可选组合根。Agent 与 Group 只依赖这份能力投影，不依赖具体 City
 * package，也不理解 Power、Transport 或其他 City 内部实现。
 *
 * 关键点（中文）
 * - 这里只描述主体需要「向容器取用」的能力。
 * - 不含任何反向通知：生命周期由容器单方拥有，容器先放下引用，再让主体释放自身。
 * - 不含 Workspace 查询：Workspace 由调用方在 `sessions.create({ workspace })` 时
 *   显式传入，主体不回查容器；归属校验属于容器边界职责。
 * - 反向推送（容器把编译后的能力产物交给主体）不需要进入本协议：容器持有主体实例，
 *   直接调用主体的公开方法即可。
 */

import type { StorageProvider } from "../storage/Storage.js";

/** 主体加入容器后可以使用的最小容器运行能力。 */
export interface CityRuntime {
  /** 容器为主体私有运行数据提供的底层存储。 */
  readonly storage: StorageProvider;
}
