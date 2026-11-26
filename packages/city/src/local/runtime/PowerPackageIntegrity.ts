/** 预构建 Power 制品的共同完整性边界；安装器和运行宿主使用相同文件清单与摘要规则。 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { LocalPowerPackageManifest, LocalInstalledPowerDefinition } from "../types/LocalPower.js";
import { power_renderer_files, validate_power_renderers } from "../../power/RendererBindings.js";

/** 返回需要复制、校验的所有运行文件；配置永远由宿主独立持有。 */
export function power_package_files(definition: LocalPowerPackageManifest): string[] {
  const renderer_files = power_renderer_files(validate_power_renderers(definition.renderers));
  if (renderer_files.some((file) => ["power.json", "config.toml", "package.json"].includes(file.toLowerCase()))) throw new Error("Renderer resources cannot replace Power metadata or configuration");
  return [...new Set(["package.json", definition.readme, ...(definition.main ? [definition.main] : []), ...renderer_files,
    ...(definition.icon && !/^https?:\/\//iu.test(definition.icon) ? [definition.icon] : [])].map((file) => file.replace(/^\.\//u, "")))].sort();
}

/** 每一层都拒绝链接或路径逃逸，包含目录链接，避免校验后读取包外文件。 */
export async function resolve_power_package_file(root_input: string, relative_path: string): Promise<string> {
  const root = await fs.realpath(root_input);
  const filename = path.resolve(root, relative_path);
  const relative = path.relative(root, filename);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Power file must stay inside the package");
  let current = root;
  const parts = relative.split(path.sep);
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new Error(`Invalid Power package file: ${relative_path}`);
  }
  return filename;
}

/** 同时覆盖清单的协议/入口/能力绑定与全部声明资源，修改任意声明均改变摘要。 */
export async function calculate_local_power_integrity(root: string, definition: LocalPowerPackageManifest): Promise<string> {
  return (await read_power_package(root, definition)).integrity;
}

/** 返回与整包校验使用的同一份文件字节，不在校验后重新读取可能已被修改的文件。 */
export async function read_local_power_package_resource(root: string, definition: LocalInstalledPowerDefinition, resource: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!power_package_files(definition).includes(resource)) throw new Error("Undeclared Power resource");
  const result = await read_power_package(root, definition, resource);
  if (result.integrity !== definition.integrity || !result.contents) throw new Error(`Installed Power integrity check failed: ${definition.id}`);
  return result.contents;
}

/** 摘要和可选响应字节在同一次读取中产生，不保存额外的运行资源缓存。 */
async function read_power_package(root: string, definition: LocalPowerPackageManifest, resource?: string) {
  const hash = createHash("sha256");
  let contents: Uint8Array<ArrayBuffer> | undefined;
  hash.update(JSON.stringify({ id: definition.id, version: definition.version, main: definition.main, readme: definition.readme, icon: definition.icon, renderers: definition.renderers }));
  hash.update("\0");
  for (const relative_path of power_package_files(definition)) {
    const bytes = await fs.readFile(await resolve_power_package_file(root, relative_path));
    hash.update(relative_path);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
    if (relative_path === resource) contents = new Uint8Array(bytes);
  }
  return { integrity: `sha256-${hash.digest("hex")}`, contents };
}
