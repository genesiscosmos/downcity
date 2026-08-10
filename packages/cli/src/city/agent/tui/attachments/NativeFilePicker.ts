/**
 * city agent chat TUI 原生文件选择器。
 *
 * 统一返回绝对文件路径；平台命令、取消语义和多选差异全部收敛在本模块。
 */

import { execFile } from "node:child_process";
import path from "node:path";

/** 打开系统文件选择器并返回用户选择的文件。取消时返回空数组。 */
export async function pick_native_files(initial_directory: string): Promise<string[]> {
  const resolved_directory = path.resolve(initial_directory);
  switch (process.platform) {
    case "darwin":
      return await pick_macos_files(resolved_directory);
    case "win32":
      return await pick_windows_files(resolved_directory);
    case "linux":
      return await pick_linux_files(resolved_directory);
    default:
      throw new Error(`Native file picker is not supported on ${process.platform}`);
  }
}

async function pick_macos_files(initial_directory: string): Promise<string[]> {
  const script = [
    "try",
    `set selected_files to choose file with prompt \"Attach files\" default location POSIX file \"${escape_applescript(initial_directory)}\" with multiple selections allowed`,
    "set output_text to \"\"",
    "repeat with selected_file in selected_files",
    "set output_text to output_text & POSIX path of selected_file & linefeed",
    "end repeat",
    "return output_text",
    "on error number -128",
    "return \"\"",
    "end try",
  ].join("\n");
  const output = await exec_file_text("/usr/bin/osascript", ["-e", script]);
  return normalize_paths(output);
}

async function pick_windows_files(initial_directory: string): Promise<string[]> {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
    "$dialog.Title = 'Attach files'",
    "$dialog.InitialDirectory = $env:DOWNCITY_INITIAL_DIRECTORY",
    "$dialog.Multiselect = $true",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  $dialog.FileNames | ForEach-Object { [Console]::Out.WriteLine($_) }",
    "}",
  ].join("\n");
  const output = await exec_file_text("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
    DOWNCITY_INITIAL_DIRECTORY: initial_directory,
  });
  return normalize_paths(output);
}

async function pick_linux_files(initial_directory: string): Promise<string[]> {
  try {
    const output = await exec_file_text("zenity", [
      "--file-selection",
      "--multiple",
      "--separator=\n",
      "--title=Attach files",
      `--filename=${initial_directory}${path.sep}`,
    ]);
    return normalize_paths(output);
  } catch (error) {
    if (!is_command_missing(error) && read_process_exit_code(error) !== 1) throw error;
  }
  try {
    const output = await exec_file_text("kdialog", ["--getopenfilename", initial_directory, "*", "Attach files"]);
    return normalize_paths(output);
  } catch (error) {
    if (read_process_exit_code(error) === 1) return [];
    if (is_command_missing(error)) {
      throw new Error("No native file picker is available. Install Zenity or KDialog.");
    }
    throw error;
  }
}

function exec_file_text(command: string, args: string[], extra_env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      encoding: "utf8",
      env: { ...process.env, ...extra_env },
      maxBuffer: 1024 * 1024,
      windowsHide: false,
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

function normalize_paths(value: string): string[] {
  return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean).map((item) => path.resolve(item));
}

function escape_applescript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"");
}

function read_process_exit_code(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

function is_command_missing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT");
}
