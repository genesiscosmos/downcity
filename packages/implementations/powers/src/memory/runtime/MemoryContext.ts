/** 核心记忆的 system 快照标识与逐轮更正；基线始终取自冻结块，不由进程内缓存推断。 */
import { createHash } from "node:crypto";
import type { SessionSystemBlock, SessionHookContextBlock } from "@downcity/type";
import type { MemoryProfile } from "./MemoryProfile.js";
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
  const scopes: ProfileScope[] = [{ target: "user" }, { target: "agent", agent_id }];
  const snapshots = scopes.map((scope) => {
    const block = system_blocks.find((item) => item.name === `memory/core/${scope.target}`);
    const version = block
      ? block.content.match(/<!-- memory-profile-version:([a-f0-9]{64}) -->/u)?.[1]
      : createHash("sha256").update("").digest("hex");
    return { scope, version };
  });
  return (await profile.context_updates(snapshots)).blocks;
}
