/**
 * Prompt 模板变量类型。
 *
 * 关键点（中文）
 * - 统一描述 prompt template 支持的运行时变量结构。
 * - 供模板渲染与地理位置解析模块复用，避免隐式约定。
 */

export interface PromptGeoContext {
  /** 公网 IP；当外部服务不可用时回退为 `unknown`。 */
  ip: string;
  /** 地理解析后的地点描述，用于提示模型当前大致位置。 */
  location: string;
  /** IANA 时区标识，例如 `Asia/Shanghai`。 */
  timezone: string;
  /** 地理上下文来源。 */
  source: "ipapi" | "ipwhois" | "local";
}

export interface PromptVariables {
  /** 当前日期字符串，按当前时区格式化为 `YYYY-MM-DD`。 */
  currentDate: string;
  /** 当前时间字符串，包含日期、时分秒与时区信息。 */
  currentTime: string;
  /** 当前年份字符串，用于显式提示“现在是几几年”。 */
  currentYear: string;
  /** 当前运行时使用的 IANA 时区标识，例如 `Asia/Shanghai`。 */
  timezone: string;
  /** 当前地理位置描述。 */
  location: string;
  /** 当前项目路径。 */
  projectPath: string;
  /** 当前项目根路径。 */
  project_root: string;
  /** 当前会话标识。 */
  session_id: string;
}
