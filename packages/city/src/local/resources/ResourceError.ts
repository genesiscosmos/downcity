/** 本机资源用例的稳定错误与退出码；展示层与管理 transport 共用此协议。 */

/** 可跨本机管理通道传输的业务失败。 */
export class ResourceError extends Error {
  constructor(
    /** 稳定的机器错误码，不依赖异常文案。 */
    readonly code: string,
    message: string,
    /** CLI 退出码；SDK 调用方可以只使用 code。 */
    readonly exit_code: number,
    /** 重试前不需要修改输入的暂时性错误。 */
    readonly retryable = false,
    /** 已提交事实或目标地址，不得包含凭据或私密回答。 */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ResourceError";
  }
}

/** 保留稳定业务失败；未知异常不猜测其业务语义。 */
export function as_resource_error(error: unknown): ResourceError {
  if (error instanceof ResourceError) return error;
  if (error instanceof Error && "code" in error) {
    if (error.code === "EACCES" || error.code === "EPERM") return new ResourceError("permission_denied", "Resource access was denied", 6);
    if (error.code === "ENOENT") return new ResourceError("resource_not_found", "Requested resource or input file does not exist", 3);
    if (error.code === "host_identity_mismatch") return new ResourceError("host_identity_mismatch", error.message, 5);
  }
  return new ResourceError("internal_error", error instanceof Error ? error.message : "Resource operation failed", 1);
}

/** 对调用参数作统一校验。 */
export function require_resource_value(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ResourceError("validation_error", message, 2);
}

/** 资源地址必须使用完整 ID，禁止 repository 的有损规范化改变目标。 */
export function require_agent_id(agent_id: unknown): asserts agent_id is string {
  require_resource_value(typeof agent_id === "string" && /^[a-z0-9]+(?:_[a-z0-9]+)*$/u.test(agent_id), "A complete Agent ID is required ([a-z0-9]+ separated by underscores)");
}

/** 校验完整 Workspace ID；内部目录不属于普通项目管理范围。 */
export function require_workspace_id(workspace_id: unknown, allow_internal = false): asserts workspace_id is string {
  require_resource_value(typeof workspace_id === "string" && /^[a-z0-9][a-z0-9_:-]*$/u.test(workspace_id), "A complete Workspace ID is required");
  if (!allow_internal && workspace_id.startsWith("agent-main:")) {
    throw new ResourceError("dependency_conflict", "Agent-private Workspace cannot be managed as a project", 4);
  }
}

/** 识别文件不存在，不把权限或 I/O 失败伪装成空列表。 */
export function is_missing_file(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
