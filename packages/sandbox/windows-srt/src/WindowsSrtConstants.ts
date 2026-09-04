/**
 * Downcity Windows SRT 安全域常量。
 *
 * 关键点（中文）：独立用户、WFP sublayer 与代理端口避免干扰 Claude Code 或其他 SRT consumer。
 */

/** Downcity 默认使用的专属 Windows sandbox 用户。 */
export const WINDOWS_SRT_DEFAULT_USER = "downcity-sandbox";

/** Downcity 专属 WFP sublayer GUID。 */
export const WINDOWS_SRT_DEFAULT_SUBLAYER_GUID = "ae4bc767-3f5a-4ea7-9488-1de4b9a74278";

/** Downcity SRT 本地过滤代理默认端口范围。 */
export const WINDOWS_SRT_DEFAULT_PROXY_PORT_RANGE = [60180, 60189] as const;

/** Windows SRT adapter 稳定后端标识。 */
export const WINDOWS_SRT_BACKEND = "windows-srt-alpha";
