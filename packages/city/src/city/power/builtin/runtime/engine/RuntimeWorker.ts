/** 可信 Worker 外壳：编译与 WASM 在此线程中运行；只有显式 JSON bridge 进入 QuickJS。 */
import { SourceMap } from "node:module";
import { parentPort } from "node:worker_threads";
import { newQuickJSWASMModule, newVariant, RELEASE_SYNC } from "quickjs-emscripten";
import type { QuickJSHandle, QuickJSDeferredPromise } from "quickjs-emscripten";
import { compile_cell } from "./CompileCell.js";
import type { EngineInput } from "../types/Runtime.js";

const port = parentPort!;
const wasm_api = (globalThis as unknown as import("../types/EngineHost.js").EngineWasmHost).WebAssembly;
const wasm_memory = new wasm_api.Memory({ initial: 256, maximum: 2048 });
const module = await newQuickJSWASMModule(newVariant(RELEASE_SYNC, { emscriptenModule: { wasmMemory: wasm_memory } }));
// 实测且强制核对绑定内存；依赖升级不能悄悄退回无界线性内存。
if (module.getWasmMemory().buffer !== wasm_memory.buffer) throw new Error("engine_memory_limit_unavailable");
const runtime = module.newRuntime();
runtime.setMemoryLimit(64 * 1024 * 1024);
runtime.setMaxStackSize(512 * 1024);
const context = runtime.newContext();
const pending = new Map<number, QuickJSDeferredPromise>();
let call_sequence = 0;
let execution_id = "";
let result_handle: QuickJSHandle | undefined;
let log_bytes = 0;
let logs: string[] = [];
let closed = true;
let source_map: SourceMap | undefined;
let generated_line_offset = 0;
let cpu_budget_ms = 15_000;
let cpu_deadline = Infinity;
runtime.setInterruptHandler(() => Date.now() >= cpu_deadline);

/** 将 QuickJS 产物位置映射回用户本次源码；async 包装占源文件第一行。 */
function script_error(value: unknown): string {
  const text = JSON.stringify(value);
  if (text.includes('"message":"interrupted"')) return "execution_timeout: script CPU budget exhausted";
  return `script_error: ${text}`.replace(/downcity-cell\.js:(\d+)(?::(\d+))?/gu, (_match, line, column) => {
    const entry = source_map?.findEntry(Number(line) - 1 - generated_line_offset, Number(column ?? 1_000_000) - 1);
    return entry && "originalLine" in entry && Number.isFinite(entry.originalLine) ? `source:${Math.max(1, entry.originalLine)}:${entry.originalColumn + 1}` : `generated:${line}:${column ?? 1}`;
  });
}

/** 有界 Promise job 泵；同步死循环由父线程预算到期 terminate 硬中断。 */
function pump(): void {
  if (!result_handle) return;
  cpu_deadline = Date.now() + cpu_budget_ms;
  const jobs = runtime.executePendingJobs(64);
  if (jobs.error) { const error = context.dump(jobs.error); jobs.error.dispose(); finish(undefined, script_error(error)); return; }
  const state = context.getPromiseState(result_handle);
  if (state.type === "fulfilled") {
    try { const text = context.getString(state.value); if (Buffer.byteLength(text) > 1024 * 1024) throw new Error("result frame exceeds 1 MiB"); finish(JSON.parse(text)); }
    catch (error) { finish(undefined, `serialization_error: ${String(error)}`); }
    finally { state.value.dispose(); }
  } else if (state.type === "rejected") {
    const error = context.dump(state.error);
    state.error.dispose();
    finish(undefined, script_error(error));
  }
}

/** 终态关闭旧桥；尚未 await 的调用留给宿主记录真实结果，不开启后台身份。 */
function finish(value: unknown, error?: string): void {
  closed = true;
  result_handle?.dispose(); result_handle = undefined;
  port.postMessage({ type: "result", execution_id, result: { value: value ?? null, logs, ...(error ? { error: error.slice(0, 8192) } : {}) } });
}

/** 每个 cell 单独创建捕获身份的 binding；保存旧闭包也不能借用下一次身份。 */
function install_bindings(bound_id: string): void {
const rpc = context.newFunction("rpc", (symbol, input) => {
  if (closed || bound_id !== execution_id) return { error: context.newError("execution_cancelled: expired execution binding") };
  if (pending.size >= 16) return { error: context.newError("runtime_busy: at most 16 pending SDK calls") };
  const text = context.getString(input);
  if (Buffer.byteLength(text) > 1024 * 1024) return { error: context.newError("serialization_error: bridge frame exceeds 1 MiB") };
  const deferred = context.newPromise();
  const call_id = ++call_sequence;
  pending.set(call_id, deferred);
  port.postMessage({ type: "call", execution_id, call_id, symbol: context.getString(symbol), input: JSON.parse(text) });
  return deferred.handle;
});
const log = context.newFunction("log", value => {
  const text = context.getString(value);
  const bytes = Buffer.byteLength(text);
  if (!closed && bound_id === execution_id && log_bytes + bytes <= 64 * 1024) { logs.push(text); log_bytes += bytes; }
});
context.setProp(context.global, "__rpc", rpc); rpc.dispose();
context.setProp(context.global, "__log", log); log.dispose();
}
context.unwrapResult(context.evalCode("Object.defineProperty(globalThis, 'state', { value: Object.create(null), writable: false, configurable: false })")).dispose();

port.on("message", (message) => {
  if (message.type === "reply") {
    const deferred = pending.get(message.call_id);
    if (!deferred) return;
    pending.delete(message.call_id);
    const value = context.newString(JSON.stringify(message.error ? { error: message.error } : { value: message.value ?? null }));
    deferred.resolve(value); value.dispose(); deferred.dispose();
    pump();
    return;
  }
  if (message.type !== "execute" || !closed) return;
  const input = message.input as EngineInput;
  execution_id = input.execution_id; logs = []; log_bytes = 0;
  cpu_budget_ms = input.timeout_ms;
  try {
    const compiled = compile_cell(input.code, input.language, input.declarations);
    source_map = new SourceMap(JSON.parse(compiled.source_map));
    const cell_javascript = compiled.javascript.replace(/__cell\(\);?\s*(\/\/# sourceMappingURL=.*)?$/u, "return __cell().then(__encode_result);");
    closed = false;
    const symbols = ["help", ...input.descriptors.map(item => item.symbol)];
    // rpc 仅存在于闭包内；保存旧 client 的异步任务仍绑定旧 execution_id。
    install_bindings(execution_id);
    const bootstrap = `(function(rpc, log, symbols) {
      delete globalThis.__rpc; delete globalThis.__log;
      const stringify = JSON.stringify;
      const parse = JSON.parse;
      const keys = Object.keys;
      const seen = new Set();
      function encode(value) {
        const seen = new Set();
        function check(item) {
          if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
          if (typeof item === 'number' && Number.isFinite(item)) return;
          if (typeof item !== 'object') throw Error('serialization_error: return a JSON value');
          const prototype = Object.getPrototypeOf(item);
          if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) throw Error('serialization_error: return plain JSON data, not promises or live objects');
          if (seen.has(item)) throw Error('serialization_error: cycle');
          seen.add(item); for(const key of keys(item)) check(item[key]); seen.delete(item);
        }
        check(value); return stringify(value);
      }
      function bind_object(symbols, prefix = '') {
        const object = Object.create(null);
        for(const symbol of symbols) {
          const parts = symbol.split('.'); let node = object;
          for(const part of parts.slice(0,-1)) node = node[part] ||= Object.create(null);
          node[parts[parts.length-1]] = async (input = {}) => {
            const result = parse(await rpc(prefix + symbol, encode(input)));
            if(result.error) throw Error(result.error);
            const value = result.value;
            return value && typeof value.__downcity_object === 'string' && Array.isArray(value.methods)
              ? bind_object(value.methods, value.__downcity_object + '.') : value;
          };
        }
        return object;
      }
      const downcity = bind_object(symbols);
      const console = Object.fromEntries(['log','info','warn','error'].map(level => [level, (...values) => log(level + ': ' + values.map(value => {try{return encode(value)}catch{return String(value)}}).join(' '))]));
      const __encode_result = value => encode(value === undefined ? null : value);
      ${cell_javascript}
    })(__rpc, __log, ${JSON.stringify(symbols)});`;
    generated_line_offset = bootstrap.slice(0, bootstrap.indexOf(cell_javascript)).split("\n").length - 1;
    cpu_deadline = Date.now() + cpu_budget_ms;
    const result = context.evalCode(bootstrap, "downcity-cell.js");
    if (result.error) { const error = context.dump(result.error); result.error.dispose(); finish(undefined, script_error(error)); }
    else { result_handle = result.value; pump(); }
  } catch (error) { finish(undefined, String(error)); }
});
const job_timer = setInterval(pump, 5);
job_timer.unref();
port.postMessage({ type: "ready" });
