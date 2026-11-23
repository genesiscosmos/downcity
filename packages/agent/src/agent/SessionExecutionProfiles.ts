/**
 * 宿主执行配置注册表与精确恢复校验。
 * 注册项只由可信宿主传入，缺失配置、版本或模型均拒绝运行。
 */
import { same_model } from "@downcity/type";
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

  /** 创建或恢复时解析完整资源；恢复必须保持实际模型身份。 */
  async resolve(
    selection: SessionExecutionProfileSelection,
    context: SessionExecutionProfileContext,
    persisted?: SessionExecutionProfileReference,
  ): Promise<ResolvedSessionExecutionProfile> {
    const profile = this.profiles.get(this.key(selection.execution_profile_id, selection.execution_profile_version));
    if (!profile) throw new Error(`execution_profile_unavailable: ${selection.execution_profile_id}@${selection.execution_profile_version}`);
    const creation_key = persisted ? persisted.creation_key : selection.creation_key;
    const resources = await profile.resolve({ ...context, creation_key,
      model_id: persisted?.model_id ?? selection.model_id,
      model_reference: persisted?.model_reference ?? selection.model_reference,
      binding_id: persisted ? persisted.binding_id : selection.binding_id });
    const model_id = resources.model?.id;
    if (!model_id?.trim()) throw new Error("execution_profile_model_missing: actual model identity required");
    const binding_id = resources.model.binding_id;
    if (binding_id !== undefined && (typeof binding_id !== "string" || !binding_id.trim())) {
      throw new Error("execution_profile_binding_invalid: opaque non-empty binding required");
    }
    if ((persisted || selection.binding_id !== undefined)
      && binding_id !== (persisted ? persisted.binding_id : selection.binding_id)) {
      throw Object.assign(new Error("Execution profile model authorization requires explicit confirmation"), { code: "session_model_binding_changed" });
    }
    if (!persisted && selection.model_reference && !same_model(resources.model.model_reference, selection.model_reference)) throw new Error("execution_profile_model_changed: selected model source must be preserved");
    if (persisted && (model_id !== persisted.model_id || !same_model(resources.model.model_reference, persisted.model_reference))) throw new Error("execution_profile_model_changed: restore requires the persisted model");
    if (!resources.composer || !Array.isArray(resources.instruction) || !resources.tools || !resources.hooks) {
      throw new Error("execution_profile_resources_invalid: instruction, composer, tools and hooks required");
    }
    return {
      reference: {
        id: profile.id,
        version: profile.version,
        model_id,
        ...(resources.model.model_reference ? { model_reference: resources.model.model_reference } : {}),
        ...(binding_id !== undefined ? { binding_id } : {}),
        ...(creation_key ? { creation_key } : {}),
      },
      resources,
    };
  }

  /** 配置版本键不依赖业务来源。 */
  private key(id: string, version: number): string { return `${id}@${version}`; }
}
