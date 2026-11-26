/** 核心记忆的 system 快照标识与逐轮更正；基线始终取自冻结块，不由进程内缓存推断。 */
import type { SessionSystemBlock, SessionHookContextBlock } from "@downcity/type";
import type { MemoryProfile } from "./MemoryAgreementProjection.js";
import type { ProfileScope } from "../types/Profile.js";

/** 向 system 快照加入明确版本，保留在恢复后的原始块内容中。 */
export function mark_profile_snapshot(block: SessionHookContextBlock): string {
  return `<!-- memory-profile-version:${block.version ?? "unknown"} -->\n${block.content}`;
}

/** 对冻结快照中的 User/Agent 版本生成本轮最新有效内容，缺失版本也会显式核对。 */
export async function build_profile_updates(
  profile: MemoryProfile,
  agent_id: string,
  system_blocks: readonly SessionSystemBlock[],
): Promise<SessionHookContextBlock[]> {
  const scopes: ProfileScope[] = [{ scope: "user" }, { scope: "agent", agent_id }];
  const updates: SessionHookContextBlock[] = [];
  for (const scope of scopes) {
    const frozen = system_blocks.find((item) => item.name === `memory/core/${scope.scope}`);
    const current = await profile.context_block(scope);
    const previous_version = frozen?.content.match(/<!-- memory-profile-version:([a-f0-9]{64}) -->/u)?.[1];
    if (current.version === previous_version) continue;
    const baseline_ids = frozen?.content.match(/<!-- memory-records:(.*?) -->/u)?.[1] ?? "unknown";
    updates.push({ ...current, checkpoint_block: { source: "power", name: `memory/${current.name}`, content: mark_profile_snapshot(current), position: scope.scope === "agent" ? "after_instruction" : "before_session" }, name: `memory/update/${scope.scope}`,
      content: `Replace the frozen ${scope.scope} Agreement projection in full. Retire its previous ID/version bindings: ${baseline_ids}. Only the following complete set is current.\n${current.content}` });
  }
  return updates;
}
