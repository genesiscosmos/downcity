/**
 * 宿主浏览器单实例模块桥接。代码只读取 Renderer 显式发布的公开 SDK 对象，
 * 不导入或构造 React 副本；Node 编译器与 Electron 协议使用同一模块路径。
 */
const react_exports = ["Children", "Component", "Fragment", "Profiler", "PureComponent", "StrictMode", "Suspense", "cloneElement", "createContext", "createElement", "createRef", "forwardRef", "isValidElement", "lazy", "memo", "startTransition", "use", "useActionState", "useCallback", "useContext", "useDebugValue", "useDeferredValue", "useEffect", "useEffectEvent", "useId", "useImperativeHandle", "useInsertionEffect", "useLayoutEffect", "useMemo", "useOptimistic", "useReducer", "useRef", "useState", "useSyncExternalStore", "useTransition", "version"];

/** 返回公开桥接模块源码，未知模块不提供任意宿主对象访问。 */
export function extension_browser_runtime_source(pathname: string): string | null {
  if (pathname === "/react") return bridge("__DOWNCITY_REACT__", react_exports, true);
  if (pathname === "/react/jsx-runtime") return bridge("__DOWNCITY_JSX_RUNTIME__", ["Fragment", "jsx", "jsxs"]);
  if (pathname === "/react/jsx-dev-runtime") return bridge("__DOWNCITY_JSX_DEV_RUNTIME__", ["Fragment", "jsxDEV"]);
  if (pathname === "/react-dom") return bridge("__DOWNCITY_REACT_DOM__", ["createPortal", "flushSync", "preconnect", "prefetchDNS", "preinit", "preinitModule", "preload", "preloadModule", "requestFormReset", "unstable_batchedUpdates", "useFormState", "useFormStatus", "version"], true);
  if (pathname === "/power-react") return bridge("__DOWNCITY_POWER_REACT__", ["define_power_renderer", "get_power_renderer_definition_error"]);
  return null;
}

function bridge(name: string, exports: readonly string[], default_export = false): string {
  return `const runtime=globalThis[${JSON.stringify(name)}];if(!runtime)throw new Error("Host browser runtime is unavailable");\n${exports.map((key) => `export const ${key}=runtime.${key};`).join("\n")}\n${default_export ? "export default runtime;" : ""}`;
}
