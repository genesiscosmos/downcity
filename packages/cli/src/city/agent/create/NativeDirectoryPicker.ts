/**
 * 操作系统原生文件夹选择窗口适配器。
 *
 * macOS 使用 JXA Standard Additions `chooseFolder`，Windows 使用 FolderBrowserDialog，Linux 优先使用
 * Zenity 并回退 KDialog。调用方只接收目录或取消结果，不感知平台命令协议。
 */

import { execFile } from "node:child_process";
import path from "node:path";

/** 打开当前操作系统的原生文件夹选择窗口。 */
export async function pick_native_directory(
  initial_directory: string,
): Promise<string | null> {
  const resolved_initial_directory = path.resolve(initial_directory);
  switch (process.platform) {
    case "darwin":
      return await pick_macos_directory(resolved_initial_directory);
    case "win32":
      return await pick_windows_directory(resolved_initial_directory);
    case "linux":
      return await pick_linux_directory(resolved_initial_directory);
    default:
      throw new Error(
        `Native folder picker is not supported on ${process.platform}`,
      );
  }
}

/** 使用 macOS 标准 choose folder 窗口选择目录。 */
async function pick_macos_directory(
  initial_directory: string,
): Promise<string | null> {
  const script = [
    "function run(argv) {",
    "const app = Application.currentApplication();",
    "app.includeStandardAdditions = true;",
    "const folder = app.chooseFolder({",
    "withPrompt: 'Select Agent Workspace',",
    "defaultLocation: Path(argv[0]),",
    "});",
    "return folder.toString();",
    "}",
  ].join("\n");
  try {
    return normalize_selected_directory(
      await exec_file_text(
        "/usr/bin/osascript",
        ["-l", "JavaScript", "-e", script, initial_directory],
      ),
    );
  } catch (error) {
    if (is_cancelled_process(error, /user canceled|-128/i)) return null;
    throw error;
  }
}

/** 使用 Windows Forms 原生文件夹选择窗口选择目录。 */
async function pick_windows_directory(
  initial_directory: string,
): Promise<string | null> {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = 'Select Agent Workspace'",
    "$dialog.SelectedPath = $env:DOWNCITY_INITIAL_DIRECTORY",
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  [Console]::Out.Write($dialog.SelectedPath)",
    "  exit 0",
    "}",
    "exit 2",
  ].join("\n");
  try {
    return normalize_selected_directory(
      await exec_file_text(
        "powershell.exe",
        ["-NoProfile", "-STA", "-Command", script],
        { DOWNCITY_INITIAL_DIRECTORY: initial_directory },
      ),
    );
  } catch (error) {
    if (read_process_exit_code(error) === 2) return null;
    throw error;
  }
}

/** 使用 Linux 桌面环境的 Zenity 或 KDialog 文件夹选择窗口。 */
async function pick_linux_directory(
  initial_directory: string,
): Promise<string | null> {
  try {
    return normalize_selected_directory(
      await exec_file_text("zenity", [
        "--file-selection",
        "--directory",
        "--title=Select Agent Workspace",
        `--filename=${initial_directory}${path.sep}`,
      ]),
    );
  } catch (error) {
    if (read_process_exit_code(error) === 1) return null;
    if (!is_command_missing(error)) throw error;
  }

  try {
    return normalize_selected_directory(
      await exec_file_text("kdialog", [
        "--getexistingdirectory",
        initial_directory,
        "--title",
        "Select Agent Workspace",
      ]),
    );
  } catch (error) {
    if (read_process_exit_code(error) === 1) return null;
    if (is_command_missing(error)) {
      throw new Error(
        "No native folder picker is available. Install Zenity or KDialog, or pass a path to `city agent create`.",
      );
    }
    throw error;
  }
}

/** 无 shell 地执行系统选择器并读取标准输出。 */
function exec_file_text(
  command: string,
  args: string[],
  extra_env: Record<string, string> = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      encoding: "utf8",
      env: { ...process.env, ...extra_env },
      maxBuffer: 1024 * 1024,
      windowsHide: false,
    }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

/** 标准化系统窗口返回的目录。 */
function normalize_selected_directory(value: string): string | null {
  const selected_directory = String(value || "").trim();
  return selected_directory ? path.resolve(selected_directory) : null;
}

/** 判断系统进程是否表示用户主动取消。 */
function is_cancelled_process(error: unknown, message_pattern: RegExp): boolean {
  return read_process_exit_code(error) !== null && message_pattern.test(String(error));
}

/** 读取 child_process 错误中的退出码。 */
function read_process_exit_code(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

/** 判断系统是否没有安装指定选择器命令。 */
function is_command_missing(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === "ENOENT",
  );
}
