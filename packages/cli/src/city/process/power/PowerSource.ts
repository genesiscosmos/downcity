/**
 * Power 来源的只读探测。下载只用于识别清单与复制单包制品，不执行项目入口或安装脚本。
 * Git 来源固定到一次检出的 commit，临时目录在调用结束后清理。
 */
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { execa } from "execa";
import { normalize_extension_source } from "@downcity/city/local";

/** 安装器在一次来源探测中使用的固定文件视图。 */
export interface PreparedPowerSource {
  /** 本地来源目录或临时 Git checkout 的绝对路径。 */
  directory: string;
  /** 保存用于后续更新的来源地址；Git ref 单独附在 fragment 中。 */
  source: string;
  /** Git checkout 的固定 commit；本地目录不提供此字段。 */
  revision?: string;
}

/** 在清理临时 checkout 前执行来源探测或单包复制。 */
export async function with_power_source<T>(
  source_input: string,
  ref: string | undefined,
  consume: (source: PreparedPowerSource) => Promise<T>,
): Promise<T> {
  const origin = await normalize_extension_source(source_input, process.cwd(), ref);
  const source = origin.kind === "local" ? origin.location : `${origin.location}${origin.ref ? `#${origin.ref}` : ""}`;
  if (origin.kind === "local") return await consume({ directory: origin.location, source });
  const temporary_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-power-"));
  const directory = path.join(temporary_root, "source");
  const git_options = { stdio: "pipe" as const, env: { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_SSH_COMMAND: "ssh -oBatchMode=yes" } };
  try {
    let revision: string;
    try {
      await execa("git", ["-c", "core.hooksPath=/dev/null", "clone", "--depth", "1", "--no-checkout", origin.location, directory], git_options);
      if (origin.ref) await execa("git", ["-c", "core.hooksPath=/dev/null", "fetch", "--depth", "1", "origin", origin.ref], { ...git_options, cwd: directory });
      const target = origin.ref ? "FETCH_HEAD" : "HEAD";
      revision = (await execa("git", ["rev-parse", target], { ...git_options, cwd: directory })).stdout.trim();
      await execa("git", ["-c", "core.hooksPath=/dev/null", "-c", "filter.lfs.required=false", "-c", "filter.lfs.smudge=", "checkout", "--detach", revision], { ...git_options, cwd: directory });
    } catch {
      throw new Error("Power Git source or ref is unavailable; verify system Git credentials");
    }
    return await consume({ directory, source, revision });
  } finally { await fs.remove(temporary_root); }
}
