/** 浏览器入口必须能在禁止 Node 内置模块的独立进程中加载，覆盖静态导出的完整依赖链。 */
import test from "node:test";
import { execFileSync as exec_file_sync } from "node:child_process";

for (const entry_path of ["../bin/session/index.js", "../bin/browser.js"]) {
  test(`${entry_path} 不依赖 Node 内置模块`, () => {
    const entry_url = new URL(entry_path, import.meta.url).href;
    exec_file_sync(process.execPath, ["--input-type=module", "--eval", `
      import { isBuiltin as is_builtin, registerHooks as register_hooks } from "node:module";
      register_hooks({
        resolve(specifier, context, next_resolve) {
          if (is_builtin(specifier)) throw new Error("browser_entry_imports_node_builtin: " + specifier);
          return next_resolve(specifier, context);
        },
      });
      await import(${JSON.stringify(entry_url)});
    `], { encoding: "utf8", stdio: "pipe" });
  });
}
