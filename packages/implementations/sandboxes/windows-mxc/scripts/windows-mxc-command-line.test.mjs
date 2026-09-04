/** @file 验证 Microsoft MXC 的 cmd.exe 命令行序列化。 */

import test from "node:test";
import assert from "node:assert/strict";
import { build_windows_cmd_command_line } from "../bin/WindowsMxcCommandLine.js";

test("MXC command line preserves cmd syntax and nested quotes", () => {
  assert.equal(
    build_windows_cmd_command_line(
      "C:\\Windows\\System32\\cmd.exe",
      'echo "hello world" && node -e "process.stdout.write(\'ok\')"',
    ),
    'C:\\Windows\\System32\\cmd.exe /d /s /c "echo "hello world" && node -e "process.stdout.write(\'ok\')""',
  );
});

test("MXC command line quotes an executable path containing spaces", () => {
  assert.equal(
    build_windows_cmd_command_line("C:\\Program Files\\cmd.exe", "echo ok"),
    '"C:\\Program Files\\cmd.exe" /d /s /c "echo ok"',
  );
});
