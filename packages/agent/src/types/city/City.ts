/**
 * City 生命周期类型。
 *
 * City 是一个 Store 下持久化 Agent 的运行时集合。查询方法返回可直接使用的 Agent，
 * 不向调用方暴露数据库记录或运行时装配细节。
 */

/** City 当前生命周期阶段。 */
export type CityState = "idle" | "loading" | "ready" | "disposed";
