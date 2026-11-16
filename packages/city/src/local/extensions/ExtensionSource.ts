/**
 * 扩展来源定位和 Git ref 解析。Git 操作禁用交互，错误不回显含凭证的参数或 stderr。
 * 仅规范可证明等价的 GitHub 地址，普通 Git 地址保持显式身份。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type { ExtensionSource } from "../types/Extension.js";
import { ExtensionFailure } from "./ExtensionError.js";

const exec_file = promisify(execFile);

/** 受控进程参数，不拼接 shell 命令。 */
export async function run_extension_process(command: string, args: string[], cwd?: string, signal?: AbortSignal): Promise<string> {
  try {
    const result = await exec_file(command, args, { cwd, signal, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_SSH_COMMAND: "ssh -oBatchMode=yes" }, encoding: "utf8" });
    return result.stdout;
  } catch {
    if (signal?.aborted) throw new ExtensionFailure("operation_cancelled", "Extension preparation was cancelled", "source");
    throw new ExtensionFailure("source_unavailable", "Git source, ref or authentication is unavailable; verify system Git credentials", "source");
  }
}

/** 在客户端 cwd 解析本地来源；Git 默认分支在仓储去重后再查询。 */
export async function normalize_extension_source(input: string, cwd = process.cwd(), explicit_ref?: string): Promise<ExtensionSource> {
  if (!input.trim()) throw new ExtensionFailure("source_invalid", "An extension source is required", "source", 2);
  const looks_git = /^(github:|https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|git@)/iu.test(input);
  if (!looks_git) {
    if (explicit_ref) throw new ExtensionFailure("source_invalid", "--ref is only supported for Git sources", "source", 2);
    let location: string;
    try { location = await fs.realpath(path.resolve(cwd, input)); }
    catch { throw new ExtensionFailure("source_not_found", "Local extension source does not exist", "source", 2); }
    if ((await fs.stat(location)).isFile()) {
      if (!["downcity.ts", "downcity.js"].includes(path.basename(location))) throw new ExtensionFailure("entry_invalid", "Select downcity.ts or downcity.js", "source", 2);
      location = path.dirname(location);
    }
    if (!(await fs.stat(location)).isDirectory()) throw new ExtensionFailure("source_invalid", "Extension source must be a project directory", "source", 2);
    return { kind: "local", location, identity: `local:${location}` };
  }
  const fragment_index = input.indexOf("#");
  let fragment: string | undefined;
  try { fragment = fragment_index >= 0 ? decodeURIComponent(input.slice(fragment_index + 1)) : undefined; }
  catch { throw new ExtensionFailure("ref_invalid", "URL ref contains invalid encoding", "source", 2); }
  let location = fragment_index >= 0 ? input.slice(0, fragment_index) : input;
  if (fragment && explicit_ref && fragment !== explicit_ref) throw new ExtensionFailure("ref_conflict", "URL ref and --ref must agree", "source", 2);
  const ref = explicit_ref ?? fragment;
  if (ref !== undefined && (!ref || ref.startsWith("-") || /[\s\x00-\x1f~^:?*\[\\]/u.test(ref))) throw new ExtensionFailure("ref_invalid", "Git ref is invalid", "source", 2);
  let github: RegExpMatchArray | null = location.match(/^github:([^/]+)\/([^/]+?)\/?$/iu);
  github ??= location.match(/^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/(?:git@)?github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)\/?$/iu);
  let identity: string;
  if (github) {
    const owner = github[1]!.toLowerCase();
    const repository = github[2]!.replace(/\.git$/iu, "").toLowerCase();
    if (!/^[a-z\d_.-]+$/iu.test(owner) || !/^[a-z\d_.-]+$/iu.test(repository)) throw new ExtensionFailure("source_invalid", "GitHub repository is invalid", "source", 2);
    identity = `github:${owner}/${repository}`;
    // 保留 SSH 认证方式，持久化身份仍与 HTTPS 合并。
    location = /^(git@|ssh:)/iu.test(location) ? `git@github.com:${owner}/${repository}.git` : `https://github.com/${owner}/${repository}.git`;
  } else {
    try {
      const url = new URL(location);
      if (!["https:", "http:", "ssh:", "git:", "file:"].includes(url.protocol)) throw new Error();
      if (url.protocol !== "ssh:") url.username = "";
      url.password = "";
      url.search = "";
      location = url.href;
    } catch { throw new ExtensionFailure("source_invalid", "Use a Git HTTPS or SSH repository URL", "source", 2); }
    identity = `git:${location}`;
  }
  return { kind: "git", location, identity, ...(ref ? { ref } : {}), default_ref: !ref };
}

/** 固定默认分支名称；明确分支/tag 重名时要求完整限定。 */
export async function resolve_extension_ref(source: ExtensionSource, signal?: AbortSignal): Promise<ExtensionSource> {
  if (source.kind !== "git") return source;
  if (!source.ref) {
    const output = await run_extension_process("git", ["ls-remote", "--symref", source.location, "HEAD"], undefined, signal);
    const branch = output.match(/^ref: refs\/heads\/([^\t\n]+)\tHEAD$/mu)?.[1];
    if (!branch) throw new ExtensionFailure("ref_invalid", "Remote default branch cannot be resolved", "source", 2);
    return { ...source, ref: `refs/heads/${branch}`, identity: `${source.identity}#refs/heads/${branch}`, default_ref: true };
  }
  const requested = source.ref;
  let ref = requested;
  if (!requested.startsWith("refs/") && !/^[a-f\d]{40}$/iu.test(requested)) {
    const output = await run_extension_process("git", ["ls-remote", source.location, `refs/heads/${requested}`, `refs/tags/${requested}`], undefined, signal);
    const refs = output.trim().split("\n").map((line) => line.split("\t")[1]).filter((value): value is string => Boolean(value));
    if (refs.length !== 1) throw new ExtensionFailure("ref_invalid", refs.length ? "Ambiguous ref; use refs/heads/ or refs/tags/" : "Git ref does not exist", "source", 2);
    ref = refs[0]!;
  }
  if (/^[a-f\d]{40}$/iu.test(ref)) ref = ref.toLowerCase();
  return { ...source, ref, identity: `${source.identity}#${ref}` };
}

/** 获取确认 ref 的固定 commit，不初始化 submodule 或 LFS。 */
export async function fetch_extension_source(source: ExtensionSource, destination: string, signal?: AbortSignal): Promise<string> {
  if (source.kind !== "git" || !source.ref) throw new ExtensionFailure("source_invalid", "Git source requires a resolved ref", "source", 2);
  await fs.mkdir(destination, { recursive: true });
  await run_extension_process("git", ["init", "--quiet", destination], undefined, signal);
  await run_extension_process("git", ["-c", "core.hooksPath=/dev/null", "fetch", "--depth=1", "--no-tags", source.location, source.ref], destination, signal);
  const commit = (await run_extension_process("git", ["rev-parse", "FETCH_HEAD"], destination, signal)).trim();
  await run_extension_process("git", ["-c", "core.hooksPath=/dev/null", "-c", "filter.lfs.required=false", "-c", "filter.lfs.smudge=", "checkout", "--detach", "--force", commit], destination, signal);
  return commit;
}
