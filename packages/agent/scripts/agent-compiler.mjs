import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * Agent compiler：统一处理 text module 生成、build、typecheck 与 dev watch。
 *
 * 关键点（中文）
 * - `*.ts.txt` 是 prompt 文本源码；生成后得到同路径的 `*.ts` 模块。
 * - runtime / bundler 只依赖生成后的 TS 模块，不再读取文本文件。
 * - build / typecheck / dev 全部收敛到一个脚本入口，减少流程分叉。
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const module_require = createRequire(import.meta.url);
const packageRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(packageRoot, "src");
const tsc_entry = module_require.resolve("typescript/bin/tsc");
const tsc_alias_entry = module_require.resolve("tsc-alias/dist/bin/index.js");
const rewrite_alias_script = path.join(packageRoot, "scripts/rewrite-build-aliases.mjs");
const verify_alias_script = path.join(packageRoot, "scripts/verify-build-aliases.mjs");
const generatedHeader = [
  "/**",
  " * 自动生成文件，请勿手改。",
  " * 源文件：由同路径 `*.ts.txt` 生成。",
  " */",
  "",
].join("\n");

function toPosixRelative(filePath) {
  return path.relative(packageRoot, filePath).split(path.sep).join("/");
}

async function collectTextModuleSources(rootDir) {
  const out = [];

  async function walk(currentDir) {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }
      if (entry.isFile() && absPath.endsWith(".ts.txt")) {
        out.push(absPath);
      }
    }
  }

  await walk(rootDir);
  return out.sort();
}

function renderGeneratedTextModule(params) {
  const { sourcePath, rawText } = params;
  return [
    generatedHeader,
    `// Source: ${toPosixRelative(sourcePath)}`,
    `const TEXT_MODULE_CONTENT = ${JSON.stringify(rawText)};`,
    "",
    "export default TEXT_MODULE_CONTENT;",
    "",
  ].join("\n");
}

async function writeGeneratedModule(sourcePath) {
  const targetPath = sourcePath.slice(0, -4);
  const rawText = await fsp.readFile(sourcePath, "utf-8");
  const rendered = renderGeneratedTextModule({
    sourcePath,
    rawText,
  });
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const previous = await fsp.readFile(targetPath, "utf-8").catch(() => null);
  if (previous === rendered) return false;
  await fsp.writeFile(targetPath, rendered, "utf-8");
  return true;
}

async function generateTextModules() {
  const sourceFiles = await collectTextModuleSources(srcRoot);
  let updatedCount = 0;
  for (const sourcePath of sourceFiles) {
    const changed = await writeGeneratedModule(sourcePath);
    if (changed) updatedCount += 1;
  }
  return {
    sourceCount: sourceFiles.length,
    updatedCount,
  };
}

function spawnCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      stdio: "inherit",
      env: process.env,
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited with signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${String(code)}`));
        return;
      }
      resolve();
    });
  });
}

async function runBuild() {
  await generateTextModules();
  await Promise.all([
    fsp.rm(path.join(packageRoot, "bin"), { recursive: true, force: true }),
    fsp.rm(path.join(packageRoot, "tsconfig.tsbuildinfo"), { force: true }),
  ]);
  await spawnCommand(process.execPath, [tsc_entry]);
  await spawnCommand(process.execPath, [tsc_alias_entry, "-f"]);
  await spawnCommand(process.execPath, [rewrite_alias_script]);
  await spawnCommand(process.execPath, [verify_alias_script]);
}

async function runTypecheck() {
  await generateTextModules();
  await spawnCommand(process.execPath, [tsc_entry, "--noEmit"]);
}

async function runDev() {
  await generateTextModules();

  const watchers = [];
  const watchedDirs = new Set();
  let regenerateTimer = null;
  let generating = Promise.resolve();
  let rerunRequested = false;

  async function collectDirectories(rootDir) {
    const directories = [];
    async function walk(currentDir) {
      directories.push(currentDir);
      const entries = await fsp.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        await walk(path.join(currentDir, entry.name));
      }
    }
    await walk(rootDir);
    return directories;
  }

  async function attachWatchers() {
    const directories = await collectDirectories(srcRoot);
    for (const dirPath of directories) {
      if (watchedDirs.has(dirPath)) continue;
      const watcher = fs.watch(dirPath, (_eventType, filename) => {
        const normalized = filename
          ? Buffer.isBuffer(filename)
            ? filename.toString("utf-8")
            : String(filename)
          : "";
        if (!normalized.endsWith(".ts.txt")) return;
        scheduleGenerate();
      });
      watchers.push(watcher);
      watchedDirs.add(dirPath);
    }
  }

  async function regenerate() {
    try {
      const result = await generateTextModules();
      if (result.updatedCount > 0) {
        console.log(
          `[agent-compiler] regenerated ${String(result.updatedCount)} of ${String(result.sourceCount)} text module(s)`,
        );
      }
      await attachWatchers();
    } catch (error) {
      console.error("[agent-compiler] regenerate failed");
      console.error(error);
    }
  }

  function runRegenerateQueue() {
    generating = generating.finally(async () => {
      await regenerate();
      if (!rerunRequested) return;
      rerunRequested = false;
      runRegenerateQueue();
    });
  }

  function scheduleGenerate() {
    if (regenerateTimer) clearTimeout(regenerateTimer);
    regenerateTimer = setTimeout(() => {
      regenerateTimer = null;
      if (generating && generating !== Promise.resolve()) {
        rerunRequested = true;
      }
      runRegenerateQueue();
    }, 120);
  }

  await attachWatchers();
  const tscWatch = spawn(process.execPath, [tsc_entry, "--watch"], {
    cwd: packageRoot,
    stdio: "inherit",
    env: process.env,
  });

  const shutdown = () => {
    for (const watcher of watchers) watcher.close();
    if (!tscWatch.killed) {
      tscWatch.kill("SIGINT");
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise((resolve, reject) => {
    tscWatch.on("error", reject);
    tscWatch.on("exit", (code, signal) => {
      shutdown();
      if (signal && signal !== "SIGINT" && signal !== "SIGTERM") {
        reject(new Error(`tsc --watch exited with signal ${signal}`));
        return;
      }
      if (code && code !== 0) {
        reject(new Error(`tsc --watch exited with code ${String(code)}`));
        return;
      }
      resolve();
    });
  });
}

const mode = String(process.argv[2] || "build").trim().toLowerCase();

if (mode === "build") {
  await runBuild();
} else if (mode === "typecheck") {
  await runTypecheck();
} else if (mode === "dev") {
  await runDev();
} else if (mode === "generate") {
  const result = await generateTextModules();
  console.log(
    `[agent-compiler] generated ${String(result.sourceCount)} text module(s), updated ${String(result.updatedCount)}`,
  );
} else {
  console.error(`Unknown mode: ${mode}`);
  process.exit(1);
}
