/**
 * Agent runtime 的 City 入口。
 *
 * City 与 Agent 同属一个运行时领域，用户从 `@downcity/agent` 统一导入二者。
 * 当前 City 的 transport 实现仍位于独立源码目录，后续可在不改变公开入口的前提下继续收拢。
 */
export * from "@downcity/city";
