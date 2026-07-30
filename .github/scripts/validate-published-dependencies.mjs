/**
 * @file 校验 npm tarball 中引用的 Downcity 运行时依赖已经发布。
 *
 * 发布任务并行运行时，上层包必须等待其 Downcity 依赖出现在 Registry；如果依赖
 * 最终没有发布，本包必须失败而不能留下不可安装版本。
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const manifest_path = process.argv[2];
if (!manifest_path) {
  throw new Error("Usage: node validate-published-dependencies.mjs <package.json>");
}

const manifest = JSON.parse(readFileSync(manifest_path, "utf8"));
const dependency_fields = ["dependencies", "optionalDependencies", "peerDependencies"];
const dependencies = new Map();

for (const field_name of dependency_fields) {
  const field = manifest[field_name];
  if (!field || typeof field !== "object" || Array.isArray(field)) continue;
  for (const [dependency_name, dependency_range] of Object.entries(field)) {
    if (!dependency_name.startsWith("@downcity/") || typeof dependency_range !== "string") continue;
    dependencies.set(dependency_name, dependency_range);
  }
}

const max_attempts = read_positive_integer(process.env.DOWNCITY_DEPENDENCY_CHECK_ATTEMPTS, 30);
const retry_interval_ms = read_positive_integer(
  process.env.DOWNCITY_DEPENDENCY_CHECK_INTERVAL_MS,
  5_000,
);

for (const [dependency_name, dependency_range] of dependencies) {
  const dependency_spec = `${dependency_name}@${dependency_range}`;
  let published = false;
  for (let attempt = 1; attempt <= max_attempts; attempt += 1) {
    if (is_published(dependency_spec)) {
      published = true;
      break;
    }
    if (attempt < max_attempts) {
      console.log(
        `Waiting for ${dependency_spec} (${attempt}/${max_attempts})`,
      );
      await new Promise((resolve) => setTimeout(resolve, retry_interval_ms));
    }
  }
  if (!published) {
    throw new Error(
      `Refusing to publish ${manifest.name}@${manifest.version}: ${dependency_spec} is not published`,
    );
  }
  console.log(`Verified published dependency: ${dependency_spec}`);
}

/** 判断 npm Registry 是否存在满足版本范围的包。 */
function is_published(dependency_spec) {
  try {
    execFileSync("npm", ["view", dependency_spec, "version", "--json"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** 读取正整数环境变量。 */
function read_positive_integer(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
