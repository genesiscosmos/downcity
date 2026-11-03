/**
 * Memory Power 自有的 Session 业务类型。
 *
 * 该类型只标记记忆处理用途；创建时显式声明 work 分类，执行资源由可信配置提供，
 * 工具调用还需通过当前 Job 与实际 Session 身份校验。
 */

/** Memory Power 创建和识别专用处理会话时使用的业务类型，不授予执行能力。 */
export const MEMORY_SESSION_KIND = "memory";
