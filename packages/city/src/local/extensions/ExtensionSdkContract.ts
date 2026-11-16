/**
 * 受管项目必须接受实际宿主 SDK/React 版本，不能因项目另装副本产生运行分叉。
 * 使用固定 npm 工具内置的 semver 解析标准范围，不执行作者指定工具或源码。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { ExtensionFailure } from "./ExtensionError.js";
const require = createRequire(import.meta.url);
const semver = createRequire(require.resolve("npm/package.json"))("semver");

/** 只读取依赖声明和宿主清单，作者实际解析版本不能替代宿主版本。 */
export async function assert_extension_sdk_contract(source_path: string, host_modules: Readonly<Record<string, string>>): Promise<void> {
  const manifest = await fs.readFile(path.join(source_path, "package.json"), "utf8").then((text) => JSON.parse(text), () => null);
  if (!manifest) return;
  const declarations = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies };
  for (const [name, range] of Object.entries(declarations)) {
    if (!name.startsWith("@downcity/") && !["react", "react-dom"].includes(name)) continue;
    const module_path = host_modules[name];
    if (!module_path) throw new ExtensionFailure("sdk_incompatible", `Host does not expose declared SDK package: ${name}`, "dependencies", 2);
    let directory = path.dirname(module_path);
    let version: string | undefined;
    while (directory !== path.dirname(directory)) {
      const candidate = await fs.readFile(path.join(directory, "package.json"), "utf8").then((text) => JSON.parse(text), () => null);
      if (candidate?.name === name) { version = candidate.version; break; }
      directory = path.dirname(directory);
    }
    if (!version || typeof range !== "string" || !semver.validRange(range) || !semver.satisfies(version, range, { includePrerelease: true })) throw new ExtensionFailure("sdk_incompatible", `Declared ${name} range is incompatible with the host`, "dependencies", 2, { package: name, host_version: version ?? "unavailable" });
  }
}
