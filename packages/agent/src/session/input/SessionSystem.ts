/**
 * SDK Session 默认 system block 组装逻辑。
 *
 * 关键点（中文）
 * - 面向 `Agent` SDK 的本地会话执行场景。
 * - 注入调用方显式传入的静态 instruction 与 Power system blocks。
 * - SDK 不在 system 中注入动态变量；动态上下文应由调用方放入 user message。
 */

import type {
  AgentSessionSystemBlock,
  AgentSessionSystemSessionInfo,
} from "@/types/agent/SessionTypes.js";
import type {
  BuildSessionSystemBlocksInput,
  ResolveSessionPowerSystemBlocksInput,
} from "@/types/session/SessionSystem.js";
import type { JsonValue, SessionSystemContextHookValue } from "@downcity/type";
import { SESSION_HOOK_POINTS } from "@/session/input/SessionHookPoints.js";

function normalize_system_blocks(
  blocks: AgentSessionSystemBlock[],
): AgentSessionSystemBlock[] {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .map((block): AgentSessionSystemBlock | null => {
      const content = String(block?.content || "").trim();
      if (!content) return null;
      const source = block.source;
      if (
        source !== "core" &&
        source !== "instruction" &&
        source !== "power" &&
        source !== "session"
      ) {
        return null;
      }
      return {
        source,
        name: String(block.name || source).trim() || source,
        content,
      } satisfies AgentSessionSystemBlock;
    })
    .filter((block): block is AgentSessionSystemBlock => Boolean(block));
}

/** 把 system pipeline 输出限制为稳定的 Power 命名内容块。 */
export function normalize_power_system_blocks(
  input: unknown,
): AgentSessionSystemBlock[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const name = String(record.name || "").trim();
    const content = String(record.content || "").trim();
    if (!name || !content) return [];
    return [{ source: "power" as const, name, content }];
  });
}

/** 使用统一 Hook 检查点解析当前 Session 的 Power system blocks。 */
export async function resolve_session_power_system_blocks(
  input: ResolveSessionPowerSystemBlocksInput,
): Promise<AgentSessionSystemBlock[]> {
  let blocks: AgentSessionSystemBlock[];
  try {
    blocks = normalize_power_system_blocks(
      await input.hooks.system_blocks(input.context),
    );
  } catch (error) {
    await input.on_error?.(error);
    return [];
  }
  const value: SessionSystemContextHookValue = {
    session_id: input.session_id,
    ...(input.turn_id ? { turn_id: input.turn_id } : {}),
    blocks,
  };
  try {
    const output = await input.hooks.pipeline(
      SESSION_HOOK_POINTS.system_context,
      value as unknown as JsonValue,
    ) as unknown as SessionSystemContextHookValue;
    return normalize_power_system_blocks(output?.blocks);
  } catch (error) {
    await input.on_error?.(error);
    return blocks;
  }
}

function create_session_info(
  input: Pick<
    BuildSessionSystemBlocksInput,
    "agent_id" | "session_id" | "project_root" | "created_at" | "timezone"
  >,
): AgentSessionSystemSessionInfo {
  const created_at = Number.isFinite(input.created_at) ? input.created_at : 0;
  return {
    agent_id: String(input.agent_id || "").trim(),
    session_id: String(input.session_id || "").trim(),
    project_root: String(input.project_root || "").trim(),
    created_at: new Date(created_at).toISOString(),
    timezone: String(input.timezone || "").trim() || "UTC",
  };
}

function create_session_system_block(
  session: AgentSessionSystemSessionInfo,
): AgentSessionSystemBlock {
  const content = [
    "Current session context:",
    `This session is "${session.session_id}".`,
    `The current project root is "${session.project_root}".`,
    `This session was created at ${session.created_at}, with ${session.timezone} as its reference timezone.`,
    "This creation time is a stable reference for the session and does not represent the current time for every run.",
    "If the user message provides a newer current time, a relative time, or other dynamic context, prioritize the dynamic information from the user message.",
  ].join("\n");
  return {
    source: "session",
    name: "context",
    content,
  };
}

/**
 * 解析 SDK session 当前生效的 system blocks。
 */
export async function build_session_system_blocks(
  input: BuildSessionSystemBlocksInput,
): Promise<AgentSessionSystemBlock[]> {
  const agent_id = String(input.agent_id || "").trim();
  const project_root = String(input.project_root || "").trim();
  const session_id = String(input.session_id || "").trim();
  const created_at = Number(input.created_at || 0);
  const timezone = String(input.timezone || "").trim();
  if (!agent_id) {
    throw new Error("build_session_system_blocks requires a non-empty agent_id");
  }
  if (!project_root) {
    throw new Error("build_session_system_blocks requires a non-empty project_root");
  }
  if (!session_id) {
    throw new Error("build_session_system_blocks requires a non-empty session_id");
  }
  if (!Number.isFinite(created_at) || created_at <= 0) {
    throw new Error("build_session_system_blocks requires a valid created_at");
  }
  if (!timezone) {
    throw new Error("build_session_system_blocks requires a non-empty timezone");
  }
  return [
    ...normalize_system_blocks(input.get_instruction_system_blocks()),
    ...normalize_system_blocks(await input.get_managed_power_system_blocks()),
    ...normalize_system_blocks(await input.get_power_system_blocks()),
    // session block 放在最后，尽量保留前缀 system blocks 的跨 session 缓存命中。
    create_session_system_block(
      create_session_info({
        agent_id,
        project_root,
        session_id,
        created_at,
        timezone,
      }),
    ),
  ];
}
