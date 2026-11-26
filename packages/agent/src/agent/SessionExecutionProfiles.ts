/**
 * 宿主执行配置注册表与精确恢复校验。
 * 注册项只由可信宿主传入，缺失配置或版本时拒绝运行。
 */
import type { ResolvedSessionExecutionProfile, SessionExecutionProfile, SessionExecutionProfileContext, SessionExecutionProfileReference, SessionExecutionProfileSelection } from "@/types/agent/SessionExecutionProfile.js";

/** Agent 持有的可信配置注册表，不暴露为模型工具。 */
export class SessionExecutionProfiles {
  private readonly profiles = new Map<string, SessionExecutionProfile>();

  /** 注册精确版本；返回撤销函数，撤销后已有句柄也必须停止接受执行。 */
  register(profile: SessionExecutionProfile): () => void {
    if (!profile.id.trim() || profile.id !== profile.id.trim()
      || !Number.isSafeInteger(profile.version) || profile.version < 1) {
      throw new Error("execution_profile_invalid: non-empty id and positive version required");
    }
    const key = this.key(profile.id, profile.version);
    const existing = this.profiles.get(key);
    if (existing && existing !== profile) throw new Error(`execution_profile_duplicate: ${key}`);
    this.profiles.set(key, profile);
    return () => { if (this.profiles.get(key) === profile) this.profiles.delete(key); };
  }

  /** 校验缓存 Session 的执行配置仍可用，不能在撤销后继续运行旧闭包。 */
  assert_registered(reference: SessionExecutionProfileReference): void {
    if (!this.profiles.has(this.key(reference.id, reference.version))) {
      throw new Error(`execution_profile_unavailable: ${reference.id}@${reference.version}`);
    }
  }

  /** 创建或恢复时解析能力和限制，不参与 Agent 模型定义。 */
  async resolve(
    selection: SessionExecutionProfileSelection,
    context: SessionExecutionProfileContext,
    persisted?: SessionExecutionProfileReference,
  ): Promise<ResolvedSessionExecutionProfile> {
    const profile = this.profiles.get(this.key(selection.execution_profile_id, selection.execution_profile_version));
    if (!profile) throw new Error(`execution_profile_unavailable: ${selection.execution_profile_id}@${selection.execution_profile_version}`);
    const creation_key = persisted ? persisted.creation_key : selection.creation_key;
    const resources = await profile.resolve({ ...context, creation_key });
    if ("model" in resources) throw new Error("agent_model_owned: execution profiles cannot provide a model");
    if (resources.instruction !== undefined && !Array.isArray(resources.instruction)) {
      throw new Error("execution_profile_resources_invalid: instruction must be an array");
    }
    return {
      reference: {
        id: profile.id,
        version: profile.version,
        ...(creation_key ? { creation_key } : {}),
      },
      resources,
    };
  }

  /** 配置版本键不依赖业务来源。 */
  private key(id: string, version: number): string { return `${id}@${version}`; }
}
