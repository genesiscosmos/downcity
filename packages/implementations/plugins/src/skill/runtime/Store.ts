/**
 * Session skills state store（skill plugin 内部状态）。
 *
 * 关键点（中文）
 * - 这是 skill 子系统的运行时状态容器
 * - core 不负责也不感知 skill/memory 业务状态
 */

import type { SkillDefinition } from "@/skill/types/SkillDefinition.js";
import type {
  SessionSkillStateInternal,
  SessionSkillStateSnapshot,
} from "./Types.js";

const sessionSkillStateStore = new Map<string, SessionSkillStateInternal>();

/**
 * 归一化 session_id。
 *
 * 关键点（中文）
 * - 空 session_id 视为调用错误，直接抛异常，避免污染全局状态。
 */
function normalizeSessionId(session_id: string): string {
  const value = String(session_id || "").trim();
  if (!value) {
    throw new Error("session_id is required for session skills state");
  }
  return value;
}

/**
 * 获取或创建 session 技能状态。
 */
function getOrCreateState(session_id: string): SessionSkillStateInternal {
  const key = normalizeSessionId(session_id);
  const existing = sessionSkillStateStore.get(key);
  if (existing) return existing;

  const created: SessionSkillStateInternal = {
    allSkillsById: new Map(),
    updated_at: Date.now(),
  };
  sessionSkillStateStore.set(key, created);
  return created;
}

/**
 * 设置会话可用技能集合。
 *
 * 算法（中文）
 * - 以 id 归一化后整体替换，避免残留脏状态。
 */
export function setSessionAvailableSkills(
  session_id: string,
  skills: SkillDefinition[],
): void {
  const state = getOrCreateState(session_id);
  const next = new Map<string, SkillDefinition>();

  for (const skill of Array.isArray(skills) ? skills : []) {
    const id = String(skill?.id || "").trim();
    if (!id) continue;
    next.set(id, skill);
  }

  state.allSkillsById = next;
  state.updated_at = Date.now();
}

/**
 * 获取会话技能状态快照。
 */
export function getSessionSkillState(session_id: string): SessionSkillStateSnapshot {
  const key = normalizeSessionId(session_id);
  const state = sessionSkillStateStore.get(key);

  if (!state) {
    return {
      session_id: key,
      allSkills: [],
      updated_at: 0,
    };
  }

  return {
    session_id: key,
    allSkills: Array.from(state.allSkillsById.values()),
    updated_at: state.updated_at,
  };
}

/**
 * 清理会话技能状态。
 */
export function clearSessionSkillState(session_id: string): void {
  const key = normalizeSessionId(session_id);
  sessionSkillStateStore.delete(key);
}
