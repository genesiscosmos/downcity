/**
 * 在隔离的 Node 进程中加载项目 Worker 的数据库准备入口。
 *
 * 使用项目自身的 Wrangler/esbuild 和依赖版本。临时 bundle 保留包导入，
 * 位于项目目录内以遵循 Node 的依赖解析规则；远程代理始终在 finally 释放。
 * 完整准备只读检查迁移管理员；prepare_schema 只调用项目建表入口，跳过身份查询。
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { read_postgres_administrator } from "./PostgresAdministratorReader.js";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { FederationProjectHyperdriveResourceConfig } from "@/federation/types/FederationProjectConfig.js";

/** 子进程数据库准备参数。 */
export interface WorkerDatabasePrepareInput {
  /** Federation 项目根目录。 */
  project_dir: string;
  /** Worker TypeScript 或 JavaScript 入口的绝对路径。 */
  entry: string;
  /** 远程 binding 模式使用的临时 Wrangler 配置；独立 PG 连接模式不读取。 */
  config_path: string;
  /** 仅构建并验证导出，不建立远程代理或执行准备。 */
  dry_run: boolean;
  /** 准备入口；默认完整数据库准备，迁移建空表使用 prepare_schema 且跳过管理员查询。 */
  operation?: "prepare_database" | "prepare_schema";
  /** 可选 Hyperdrive 声明；连接值仅从进程环境或远程 binding 读取。 */
  hyperdrive?: FederationProjectHyperdriveResourceConfig;
  /** 仅供父进程接收非敏感管理员 ID 的结果文件路径。 */
  result_path?: string;
  /** 配置声明的公开存储 URL 前缀，供独立 PG 准备入口构造 R2Storage。 */
  storage_public_url_prefix?: string;
}

/** 本地代理公开能力；不依赖 CLI 自身安装的 Wrangler 类型。 */
interface DatabasePlatformProxy {
  /** 项目配置中的平台 binding 集合。 */
  env: Record<string, unknown>;
  /** 关闭代理及其持有的资源。 */
  dispose: () => Promise<void>;
}

/** 构建并执行选定准备入口；支持远程 binding 或独立 PostgreSQL 连接。 */
export async function run_worker_database_prepare(input: WorkerDatabasePrepareInput): Promise<void> {
  const project_require = createRequire(join(input.project_dir, "package.json"));
  const wrangler_path = project_require.resolve("wrangler");
  const wrangler_require = createRequire(wrangler_path);
  const { build } = await import(pathToFileURL(wrangler_require.resolve("esbuild")).href);
  const bundle_dir = await mkdtemp(join(input.project_dir, ".downcity-prepare-"));
  let proxy: DatabasePlatformProxy | undefined;
  try {
    const bundle_path = join(bundle_dir, "worker.mjs");
    await build({
      absWorkingDir: input.project_dir,
      entryPoints: [resolve(input.entry)],
      outfile: bundle_path,
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      logLevel: "silent",
    });
    const worker = await import(pathToFileURL(bundle_path).href);
    const operation = input.operation ?? "prepare_database";
    if (operation !== "prepare_database" && operation !== "prepare_schema") {
      throw new Error("Unsupported database preparation operation");
    }
    const prepare_entry = worker[operation];
    if (typeof prepare_entry !== "function") {
      throw new Error(`Worker entry must export async ${operation}(env)`);
    }
    if (input.dry_run) return;
    const database_url_env = input.hyperdrive?.database_url_env;
    if (database_url_env) {
      const database_url = process.env[database_url_env];
      if (!database_url) throw new Error("The database_url_env process variable is missing");
      const parsed_url = new URL(database_url);
      if (!["postgres:", "postgresql:"].includes(parsed_url.protocol)) {
        throw new Error("The database_url_env variable must contain a PostgreSQL URL");
      }
      // 先只读验证迁移管理员，缺失时禁止执行数据库准备。
      const admin_id = operation === "prepare_database"
        ? await read_postgres_administrator(input.project_dir, database_url)
        : undefined;
      // 独立连接模式无需启动 Hyperdrive 远程代理。
      await prepare_entry({
        DOWNCITY_STORAGE_PUBLIC_URL_PREFIX: input.storage_public_url_prefix,
        [database_url_env]: database_url,
        [input.hyperdrive!.binding]: { connectionString: database_url },
      });
      if (input.result_path && admin_id) await writeFile(input.result_path, JSON.stringify({ admin_id }), { mode: 0o600 });
      return;
    }
    const { getPlatformProxy } = await import(pathToFileURL(wrangler_path).href);
    proxy = await getPlatformProxy({
      configPath: input.config_path,
      persist: false,
      remoteBindings: true,
      envFiles: [],
    }) as DatabasePlatformProxy;
    let admin_id: string | undefined;
    if (input.hyperdrive) {
      const binding = proxy.env[input.hyperdrive.binding] as { /** Wrangler 提供的远程 PostgreSQL 连接。 */ connectionString?: unknown } | undefined;
      if (typeof binding?.connectionString !== "string" || !binding.connectionString) {
        throw new Error("Hyperdrive remote proxy unavailable; configure database_url_env for preparation");
      }
      if (operation === "prepare_database") {
        admin_id = await read_postgres_administrator(input.project_dir, binding.connectionString);
      }
    }
    await prepare_entry(proxy.env);
    if (input.result_path && admin_id) await writeFile(input.result_path, JSON.stringify({ admin_id }), { mode: 0o600 });
  } finally {
    try {
      await proxy?.dispose();
    } finally {
      await rm(bundle_dir, { recursive: true, force: true });
    }
  }
}
