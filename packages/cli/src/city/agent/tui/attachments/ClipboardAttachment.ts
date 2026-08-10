/**
 * city agent chat TUI 剪贴板附件适配器。
 *
 * 只依赖系统已有命令；命令不存在或剪贴板不是附件时返回空结果，交给输入框继续普通粘贴。
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec_file = promisify(execFile);

/** 读取剪贴板中的本地文件或图片路径。 */
export async function read_clipboard_attachment_paths(): Promise<string[]> {
  const file_paths = await read_clipboard_file_paths();
  if (file_paths.length > 0) return file_paths;
  const image_path = path.join(os.tmpdir(), `downcity-clipboard-${Date.now()}.png`);
  try {
    await write_clipboard_image(image_path);
    await fs.access(image_path);
    return [image_path];
  } catch {
    await fs.rm(image_path, { force: true }).catch(() => undefined);
    return [];
  }
}

async function read_clipboard_file_paths(): Promise<string[]> {
  try {
    const command = process.platform === "win32"
      ? "powershell.exe"
      : process.platform === "linux"
        ? "wl-paste"
        : "pbpaste";
    const args = process.platform === "win32"
      ? ["-NoProfile", "-Command", "Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }"]
      : process.platform === "linux"
        ? ["--no-newline"]
        : [];
    const { stdout } = await exec_file(command, args, { encoding: "utf8", maxBuffer: 1024 * 1024 });
    return String(stdout)
      .split(/\r?\n/)
      .map((value) => value.trim().replace(/^file:\/\//, ""))
      .filter(Boolean)
      .filter((value) => path.isAbsolute(value));
  } catch {
    return [];
  }
}

/** 将当前平台剪贴板图片保存为 PNG。 */
async function write_clipboard_image(image_path: string): Promise<void> {
  if (process.platform === "darwin") {
    try {
      await exec_file("pngpaste", [image_path], { maxBuffer: 20 * 1024 * 1024 });
      return;
    } catch {
      const script = [
        "set image_data to the clipboard as «class PNGf»",
        "set output_file to open for access POSIX file (item 1 of argv) with write permission",
        "set eof output_file to 0",
        "write image_data to output_file",
        "close access output_file",
      ].join("\n");
      await exec_file("/usr/bin/osascript", ["-e", `on run argv\n${script}\nend run`, image_path], {
        maxBuffer: 1024 * 1024,
      });
    }
    return;
  }
  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$image = [Windows.Forms.Clipboard]::GetImage()",
      "if ($null -eq $image) { exit 2 }",
      "$image.Save($env:DOWNCITY_CLIPBOARD_IMAGE_PATH)",
    ].join("\n");
    await exec_file("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
      env: { ...process.env, DOWNCITY_CLIPBOARD_IMAGE_PATH: image_path },
      maxBuffer: 1024 * 1024,
    });
    return;
  }
  if (process.platform === "linux") {
    const { stdout } = await exec_file("wl-paste", ["--type", "image/png"], {
      encoding: "buffer",
      maxBuffer: 20 * 1024 * 1024,
    });
    await fs.writeFile(image_path, stdout);
    return;
  }
  throw new Error(`Clipboard images are not supported on ${process.platform}`);
}
