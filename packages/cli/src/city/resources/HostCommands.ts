/** 统一 root 的显式生命周期展示适配；status 无副作用，启停仍由用户命令触发。 */
import { spawn } from "node:child_process";
import { read_city_host_state } from "@downcity/city";
import { resolve_resource_root, RootLease, request_management } from "@downcity/city/local";
import { emitCliBlock } from "@/shared/CliReporter.js";

/**
 * 不改父进程全局环境，显式 --root 的启停交给绑定该 root 的 CLI 子进程。
 * child 沿用唯一生命周期实现，daemon 的后代继承同一数据根。
 */
export async function run_root_lifecycle(root: string | undefined, operation: () => Promise<void>): Promise<void> {
  if (root === undefined) { await operation(); return; }
  const root_path = resolve_resource_root(root);
  const argv = process.argv.slice(2);
  const filtered: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") { index += 1; continue; }
    if (argv[index]?.startsWith("--root=")) continue;
    filtered.push(argv[index]!);
  }
  const child = spawn(process.execPath, [process.argv[1]!, ...filtered], { stdio: "inherit", env: { ...process.env, DC_PLATFORM_ROOT: root_path } });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1); resolve(); });
  });
}

/** status 从统一宿主描述和握手读取；不从 daemon 的启动 Agent 列表推断实时状态。 */
export async function show_host_status(root?: string): Promise<void> {
  const root_path = resolve_resource_root(root);
  const state = await read_city_host_state(root_path);
  if (!state) {
    const lease = RootLease.acquire_read(root_path);
    try { emitCliBlock({ tone: "info", title: "City status", summary: "offline", facts: [{ label: "Root", value: root_path }] }); }
    finally { lease.release(); }
    return;
  }
  const identity = await request_management(state, root_path, "handshake", {}, 5_000) as typeof state;
  emitCliBlock({ tone: "success", title: "City status", summary: "ready", facts: [
    { label: "Root", value: root_path }, { label: "Owner", value: identity.owner }, { label: "Instance", value: identity.instance_id },
    { label: "PID", value: String(identity.pid) }, { label: "Capabilities", value: identity.capabilities?.join(", ") ?? "" },
    { label: "RPC", value: state.rpc_port ? `rpc://${state.rpc_host}:${state.rpc_port}` : "unavailable" },
  ] });
}
