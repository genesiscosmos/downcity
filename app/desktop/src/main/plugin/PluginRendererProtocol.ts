/**
 * Plugin Renderer ESM 与宿主 React runtime 的受控协议。
 *
 * 协议只暴露当前已安装清单声明且通过完整性校验的 Renderer 单文件、图标，以及
 * 宿主提供的 React/JSX runtime shim。任意其他 Plugin 文件和目录都不会被响应。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { protocol } from "electron";
import {
  verify_local_installed_plugin_integrity,
  type LocalInstalledPluginDefinition,
} from "@downcity/local/product";
import type { DesktopLocalData } from "../agent/DesktopLocalData.js";

const plugin_renderer_scheme = "downcity-plugin";

/** React ESM shim；Renderer bundle 的 React import 统一落到宿主实例。 */
const react_runtime_source = `
const React = globalThis.__DOWNCITY_REACT__;
if (!React) throw new Error("Downcity React runtime is not available");
export const Children = React.Children;
export const Component = React.Component;
export const Fragment = React.Fragment;
export const Profiler = React.Profiler;
export const PureComponent = React.PureComponent;
export const StrictMode = React.StrictMode;
export const Suspense = React.Suspense;
export const cloneElement = React.cloneElement;
export const createContext = React.createContext;
export const createElement = React.createElement;
export const createRef = React.createRef;
export const forwardRef = React.forwardRef;
export const isValidElement = React.isValidElement;
export const lazy = React.lazy;
export const memo = React.memo;
export const startTransition = React.startTransition;
export const useCallback = React.useCallback;
export const useContext = React.useContext;
export const useDebugValue = React.useDebugValue;
export const useDeferredValue = React.useDeferredValue;
export const useEffect = React.useEffect;
export const useId = React.useId;
export const useImperativeHandle = React.useImperativeHandle;
export const useInsertionEffect = React.useInsertionEffect;
export const useLayoutEffect = React.useLayoutEffect;
export const useMemo = React.useMemo;
export const useReducer = React.useReducer;
export const useRef = React.useRef;
export const useState = React.useState;
export const useSyncExternalStore = React.useSyncExternalStore;
export const useTransition = React.useTransition;
export const version = React.version;
export default React;
`;

/** JSX runtime shim；自动 JSX 转换与宿主 React 使用同一元素协议。 */
const jsx_runtime_source = `
const runtime = globalThis.__DOWNCITY_JSX_RUNTIME__;
if (!runtime) throw new Error("Downcity JSX runtime is not available");
export const Fragment = runtime.Fragment;
export const jsx = runtime.jsx;
export const jsxs = runtime.jsxs;
`;

/** 在 Electron ready 前登记 Plugin Renderer 特权协议。 */
export function register_plugin_renderer_scheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: plugin_renderer_scheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
      stream: true,
    },
  }]);
}

/** 在 Electron ready 后绑定 Renderer 文件响应器。 */
export function register_plugin_renderer_protocol(data: DesktopLocalData): void {
  protocol.handle(plugin_renderer_scheme, async (request) => {
    const url = new URL(request.url);
    if (url.hostname === "runtime") return runtime_response(url.pathname);
    if (url.hostname !== "installed") return new Response("Not Found", { status: 404 });
    return await installed_plugin_response(data, url);
  });
}

/** 为已安装 Plugin 生成随完整性摘要变化的 Renderer URL。 */
export function create_installed_plugin_renderer_url(
  definition: LocalInstalledPluginDefinition,
): string | undefined {
  if (!definition.renderer) return undefined;
  return `${plugin_renderer_scheme}://installed/${encodeURIComponent(definition.id)}/${encodeURIComponent(definition.integrity)}/renderer.js`;
}

/** 为已安装 Plugin 生成受完整性保护的图标 URL。 */
export function create_installed_plugin_icon_url(
  definition: LocalInstalledPluginDefinition,
): string | undefined {
  if (!definition.icon) return undefined;
  if (/^https?:\/\//iu.test(definition.icon)) return definition.icon;
  return `${plugin_renderer_scheme}://installed/${encodeURIComponent(definition.id)}/${encodeURIComponent(definition.integrity)}/icon`;
}

/** 返回宿主 React runtime 的公开 shim。 */
function runtime_response(pathname: string): Response {
  if (pathname === "/react") return javascript_response(react_runtime_source);
  if (pathname === "/react/jsx-runtime") return javascript_response(jsx_runtime_source);
  return new Response("Not Found", { status: 404 });
}

/** 读取清单声明的 Renderer 或图标文件，并重新验证安装完整性。 */
async function installed_plugin_response(
  data: DesktopLocalData,
  url: URL,
): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length !== 3 || !["renderer.js", "icon"].includes(parts[2]!)) {
    return new Response("Bad Request", { status: 400 });
  }
  const [plugin_id, integrity, resource] = parts;
  const definition = data.plugins.get_installed(plugin_id!);
  if (!definition || definition.integrity !== integrity) {
    return new Response("Not Found", { status: 404 });
  }
  const plugin_root = data.plugins.plugin_path(definition.id);
  await verify_local_installed_plugin_integrity(plugin_root, definition);
  if (resource === "renderer.js") {
    if (!definition.renderer) return new Response("Not Found", { status: 404 });
    const renderer_path = resolve_plugin_file_path(plugin_root, definition.renderer.entry);
    return javascript_response(await fs.readFile(renderer_path, "utf8"));
  }
  if (!definition.icon || /^https?:\/\//iu.test(definition.icon)) {
    return new Response("Not Found", { status: 404 });
  }
  const icon_path = resolve_plugin_file_path(plugin_root, definition.icon);
  return new Response(new Uint8Array(await fs.readFile(icon_path)), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      "Content-Type": plugin_icon_content_type(definition.icon),
    },
  });
}

/** 安全解析清单已经声明并通过完整性校验的 Plugin 文件。 */
function resolve_plugin_file_path(plugin_root_input: string, relative_path: string): string {
  const plugin_root = path.resolve(plugin_root_input);
  const renderer_path = path.resolve(plugin_root, relative_path);
  if (renderer_path === plugin_root || !renderer_path.startsWith(`${plugin_root}${path.sep}`)) {
    throw new Error("Plugin renderer must stay inside the Plugin directory");
  }
  return renderer_path;
}

/** 根据受支持的图标扩展名生成稳定响应类型。 */
function plugin_icon_content_type(icon_path: string): string {
  const extension = path.extname(icon_path).toLowerCase();
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

/** 创建允许 Renderer 动态 import 的 JavaScript 响应。 */
function javascript_response(source: string): Response {
  return new Response(source, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/javascript; charset=utf-8",
    },
  });
}
