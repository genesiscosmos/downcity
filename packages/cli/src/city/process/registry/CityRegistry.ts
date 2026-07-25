/**
 * CityAgentProjectStore：City 维护的 agent 项目索引。
 *
 * 关键点（中文）
 * - 全局 agent 列表进入 `downcity.db` 的加密 secure setting，不再写 `agents.json`。
 * - 这里只保存 project_root 列表；运行状态统一由项目 daemon pid/meta 推导。
 * - 保留旧导出函数名，降低上层命令改造面积。
 */

import fs from "fs-extra";
import path from "node:path";
import type {
  ManagedAgentRegistryEntry,
  ManagedAgentRegistryV1,
} from "@/city/types/runtime/Platform.js";
import { createCityPlatformStore } from "@/city/runtime/store/index.js";
import { getCityRuntimeDirPath } from "@/city/process/registry/CityPaths.js";
import {
  DAEMON_META_FILENAME,
  DAEMON_PID_FILENAME,
  type DaemonMeta,
} from "@/city/process/daemon/Types.js";
import { getDowncityDebugDirPath } from "@/city/config/Paths.js";

const CITY_AGENT_PROJECTS_KEY = "city.agent.projects";
const LEGACY_MANAGED_AGENTS_FILE = path.join(getCityRuntimeDirPath(), "agents.json");

interface CityAgentProjectsState {
  /** 状态版本。 */
  v: 1;
  /** 最近更新时间（ISO 字符串）。 */
  updated_at: string;
  /** 已登记 agent 项目绝对路径列表。 */
  projectRoots: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildEmptyState(): CityAgentProjectsState {
  return {
    v: 1,
    updated_at: nowIso(),
    projectRoots: [],
  };
}

function normalizeProjectRoot(project_root: string): string {
  const resolved = path.resolve(String(project_root || "").trim());
  if (!resolved) throw new Error("project_root is required");
  return resolved;
}

function normalizeIsoTime(input: string | undefined): string {
  const value = String(input || "").trim();
  if (!value) return nowIso();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return nowIso();
  return new Date(ms).toISOString();
}

function getDaemonPidPath(project_root: string): string {
  return path.join(getDowncityDebugDirPath(project_root), DAEMON_PID_FILENAME);
}

function getDaemonMetaPath(project_root: string): string {
  return path.join(getDowncityDebugDirPath(project_root), DAEMON_META_FILENAME);
}

async function readDaemonPid(project_root: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(getDaemonPidPath(project_root), "utf-8");
    const pid = Number.parseInt(String(raw).trim(), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readDaemonMeta(project_root: string): Promise<DaemonMeta | null> {
  try {
    const value = await fs.readJson(getDaemonMetaPath(project_root));
    const pid = Number((value as { pid?: unknown })?.pid);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    const startedAt = String((value as { startedAt?: unknown })?.startedAt || "").trim();
    if (!startedAt) return null;
    const command = String((value as { command?: unknown })?.command || "").trim();
    const project = String((value as { project_root?: unknown })?.project_root || "").trim();
    const instance_id = String((value as { instanceId?: unknown })?.instanceId || "").trim();
    if (!command || !project || !instance_id) return null;
    return value as DaemonMeta;
  } catch {
    return null;
  }
}

function normalizeState(value: Partial<CityAgentProjectsState> | null | undefined): CityAgentProjectsState {
  if (!value || typeof value !== "object") return buildEmptyState();
  const projectRoots = Array.isArray(value.projectRoots)
    ? value.projectRoots
        .map((item) => {
          try {
            return normalizeProjectRoot(String(item || ""));
          } catch {
            return "";
          }
        })
        .filter(Boolean)
    : [];
  return {
    v: 1,
    updated_at: normalizeIsoTime(value.updated_at),
    projectRoots: [...new Set(projectRoots)].sort((a, b) => a.localeCompare(b)),
  };
}

function readDbState(): CityAgentProjectsState | null {
  const store = createCityPlatformStore();
  try {
    return store.getSecureSettingJsonSync<CityAgentProjectsState>(CITY_AGENT_PROJECTS_KEY);
  } finally {
    store.close();
  }
}

function writeDbState(state: CityAgentProjectsState): void {
  const store = createCityPlatformStore();
  try {
    store.setSecureSettingJsonSync(CITY_AGENT_PROJECTS_KEY, normalizeState(state));
  } finally {
    store.close();
  }
}

async function readLegacyProjectRoots(): Promise<string[]> {
  try {
    if (!(await fs.pathExists(LEGACY_MANAGED_AGENTS_FILE))) return [];
    const raw = (await fs.readJson(LEGACY_MANAGED_AGENTS_FILE)) as Partial<ManagedAgentRegistryV1>;
    const agents = Array.isArray(raw.agents) ? raw.agents : [];
    return agents
      .map((entry) => {
        try {
          return normalizeProjectRoot(String(entry?.project_root || ""));
        } catch {
          return "";
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function readProjectState(): Promise<CityAgentProjectsState> {
  const stored = readDbState();
  if (stored) return normalizeState(stored);

  const legacyProjectRoots = await readLegacyProjectRoots();
  const migrated = normalizeState({
    v: 1,
    updated_at: nowIso(),
    projectRoots: legacyProjectRoots,
  });
  writeDbState(migrated);
  return migrated;
}

async function writeProjectState(state: CityAgentProjectsState): Promise<void> {
  writeDbState({
    ...normalizeState(state),
    updated_at: nowIso(),
  });
}

async function buildEntry(project_root_input: string): Promise<ManagedAgentRegistryEntry> {
  const project_root = normalizeProjectRoot(project_root_input);
  const daemon_pid = await readDaemonPid(project_root);
  const meta = await readDaemonMeta(project_root);
  const running = Boolean(
    daemon_pid
    && meta
    && meta.pid === daemon_pid
    && normalizeProjectRoot(meta.project_root) === project_root
    && meta.instanceId
    && isProcessAlive(daemon_pid),
  );
  return {
    project_root: project_root,
    pid: daemon_pid ?? meta?.pid ?? 0,
    startedAt: normalizeIsoTime(meta?.startedAt),
    updated_at: normalizeIsoTime(meta?.startedAt),
    status: running ? "running" : "stopped",
    stoppedAt: running ? undefined : nowIso(),
  };
}

/**
 * 确保 agent 项目索引已初始化。
 */
export async function ensureManagedAgentRegistry(): Promise<void> {
  await readProjectState();
}

/**
 * 获取旧 registry 文件路径。
 *
 * 关键点（中文）
 * - 仅用于诊断或迁移提示；当前版本不会再写这个文件。
 */
export function getManagedAgentsRegistryPath(): string {
  return LEGACY_MANAGED_AGENTS_FILE;
}

/**
 * 读取 agent 项目索引的兼容视图。
 */
export async function readManagedAgentRegistry(): Promise<ManagedAgentRegistryV1> {
  const state = await readProjectState();
  const agents: ManagedAgentRegistryEntry[] = [];
  for (const project_root of state.projectRoots) {
    agents.push(await buildEntry(project_root));
  }
  return {
    v: 1,
    updated_at: state.updated_at,
    agents,
  };
}

/**
 * 列出 City 已登记 agent。
 */
export async function listManagedAgentEntries(): Promise<ManagedAgentRegistryEntry[]> {
  const registry = await readManagedAgentRegistry();
  return registry.agents.sort((a, b) => a.project_root.localeCompare(b.project_root));
}

/**
 * 登记或刷新 agent 项目。
 */
export async function upsertManagedAgentEntry(input: {
  project_root: string;
  pid?: number;
  startedAt?: string;
  status?: "running" | "stopped";
  stoppedAt?: string;
}): Promise<void> {
  const project_root = normalizeProjectRoot(input.project_root);
  const state = await readProjectState();
  if (!state.projectRoots.includes(project_root)) {
    state.projectRoots.push(project_root);
  }
  await writeProjectState(state);
}

/**
 * 标记 agent 停止。
 *
 * 关键点（中文）
 * - 当前状态只由 daemon pid/meta 推导，所以这里不写 stopped 状态，只保证项目仍在索引中。
 */
export async function markManagedAgentStopped(project_root: string): Promise<void> {
  await upsertManagedAgentEntry({ project_root, status: "stopped" });
}

/**
 * 从 agent 项目索引中移除项目。
 */
export async function removeManagedAgentEntry(project_root: string): Promise<void> {
  const key = normalizeProjectRoot(project_root);
  const state = await readProjectState();
  const nextProjectRoots = state.projectRoots.filter((item) => item !== key);
  if (nextProjectRoots.length === state.projectRoots.length) return;
  await writeProjectState({
    ...state,
    projectRoots: nextProjectRoots,
  });
}
