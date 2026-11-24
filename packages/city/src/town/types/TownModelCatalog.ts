/**
 * Town 模型目录的运行时缓存事实。连接对象标识隔离注册代次和授权主体；
 * 独立请求控制器允许多个调用方共享网络读取，同时分别取消自己的等待。
 */
import type { TownModelEntry } from "./TownModels.js";

/** 同一来源共享的一次目录读取；持有来源租约直到网络读取真正结束。 */
export interface TownModelCatalogRequest {
  /** 仅在最后一个等待者取消时中止底层目录请求，不借用任一调用方的信号。 */
  controller: AbortController;
  /** 包含目录校验、缓存提交和来源租约释放的共同结果。 */
  promise: Promise<TownModelEntry[]>;
  /** 尚未收到结果或取消的调用方数量。 */
  waiters: number;
}

/** 单个不可变连接代次的短期目录；失败不产生可使用的新快照。 */
export interface TownModelCatalogState {
  /** 防御性核对授权主体；与连接对象身份共同界定缓存归属。 */
  auth_scope_id: string;
  /** 最近一次成功读取的完整目录，不向调用方直接暴露可变引用。 */
  items: TownModelEntry[];
  /** 基于单调时钟的到期时间；零表示没有可使用的快照。 */
  expires_at: number;
  /** 普通读取和显式刷新共同等待的唯一来源请求。 */
  pending?: TownModelCatalogRequest;
}
