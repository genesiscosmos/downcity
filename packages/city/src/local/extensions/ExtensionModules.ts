/**
 * 按当前安装的公开 exports 解析宿主模块。Node 与浏览器必须分别提供映射，
 * 不把构建仓库相对路径或作者 node_modules 当成宿主 SDK。
 */
import { fileURLToPath } from "node:url";
import { ExtensionFailure } from "./ExtensionError.js";

/** 独立 Node 安装可用的模块映射；Electron 组合根需提供其实际共享 SDK 模块。 */
export function resolve_extension_host_modules(): Readonly<Record<string, string>> {
  const modules: Record<string, string> = {};
  for (const specifier of ["@downcity/agent", "@downcity/type", "@downcity/downtown", "@downcity/city", "@downcity/city/power", "@downcity/city/power/react", "@downcity/city/local", "@downcity/city/extensions", "@downcity/agent/tools", "react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"]) {
    try { modules[specifier] = fileURLToPath(import.meta.resolve(specifier)); }
    catch {
      if (specifier.startsWith("react") || specifier === "@downcity/city/extensions") continue;
      throw new ExtensionFailure("sdk_unavailable", `Host SDK module is unavailable: ${specifier}`, "compile", 5);
    }
  }
  return Object.freeze(modules);
}
