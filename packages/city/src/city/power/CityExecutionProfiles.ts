/**
 * City 持有的可信执行配置注册表。
 * 配置跟随 Power 生命周期，自动装配到现有及后来加入的 Agent；删除后撤销执行能力。
 */
import type { Agent, SessionExecutionProfile } from "@downcity/agent";

/** City 级执行配置与 Agent 注册资源的唯一所有者。 */
export class CityExecutionProfiles {
  private readonly profiles = new Map<string, {
    /** 注册配置的 Power，防止其他 Power 选择该配置。 */
    power_id: string;
    /** 可信配置实现。 */
    profile: SessionExecutionProfile;
    /** 各 Agent 注册项的撤销函数。 */
    releases: Map<Agent, () => void>;
  }>();

  /** 注册精确版本，同一 City 内标识和版本不得重复。 */
  register(power_id: string, profile: SessionExecutionProfile, agents: readonly Agent[]): () => void {
    const key = `${profile.id}@${profile.version}`;
    if (this.profiles.has(key)) throw new Error(`execution_profile_duplicate: ${key}`);
    const entry = { power_id, profile, releases: new Map<Agent, () => void>() };
    this.profiles.set(key, entry);
    try { for (const agent of agents) this.attach_agent(agent); }
    catch (error) { this.release(key); throw error; }
    return () => { if (this.profiles.get(key) === entry) this.release(key); };
  }

  /** 新 Agent 绑定前接收所有当前注册配置，恢复专用会话无需先创建另一条。 */
  attach_agent(agent: Agent): void {
    for (const entry of this.profiles.values()) {
      if (!entry.releases.has(agent)) entry.releases.set(agent, agent.sessions.register_execution_profile(entry.profile));
    }
  }

  /** 配置选择也受 Power 所有权约束，不能借用其他 Power 的闭包能力。 */
  assert_owner(power_id: string, id: string, version: number): void {
    if (this.profiles.get(`${id}@${version}`)?.power_id !== power_id) {
      throw new Error(`execution_profile_unavailable: ${id}@${version}`);
    }
  }

  /** Power 退出时收回所有注册配置。 */
  release_power(power_id: string): void {
    for (const [key, entry] of this.profiles) if (entry.power_id === power_id) this.release(key);
  }

  /** 释放一个配置在全部 Agent 上的注册项。 */
  private release(key: string): void {
    const entry = this.profiles.get(key);
    this.profiles.delete(key);
    for (const release of entry?.releases.values() ?? []) release();
  }
}
