/**
 * Session Turn 结构化文件修改的 Diff 构建器。
 *
 * 关键点（中文）
 * - 从当前 Turn 的通用 Tool effects 中只选择 Workspace 文件修改事实。
 * - 不读取 Turn 结束时的实时工作树，因此 Shell 和外部进程不会被反向归属。
 * - 同一文件的修改状态无法连续证明时直接忽略，避免把外部插入的内容伪装成本轮修改。
 */

import path from "node:path";
import {
  FILE_HEADERS_ONLY,
  formatPatch,
  structuredPatch,
} from "diff";
import type { RuntimeToolEffect } from "@downcity/type";
import {
  WORKSPACE_FILE_MUTATION_EFFECT_TYPE,
  type WorkspaceFileMutation,
  type WorkspaceFileMutationState,
} from "@downcity/type";
import type {
  SessionTurnFileDiff,
  SessionTurnFileDiffData,
  SessionTurnFileDiffStatus,
} from "@/types/session/SessionTurnFileDiff.js";

interface CollectedFileMutation {
  /** 相对于当前 Workspace 根目录的规范化路径。 */
  file: string;
  /** 当前 Turn 第一次结构化修改前的文件状态。 */
  before: WorkspaceFileMutationState;
  /** 当前 Turn 最后一次连续结构化修改后的文件状态。 */
  after: WorkspaceFileMutationState;
  /** 前后修改链是否被其他写入打断。 */
  conflicted: boolean;
}

/** 把当前 Turn effects 中的结构化文件修改收敛为可持久化 Diff。 */
export function build_session_turn_file_diff(
  workspace_path: string,
  effects: readonly RuntimeToolEffect[],
): SessionTurnFileDiffData | undefined {
  const mutations = effects.flatMap((effect) => {
    const mutation = read_workspace_file_mutation_effect(effect);
    return mutation ? [mutation] : [];
  });
  const files_by_path = collect_file_mutations(workspace_path, mutations);
  const files = [...files_by_path.values()]
    .filter((entry) => !entry.conflicted && !same_file_state(entry.before, entry.after))
    .map(create_file_diff)
    .sort((left, right) => left.file.localeCompare(right.file));
  if (files.length === 0) return undefined;
  return {
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}

/** 从通用 Tool effect 中读取经过最小运行时校验的 Workspace 文件修改。 */
function read_workspace_file_mutation_effect(
  input: unknown,
): WorkspaceFileMutation | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const effect = input as Record<string, unknown>;
  if (effect.type !== WORKSPACE_FILE_MUTATION_EFFECT_TYPE) return undefined;
  if (!effect.data || typeof effect.data !== "object" || Array.isArray(effect.data)) {
    return undefined;
  }
  const mutation = effect.data as Record<string, unknown>;
  if (
    typeof mutation.file_path !== "string" ||
    !is_file_state(mutation.before) ||
    !is_file_state(mutation.after)
  ) return undefined;
  return {
    file_path: mutation.file_path,
    before: mutation.before,
    after: mutation.after,
  };
}

/** 按文件聚合连续的结构化修改；无法证明连续时标记冲突。 */
function collect_file_mutations(
  workspace_path: string,
  mutations: readonly WorkspaceFileMutation[],
): Map<string, CollectedFileMutation> {
  const workspace_root = path.resolve(workspace_path);
  const files_by_path = new Map<string, CollectedFileMutation>();
  for (const mutation of mutations) {
    const file = resolve_workspace_file(workspace_root, mutation.file_path);
    if (!file) continue;
    const existing = files_by_path.get(file);
    if (!existing) {
      files_by_path.set(file, {
        file,
        before: mutation.before,
        after: mutation.after,
        conflicted: false,
      });
      continue;
    }
    if (!same_file_state(existing.after, mutation.before)) existing.conflicted = true;
    existing.after = mutation.after;
  }
  return files_by_path;
}

/** 把绝对修改路径收窄为当前 Workspace 内的正斜杠相对路径。 */
function resolve_workspace_file(workspace_root: string, file_path: string): string | undefined {
  if (typeof file_path !== "string" || !file_path.trim()) return undefined;
  if (!path.isAbsolute(file_path)) return undefined;
  const resolved_path = path.resolve(file_path);
  const relative_path = path.relative(workspace_root, resolved_path);
  if (
    !relative_path ||
    relative_path === ".." ||
    relative_path.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative_path)
  ) {
    return undefined;
  }
  return relative_path.replaceAll(path.sep, "/");
}

/** 校验 Workspace 修改状态的最小运行时形状。 */
function is_file_state(input: unknown): input is WorkspaceFileMutationState {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const state = input as Record<string, unknown>;
  return typeof state.exists === "boolean" &&
    (state.sha256 === undefined || typeof state.sha256 === "string") &&
    (state.content === undefined || typeof state.content === "string");
}

/** 使用内容 hash 优先判断两个相邻修改状态是否连续。 */
function same_file_state(
  left: WorkspaceFileMutationState,
  right: WorkspaceFileMutationState,
): boolean {
  if (left.exists !== right.exists) return false;
  if (!left.exists) return true;
  if (left.sha256 && right.sha256) return left.sha256 === right.sha256;
  if (left.content !== undefined && right.content !== undefined) {
    return left.content === right.content;
  }
  return false;
}

/** 为单个连续文件修改生成统计与 unified patch。 */
function create_file_diff(entry: CollectedFileMutation): SessionTurnFileDiff {
  const status: SessionTurnFileDiffStatus = !entry.before.exists
    ? "added"
    : !entry.after.exists
      ? "deleted"
      : "modified";
  const before_content = entry.before.exists ? entry.before.content : "";
  const after_content = entry.after.exists ? entry.after.content : "";
  const text_diff = before_content !== undefined && after_content !== undefined
    ? create_text_patch(entry.file, status, before_content, after_content)
    : undefined;
  return {
    file: entry.file,
    status,
    additions: text_diff?.additions ?? 0,
    deletions: text_diff?.deletions ?? 0,
    patch: text_diff?.patch ?? create_binary_patch(entry.file),
  };
}

/** 生成 Git 风格文件头与标准 unified hunks。 */
function create_text_patch(
  file: string,
  status: SessionTurnFileDiffStatus,
  before: string,
  after: string,
): { patch: string; additions: number; deletions: number } {
  const old_file = status === "added" ? "/dev/null" : `a/${file}`;
  const new_file = status === "deleted" ? "/dev/null" : `b/${file}`;
  const structured = structuredPatch(old_file, new_file, before, after, "", "", { context: 3 });
  let additions = 0;
  let deletions = 0;
  for (const hunk of structured.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("+")) additions += 1;
      else if (line.startsWith("-")) deletions += 1;
    }
  }
  const header = [
    `diff --git a/${file} b/${file}`,
    ...(status === "added" ? ["new file mode 100644"] : []),
    ...(status === "deleted" ? ["deleted file mode 100644"] : []),
  ];
  return {
    additions,
    deletions,
    patch: `${header.join("\n")}\n${formatPatch(structured, FILE_HEADERS_ONLY).trimEnd()}`,
  };
}

/** 无法安全保留文本内容时生成不伪造行级统计的变化说明。 */
function create_binary_patch(file: string): string {
  return [
    `diff --git a/${file} b/${file}`,
    `Binary files a/${file} and b/${file} differ`,
  ].join("\n");
}
