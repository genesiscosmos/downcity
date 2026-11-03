/** 本地部署预检的端口冲突交互；确认后温和停止占用者，再等待固定端口释放。 */
import { realpath } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { allocateAvailablePort } from "@/city/process/daemon/PortAllocator.js";
import { read_local_port_processes, stop_local_port_processes } from "../process/LocalPortProcess.js";
import { confirm } from "@/federation/tui/Prompts.js";
import { CliError } from "@/shared/CliError.js";
import { t } from "@/shared/CliLocale.js";

/** 只在部署预检调用；普通重启及发布切换后继续使用非交互端口检查。 */
export async function prepare_local_deployment_port(port: number, host: string, project_dir: string): Promise<void> {
  const is_available = async (): Promise<boolean> => {
    try { await allocateAvailablePort({ start: port, end: port, host }); return true; }
    catch { return false; }
  };
  if (await is_available()) return;
  const fix = "Stop the listed process manually or set deployment.port in federation.toml.";
  let processes;
  try { processes = await read_local_port_processes(port, host); } catch (error) {
    throw new CliError({ title: "Local Federation port is unavailable",
      note: `Cannot listen on ${host}:${port}. ${error instanceof Error ? error.message : String(error)}`,
      fix: `${fix} Process inspection requires lsof and ps.` });
  }
  // 监听者可能在检查期间自行退出；此时无需确认或发送信号。
  if (await is_available()) return;
  if (!processes.length) throw new CliError({ title: "Local Federation port is unavailable",
    note: `Cannot listen on ${host}:${port}; no verifiable listening process was found.`, fix });
  const source = await realpath(project_dir);
  const description = processes.map((entry) =>
    `PID ${entry.pid}\n  ${entry.identity}\n  cwd: ${entry.cwd}\n  ${entry.cwd === source ? t({ zh: "当前项目", en: "Same project" }) : t({ zh: "其他项目", en: "Other project" })}`,
  ).join("\n\n");
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError({ title: "Local Federation port is unavailable",
      note: `${host}:${port}\n${description}\nStopping a process requires interactive confirmation.`, fix });
  }
  const accepted = await confirm({
    message: t({ zh: `停止占用 ${host}:${port} 的进程并继续部署？`, en: `Stop processes using ${host}:${port} and continue deployment?` }),
    details: `${host}:${port}\n\n${description}`,
    initialValue: false,
  });
  if (accepted !== true) throw new CliError({ title: "Local Federation deployment cancelled",
    note: "The port owner was not stopped.", fix });
  try { await stop_local_port_processes(processes, port, host); } catch (error) {
    throw new CliError({ title: "Unable to stop the port owner",
      note: error instanceof Error ? error.message : String(error), fix });
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await is_available()) return;
    await delay(100);
  }
  throw new CliError({ title: "Local Federation port was not released",
    note: `${host}:${port} is still unavailable after SIGTERM. No SIGKILL was sent.`, fix });
}
