/** Microsoft MXC 的 cmd.exe 命令行序列化。 */

function quote_windows_executable_path(value: string): string {
  if (!/[\s"]/u.test(value)) return value;
  let result = '"';
  let backslashes = 0;
  for (const character of value) {
    if (character === "\\") {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      result += "\\".repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    result += "\\".repeat(backslashes) + character;
    backslashes = 0;
  }
  return result + "\\".repeat(backslashes * 2) + '"';
}

/** 构造 MXC `CreateProcess` 使用的 `cmd.exe` 完整命令行。 */
export function build_windows_cmd_command_line(shell_path: string, cmd: string): string {
  return `${quote_windows_executable_path(shell_path)} /d /s /c "${cmd}"`;
}
