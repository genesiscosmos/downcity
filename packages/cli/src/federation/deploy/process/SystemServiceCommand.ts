/**
 * Bounded, shell-free service-manager calls and conservative output decoding.
 * A failed command is never silently converted to a missing service. Only the
 * manager's documented not-found response is accepted by the adapter.
 */
import { execFile as exec_file } from "node:child_process";

/** Captured output from one service-manager process. */
export interface ServiceCommandResult {
  /** Numeric exit code; spawn failures, signals and timeouts throw instead. */
  code: number;
  /** UTF-8 standard output, bounded to one MiB by execFile. */
  stdout: string;
  /** UTF-8 standard error, retained for actionable failure messages. */
  stderr: string;
}

/** Execute one precise argument array, never through a shell, for at most 10s. */
export function run_service_command(command: string, arguments_list: string[]): Promise<ServiceCommandResult> {
  return new Promise((resolve, reject) => {
    exec_file(command, arguments_list, {
      timeout: 10_000, maxBuffer: 1024 * 1024, encoding: "utf8",
      env: { ...process.env, LC_ALL: "C", LANG: "C", SYSTEMD_COLORS: "0", SYSTEMD_PAGER: "cat" },
    }, (error, stdout, stderr) => {
      if (error && (error.killed || error.signal || typeof error.code !== "number")) {
        reject(new Error(`${command} failed: ${error.message}`, { cause: error }));
        return;
      }
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
    });
  });
}

/** Throw with the command's actual error instead of swallowing permission failures. */
export function require_service_success(result: ServiceCommandResult, operation: string): void {
  if (result.code !== 0) throw new Error(`${operation} failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
}

/** Decode systemctl show key/value lines without shell or whitespace tokenization. */
export function parse_systemd_properties(output: string): Map<string, string> {
  return new Map(output.split("\n").filter((line) => line.includes("=")).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

/** Read only top-level launchctl fields, ignoring similarly named nested fields. */
export function launchd_field(output: string, key: string): string | undefined {
  return new RegExp(`^\\t${key} = (.*)$`, "mu").exec(output)?.[1]?.trim();
}

/** Verify launchd's exact argument vector; spaces remain part of each path. */
export function launchd_arguments(output: string): string[] | undefined {
  const block = /^\targuments = \{\n([\s\S]*?)^\t\}/mu.exec(output)?.[1];
  return block?.split("\n").filter((line) => line.trim()).map((line) => line.trim());
}

/** launchctl reports unknown services with a specific diagnostic and exit 113. */
export function is_missing_launchd_service(result: ServiceCommandResult): boolean {
  return result.code === 113 && /Could not find service ".+" in domain for /u.test(result.stderr);
}
