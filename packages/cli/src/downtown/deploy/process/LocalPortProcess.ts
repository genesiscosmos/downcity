/** 读取 macOS/Linux TCP 监听进程；只处理目标地址，停止前重新核对进程快照。 */
import { lookup } from "node:dns/promises";
import { realpath } from "node:fs/promises";
import { run_service_command } from "./SystemServiceCommand.js";
import type { LocalPortProcess } from "@/downtown/types/LocalPortProcess.js";

/** 读取启动时间、命令和工作目录，任一信息缺失都不构造可停止的身份。 */
async function read_process_identity(pid: number): Promise<LocalPortProcess> {
  const [status, directory] = await Promise.all([
    run_service_command("ps", ["-ww", "-p", String(pid), "-o", "lstart=", "-o", "command="]),
    run_service_command("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]),
  ]);
  const identity = status.stdout.trim();
  const cwd = directory.stdout.split("\n").find((line) => line.startsWith("n/"))?.slice(1);
  if (status.code !== 0 || directory.code !== 0 || !identity || !cwd) {
    throw new Error(`Cannot verify command, start time and working directory for PID ${pid}.`);
  }
  return { pid, identity, cwd: await realpath(cwd) };
}

/** 查询实际与目标监听地址冲突的进程；无法检查时交由调用方报告，不猜测 PID。 */
export async function read_local_port_processes(port: number, host: string): Promise<LocalPortProcess[]> {
  // 与 net.listen(host) 一样使用首个解析地址，不能把 localhost 的其他地址也当作冲突者。
  const target_address = (await lookup(host)).address;
  const target_is_ipv4 = !target_address.includes(":");
  const result = await run_service_command("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fptn"]);
  if (result.code === 1 && !result.stdout.trim() && !result.stderr.trim()) return [];
  if (result.code !== 0) throw new Error(`Cannot inspect TCP listeners: ${result.stderr.trim()}`);
  const pids = new Set<number>();
  const ipv6_wildcard_pids = new Set<number>();
  let current_pid = 0;
  let address_family = "";
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("p")) current_pid = Number(line.slice(1));
    if (line.startsWith("t")) address_family = line.slice(1);
    if (!line.startsWith("n") || !Number.isSafeInteger(current_pid) || current_pid <= 0) continue;
    const endpoint = line.slice(1);
    const separator = endpoint.lastIndexOf(":");
    const address = endpoint.slice(0, separator).replace(/^\[|\]$/gu, "");
    if (Number(endpoint.slice(separator + 1)) !== port) continue;
    // 通配监听会与具体地址冲突；具体地址之间只匹配同一地址族及目标地址。
    const ipv6_wildcard = address_family === "IPv6" && (address === "*" || address === "::");
    if (ipv6_wildcard && target_is_ipv4) {
      ipv6_wildcard_pids.add(current_pid);
      continue;
    }
    const wildcard_matches = address === "*" && (address_family === "IPv6" || target_is_ipv4);
    if (wildcard_matches || (address === "0.0.0.0" && target_is_ipv4) || address === "::"
      || target_address === address || target_address === "::"
      || (target_address === "0.0.0.0" && !address.includes(":"))) pids.add(current_pid);
  }
  // 若已有 IPv4 冲突者，同端口 IPv6 通配监听可能启用了 IPV6_V6ONLY，不应一并停止。
  if (!pids.size) for (const pid of ipv6_wildcard_pids) pids.add(pid);
  return await Promise.all([...pids].map(read_process_identity));
}

/** 只向仍持有原身份的已确认进程发送 SIGTERM；不停止进程组，不升级为 SIGKILL。 */
export async function stop_local_port_processes(
  approved: LocalPortProcess[], port: number, host: string,
): Promise<void> {
  const current = await read_local_port_processes(port, host);
  for (const entry of current) {
    const original = approved.find((item) => item.pid === entry.pid);
    if (!original || original.identity !== entry.identity || original.cwd !== entry.cwd) {
      throw new Error("The port owner changed while awaiting confirmation. Retry deployment to inspect it again.");
    }
    if (entry.pid === process.pid || entry.pid === process.ppid || entry.pid <= 1) {
      throw new Error(`Refusing to stop the deployment process or its parent (PID ${entry.pid}).`);
    }
  }
  for (const entry of current) {
    const verified = await read_process_identity(entry.pid);
    if (verified.identity !== entry.identity || verified.cwd !== entry.cwd) {
      throw new Error(`PID ${entry.pid} changed before termination. Retry deployment.`);
    }
    try { process.kill(entry.pid, "SIGTERM"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}
