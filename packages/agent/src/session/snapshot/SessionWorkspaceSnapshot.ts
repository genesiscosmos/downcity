/**
 * Session Workspace 的 OpenCode 风格 shadow Git 快照。
 *
 * 关键点（中文）
 * - shadow Git 目录位于系统临时目录，绝不修改用户仓库的 index、stash、branch 或 commit。
 * - 初始 tree 复用真实仓库对象库，再把当前工作树状态写入独立 index。
 * - 每次 capture 只同步已跟踪文件和符合 ignore 规则的小型未跟踪文件。
 * - 同一进程内、同一 Workspace 共享实例并串行写 shadow index。
 */

import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  SessionTurnFileDiff,
  SessionTurnFileDiffStatus,
  SessionWorkspaceSnapshot,
} from "@/types/session/SessionTurnFileDiff.js";

const MAX_UNTRACKED_FILE_SIZE = 2 * 1024 * 1024;
const SNAPSHOT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const git_config = [
  "-c", "core.autocrlf=false",
  "-c", "core.longpaths=true",
  "-c", "core.symlinks=true",
  "-c", "core.quotepath=false",
];
const snapshots_by_workspace = new Map<string, SessionWorkspaceSnapshot>();
const snapshot_run_id = randomUUID();
let cleanup_started = false;

interface GitCommandResult {
  /** Git 进程退出码。 */
  exit_code: number;
  /** 标准输出文本。 */
  stdout: string;
  /** 标准错误文本。 */
  stderr: string;
}

interface SnapshotFileRow {
  /** Git 工作树根目录相对路径。 */
  file: string;
  /** 文件变化状态。 */
  status: SessionTurnFileDiffStatus;
  /** 新增行数。 */
  additions: number;
  /** 删除行数。 */
  deletions: number;
}

/** 返回当前进程内复用的 Workspace shadow snapshot。 */
export function create_session_workspace_snapshot(
  workspace_path: string,
): SessionWorkspaceSnapshot {
  const resolved_path = path.resolve(workspace_path);
  const existing = snapshots_by_workspace.get(resolved_path);
  if (existing) return existing;
  const created = new GitSessionWorkspaceSnapshot(resolved_path);
  snapshots_by_workspace.set(resolved_path, created);
  return created;
}

/** 由独立 Git index 维护 Workspace tree 的快照实现。 */
export class GitSessionWorkspaceSnapshot implements SessionWorkspaceSnapshot {
  private readonly workspace_path: string;
  private readonly snapshot_base_path: string;
  private repo_root_path = "";
  private git_dir_path = "";
  private initialization?: Promise<boolean>;
  private operation_chain: Promise<void> = Promise.resolve();

  constructor(workspace_path: string, snapshot_base_path = default_snapshot_base_path()) {
    this.workspace_path = path.resolve(workspace_path);
    this.snapshot_base_path = path.resolve(snapshot_base_path);
    start_snapshot_cleanup(this.snapshot_base_path);
  }

  /** 捕获当前工作树状态并返回独立 tree hash。 */
  async capture(): Promise<string | undefined> {
    return await this.with_lock(async () => {
      if (!(await this.ensure_initialized())) return undefined;
      await this.stage_workspace();
      const result = await this.run_shadow_git(["write-tree"]);
      if (result.exit_code !== 0) {
        throw new Error(`Shadow Git write-tree failed: ${result.stderr.trim()}`);
      }
      return result.stdout.trim() || undefined;
    });
  }

  /** 比较两个 tree 并生成文件级统计与 unified patch。 */
  async diff(from_snapshot: string, to_snapshot: string): Promise<SessionTurnFileDiff[]> {
    return await this.with_lock(async () => {
      if (!(await this.ensure_initialized()) || from_snapshot === to_snapshot) return [];
      const [status_result, stat_result] = await Promise.all([
        this.run_shadow_git([
          "diff", "--no-ext-diff", "--no-renames", "--name-status", "-z",
          from_snapshot, to_snapshot, "--", ".",
        ], this.workspace_path),
        this.run_shadow_git([
          "diff", "--no-ext-diff", "--no-renames", "--numstat", "-z",
          from_snapshot, to_snapshot, "--", ".",
        ], this.workspace_path),
      ]);
      if (status_result.exit_code !== 0 || stat_result.exit_code !== 0) {
        const message = status_result.stderr.trim() || stat_result.stderr.trim();
        throw new Error(`Shadow Git diff failed: ${message}`);
      }
      const statuses = parse_name_status(status_result.stdout);
      const rows = parse_numstat(stat_result.stdout, statuses);
      const diffs: SessionTurnFileDiff[] = [];
      for (const row of rows) {
        const patch_result = await this.run_shadow_git([
          "diff", "--no-ext-diff", "--no-color", "--no-renames", "--full-index",
          from_snapshot, to_snapshot, "--", literal_pathspec(row.file),
        ], this.repo_root_path);
        if (patch_result.exit_code !== 0) {
          throw new Error(`Shadow Git file diff failed for ${row.file}: ${patch_result.stderr.trim()}`);
        }
        diffs.push({ ...row, patch: patch_result.stdout.trimEnd() });
      }
      return diffs.sort((left, right) => left.file.localeCompare(right.file));
    });
  }

  /** 初始化 shadow repository；非 Git Workspace 返回 false。 */
  private async ensure_initialized(): Promise<boolean> {
    this.initialization ??= this.initialize();
    return await this.initialization;
  }

  /** 发现真实仓库并创建隔离的 Git 元数据。 */
  private async initialize(): Promise<boolean> {
    const root_result = await run_git(["rev-parse", "--show-toplevel"], this.workspace_path);
    if (root_result.exit_code !== 0 || !root_result.stdout.trim()) return false;
    this.repo_root_path = await realpath(root_result.stdout.trim()).catch(() => path.resolve(root_result.stdout.trim()));
    const workspace_real_path = await realpath(this.workspace_path).catch(() => this.workspace_path);
    const relative_workspace = path.relative(this.repo_root_path, workspace_real_path);
    if (relative_workspace.startsWith("..") || path.isAbsolute(relative_workspace)) return false;

    const identity = createHash("sha256")
      .update(`${snapshot_run_id}\0${workspace_real_path}`)
      .digest("hex")
      .slice(0, 24);
    this.git_dir_path = path.join(this.snapshot_base_path, identity);
    await ensure_private_directory(this.snapshot_base_path);
    await ensure_private_directory(this.git_dir_path);
    const init_result = await run_git(["init", "--quiet", "--bare", this.git_dir_path], this.repo_root_path);
    if (init_result.exit_code !== 0) {
      throw new Error(`Shadow Git init failed: ${init_result.stderr.trim()}`);
    }
    await this.configure_shadow_git();
    await this.seed_object_database();
    await this.seed_index();
    return true;
  }

  /** 配置与 OpenCode snapshot 一致的跨平台 Git 行为。 */
  private async configure_shadow_git(): Promise<void> {
    const settings: Array<[string, string]> = [
      ["core.bare", "false"],
      ["core.worktree", this.repo_root_path],
      ["core.autocrlf", "false"],
      ["core.longpaths", "true"],
      ["core.symlinks", "true"],
      ["core.fsmonitor", "false"],
      ["feature.manyFiles", "true"],
      ["index.version", "4"],
      ["index.threads", "true"],
      ["core.untrackedCache", "true"],
    ];
    for (const [key, value] of settings) {
      const result = await run_git(["--git-dir", this.git_dir_path, "config", key, value], this.repo_root_path);
      if (result.exit_code !== 0) {
        throw new Error(`Shadow Git config failed: ${result.stderr.trim()}`);
      }
    }
  }

  /** 通过 alternates 复用真实仓库 blob，避免复制完整对象库。 */
  private async seed_object_database(): Promise<void> {
    const common_result = await run_git([
      "rev-parse", "--path-format=absolute", "--git-common-dir",
    ], this.workspace_path);
    if (common_result.exit_code !== 0 || !common_result.stdout.trim()) return;
    const source_objects = path.join(common_result.stdout.trim(), "objects");
    const alternates_path = path.join(source_objects, "info", "alternates");
    const chained = await readFile(alternates_path, "utf8")
      .then((text) => text.split("\n").map((item) => item.trim()).filter(Boolean))
      .catch(() => []);
    const candidates = [source_objects, ...chained];
    const available: string[] = [];
    for (const candidate of candidates) {
      if (await stat(candidate).then((value) => value.isDirectory()).catch(() => false)) {
        available.push(candidate);
      }
    }
    if (available.length === 0) return;
    const target = path.join(this.git_dir_path, "objects", "info", "alternates");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${available.join("\n")}\n`, "utf8");

    const exclude_result = await run_git([
      "rev-parse", "--path-format=absolute", "--git-path", "info/exclude",
    ], this.workspace_path);
    const exclude_path = exclude_result.stdout.trim();
    if (exclude_result.exit_code === 0 && exclude_path) {
      const exclude = await readFile(exclude_path, "utf8").catch(() => "");
      if (exclude) {
        const target_exclude = path.join(this.git_dir_path, "info", "exclude");
        await mkdir(path.dirname(target_exclude), { recursive: true });
        await writeFile(target_exclude, exclude, "utf8");
      }
    }
  }

  /** 复用真实 index 以保留 sparse checkout 状态，失败时回退到真实 HEAD。 */
  private async seed_index(): Promise<void> {
    const index_result = await run_git([
      "rev-parse", "--path-format=absolute", "--git-path", "index",
    ], this.workspace_path);
    const source_index_path = index_result.stdout.trim();
    if (
      index_result.exit_code === 0 &&
      source_index_path &&
      await stat(source_index_path).then((value) => value.isFile()).catch(() => false)
    ) {
      try {
        await copyFile(source_index_path, path.join(this.git_dir_path, "index"));
        const source_index_directory = path.dirname(source_index_path);
        const shared_indexes = await readdir(source_index_directory, { withFileTypes: true });
        await Promise.all(shared_indexes
          .filter((entry) => entry.isFile() && entry.name.startsWith("sharedindex."))
          .map(async (entry) => await copyFile(
            path.join(source_index_directory, entry.name),
            path.join(this.git_dir_path, entry.name),
          )));
        return;
      } catch {
        // index 正在被其他 Git 进程更新时，使用 HEAD 仍能建立安全基线。
      }
    }
    const head_result = await run_git(["rev-parse", "HEAD"], this.workspace_path);
    if (head_result.exit_code !== 0 || !head_result.stdout.trim()) return;
    const result = await this.run_shadow_git(["read-tree", head_result.stdout.trim()], this.repo_root_path);
    if (result.exit_code !== 0) {
      throw new Error(`Shadow Git read-tree failed: ${result.stderr.trim()}`);
    }
  }

  /** 把当前 Workspace 状态同步到 shadow index。 */
  private async stage_workspace(): Promise<void> {
    const tracked_result = await this.run_shadow_git(["add", "--update", "--sparse", "--", "."], this.workspace_path);
    if (tracked_result.exit_code !== 0) {
      throw new Error(`Shadow Git tracked-file staging failed: ${tracked_result.stderr.trim()}`);
    }
    const untracked_result = await this.run_shadow_git([
      "ls-files", "--full-name", "--others", "--exclude-standard", "-z", "--", ".",
    ], this.workspace_path);
    if (untracked_result.exit_code !== 0) {
      throw new Error(`Shadow Git untracked-file listing failed: ${untracked_result.stderr.trim()}`);
    }
    const candidates = split_nul(untracked_result.stdout);
    const allowed: string[] = [];
    for (const file of candidates) {
      const file_size = await stat(path.join(this.repo_root_path, file))
        .then((value) => value.isFile() ? value.size : Number.POSITIVE_INFINITY)
        .catch(() => Number.POSITIVE_INFINITY);
      if (file_size <= MAX_UNTRACKED_FILE_SIZE) allowed.push(file);
    }
    if (allowed.length === 0) return;
    const result = await this.run_shadow_git([
      "add", "--all", "--sparse", "--pathspec-from-file=-", "--pathspec-file-nul",
    ], this.repo_root_path, `${allowed.map(literal_pathspec).join("\0")}\0`);
    if (result.exit_code !== 0) {
      throw new Error(`Shadow Git untracked-file staging failed: ${result.stderr.trim()}`);
    }
  }

  /** 使用当前 shadow Git 元数据执行命令。 */
  private async run_shadow_git(
    args: string[],
    cwd = this.workspace_path,
    input?: string,
  ): Promise<GitCommandResult> {
    return await run_git([
      ...git_config,
      "--git-dir", this.git_dir_path,
      "--work-tree", this.repo_root_path,
      ...args,
    ], cwd, input);
  }

  /** 串行执行会读写同一个 shadow index 的操作。 */
  private async with_lock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operation_chain;
    let release!: () => void;
    this.operation_chain = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

/** 执行 Git 并把进程异常转换成稳定结果。 */
async function run_git(args: string[], cwd: string, input?: string): Promise<GitCommandResult> {
  return await new Promise<GitCommandResult>((resolve) => {
    const child = execFile("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolve({
        exit_code: typeof error?.code === "number" ? error.code : error ? 1 : 0,
        stdout: String(stdout || ""),
        stderr: String(stderr || error?.message || ""),
      });
    });
    child.stdin?.end(input);
  });
}

/** 解析 `git diff --name-status -z`。 */
function parse_name_status(input: string): Map<string, SessionTurnFileDiffStatus> {
  const fields = split_nul(input);
  const statuses = new Map<string, SessionTurnFileDiffStatus>();
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const code = fields[index];
    const file = fields[index + 1];
    if (!code || !file) continue;
    statuses.set(file, code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified");
  }
  return statuses;
}

/** 解析 `git diff --numstat -z` 并合并文件状态。 */
function parse_numstat(
  input: string,
  statuses: Map<string, SessionTurnFileDiffStatus>,
): SnapshotFileRow[] {
  return split_nul(input).flatMap((row) => {
    const first_tab = row.indexOf("\t");
    const second_tab = row.indexOf("\t", first_tab + 1);
    if (first_tab < 0 || second_tab < 0) return [];
    const additions_text = row.slice(0, first_tab);
    const deletions_text = row.slice(first_tab + 1, second_tab);
    const file = row.slice(second_tab + 1);
    if (!file) return [];
    const binary = additions_text === "-" && deletions_text === "-";
    const additions = binary ? 0 : Number.parseInt(additions_text, 10);
    const deletions = binary ? 0 : Number.parseInt(deletions_text, 10);
    return [{
      file: path.sep === "\\" ? file.replaceAll("\\", "/") : file,
      status: statuses.get(file) || "modified",
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
    } satisfies SnapshotFileRow];
  });
}

/** 解析 NUL 分隔的 Git 路径输出。 */
function split_nul(input: string): string[] {
  return input.split("\0").filter(Boolean);
}

/** 构造不解释 pathspec magic 的仓库根路径。 */
function literal_pathspec(file: string): string {
  return `:(top,literal)${file}`;
}

/** 返回当前进程使用的 shadow snapshot 临时根目录。 */
function default_snapshot_base_path(): string {
  return path.join(os.tmpdir(), "downcity-session-snapshots");
}

/** 进程首次使用时尽力清理七天前的临时 shadow repository。 */
function start_snapshot_cleanup(snapshot_base_path: string): void {
  if (cleanup_started || snapshot_base_path !== default_snapshot_base_path()) return;
  cleanup_started = true;
  void (async () => {
    await ensure_private_directory(snapshot_base_path);
    const entries = await readdir(snapshot_base_path, { withFileTypes: true });
    const expiration = Date.now() - SNAPSHOT_RETENTION_MS;
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const entry_path = path.join(snapshot_base_path, entry.name);
      const modified_at = await stat(entry_path).then((value) => value.mtimeMs).catch(() => Date.now());
      if (modified_at < expiration) await rm(entry_path, { recursive: true, force: true });
    }));
  })().catch(() => undefined);
}

/** 创建仅当前系统用户可进入的 snapshot 目录。 */
async function ensure_private_directory(directory_path: string): Promise<void> {
  await mkdir(directory_path, { recursive: true, mode: 0o700 });
  await chmod(directory_path, 0o700).catch(() => undefined);
}
