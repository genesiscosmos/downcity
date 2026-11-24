/** Node Worker 外壳的 WASM 类型；不将 DOM 标准库暴露给脚本。 */
import type { QuickJSWASMModule } from "quickjs-emscripten";

/** 仅包含构造有界内存所需的宿主全局协议。 */
export interface EngineWasmHost {
  /** Node 提供的 WASM 宿主 API。 */
  readonly WebAssembly: {
    /** 创建带最大页数的线性内存，每页 64 KiB。 */
    readonly Memory: new (limits: {
      /** 初始页数。 */
      initial: number;
      /** 不可增长超过的页数。 */
      maximum: number;
    }) => ReturnType<QuickJSWASMModule["getWasmMemory"]>;
  };
}
