/**
 * Desktop 命令面板的对外入口。
 *
 * 只暴露两个挂载点：命令提供者（注册命令，不渲染内容）与面板本身。
 * 注册表、检索与键位格式化都是内部实现，不应被其它模块直接引用。
 */

export { CommandPalette } from "./CommandPalette.tsx";
export { CommandProviders } from "./CommandProviders.tsx";
export type { ShellCommandEnvironment } from "./types.ts";
