/**
 * Desktop 界面语言类型。
 *
 * 语言值属于用户级设置，并由主进程负责校验与持久化；Renderer 只消费标准化结果。
 */

/** Desktop 当前支持的界面语言。 */
export type DesktopLanguage = "en" | "zh";
