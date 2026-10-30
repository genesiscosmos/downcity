/**
 * Render path-only user service definitions. No command execution or environment secrets.
 * systemd arguments use its own C-style quoting, specifier and dollar escaping;
 * launchd arguments remain separate XML strings. Supervisor output goes to the
 * launchd log path or systemd journal, including errors before config is read.
 * The runner owns application logs, working directory and the launchd rate limit.
 */
import type { SystemServiceInfo, SystemServiceSpec } from "./SystemServiceAdapter.js";

/** Quote one systemd ExecStart argument without invoking a shell. */
export function quote_systemd_argument(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')
    .replace(/%/gu, "%%").replace(/\$/gu, "$$$$")}"`;
}

/** Escape an XML text node; arguments never pass through shell interpolation. */
function escape_xml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&apos;");
}

/** Render a complete definition; equality is also the strict ownership check. */
export function render_system_service(spec: SystemServiceSpec, info: SystemServiceInfo): string {
  const arguments_list = [spec.node_path, spec.runner_path, "--config", spec.config_path];
  if (info.manager === "systemd") {
    return [
      "# Managed by Downcity Federation; runner owns logging and working directory.",
      "[Unit]", `Description=Downcity Federation ${info.id}`,
      "StartLimitIntervalSec=60", "StartLimitBurst=5", "", "[Service]", "Type=simple",
      `ExecStart=${arguments_list.map(quote_systemd_argument).join(" ")}`,
      `Restart=${spec.restart_on_failure ? "on-failure" : "no"}`, "RestartSec=10",
      "TimeoutStopSec=15", "KillMode=control-group",
      "StandardOutput=journal", "StandardError=journal", "", "[Install]", "WantedBy=default.target", "",
    ].join("\n");
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    `<key>Label</key><string>${escape_xml(info.id)}</string>`,
    "<key>ProgramArguments</key><array>",
    ...arguments_list.map((argument) => `<string>${escape_xml(argument)}</string>`),
    "</array>", `<key>RunAtLoad</key><${spec.auto_start ? "true" : "false"}/>`,
    spec.restart_on_failure
      ? "<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>"
      : "<key>KeepAlive</key><false/>",
    "<key>ThrottleInterval</key><integer>10</integer>",
    "<key>ExitTimeOut</key><integer>15</integer>",
    `<key>StandardOutPath</key><string>${escape_xml(spec.log_path)}</string>`,
    `<key>StandardErrorPath</key><string>${escape_xml(spec.log_path)}</string>`,
    "</dict></plist>", "",
  ].join("\n");
}

/** Accept only definitions this renderer could produce for the exact paths. */
export function is_owned_definition(content: string, spec: SystemServiceSpec, info: SystemServiceInfo): boolean {
  return [false, true].some((auto_start) => [false, true].some((restart_on_failure) =>
    render_system_service({ ...spec, auto_start, restart_on_failure }, info) === content));
}
