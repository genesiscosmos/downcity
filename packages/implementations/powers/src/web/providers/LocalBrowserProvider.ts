/**
 * 自动启动本地 Chrome/Chromium 的 BrowserProvider。
 *
 * 关键点（中文）
 * - 使用 Power 私有目录中的持久 profile，保留用户主动建立的登录状态。
 * - Provider 只终止自己启动的进程；崩溃后残留且仍可连接的浏览器仅作为外部 CDP 使用。
 * - 浏览器动作仍统一委托给 PlaywrightBrowserProvider，避免形成第二套页面协议。
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { access, mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  BrowserActInput,
  BrowserCloseSessionInput,
  BrowserCreateSessionInput,
  BrowserExtractInput,
  BrowserExtractResult,
  BrowserObservation,
  BrowserObserveInput,
  BrowserProvider,
} from "@/web/types/WebPower.js";
import type { LocalBrowserProviderOptions } from "@/web/types/WebProviderOptions.js";
import { PlaywrightBrowserProvider } from "@/web/providers/PlaywrightBrowserProvider.js";

const STARTUP_FILE = "DevToolsActivePort";
const DEFAULT_TIMEOUT_MS = 30_000;

/** 拥有本地浏览器进程并暴露统一 BrowserProvider 协议。 */
export class LocalBrowserProvider implements BrowserProvider {
  readonly name = "local-chromium";

  /** 实际执行页面动作的 CDP Provider。 */
  private delegate: PlaywrightBrowserProvider | null = null;
  /** 当前实例自己启动的浏览器进程。 */
  private browser_process: ChildProcess | null = null;
  /** 并发启动共享的初始化 Promise。 */
  private initialization: Promise<PlaywrightBrowserProvider> | null = null;
  /** Provider 是否已释放。 */
  private disposed = false;

  constructor(private readonly options: LocalBrowserProviderOptions) {
    if (!path.isAbsolute(options.profile_path)) {
      throw new TypeError("LocalBrowserProvider profile_path must be absolute");
    }
  }

  async create_session(input: BrowserCreateSessionInput): Promise<BrowserObservation> {
    return await (await this.ensure_delegate()).create_session(input);
  }

  async observe(input: BrowserObserveInput): Promise<BrowserObservation> {
    return await (await this.ensure_delegate()).observe(input);
  }

  async act(input: BrowserActInput): Promise<BrowserObservation> {
    return await (await this.ensure_delegate()).act(input);
  }

  async extract(input: BrowserExtractInput): Promise<BrowserExtractResult> {
    return await (await this.ensure_delegate()).extract(input);
  }

  async close_session(input: BrowserCloseSessionInput): Promise<void> {
    await (await this.ensure_delegate()).close_session(input);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const delegate = this.delegate;
    this.delegate = null;
    await delegate?.dispose();
    const browser_process = this.browser_process;
    this.browser_process = null;
    if (browser_process) await stop_process(browser_process);
  }

  /** 初始化或复用当前 profile 已暴露的 CDP 浏览器。 */
  private async ensure_delegate(): Promise<PlaywrightBrowserProvider> {
    if (this.disposed) throw new Error("LocalBrowserProvider is disposed");
    if (this.delegate) return this.delegate;
    this.initialization ??= this.initialize_delegate();
    try {
      return await this.initialization;
    } catch (error) {
      this.initialization = null;
      throw error;
    }
  }

  /** 准备 profile、启动浏览器并创建 CDP delegate。 */
  private async initialize_delegate(): Promise<PlaywrightBrowserProvider> {
    const profile_path = path.resolve(this.options.profile_path);
    await mkdir(profile_path, { recursive: true, mode: 0o700 });
    const startup_path = path.join(profile_path, STARTUP_FILE);
    const existing_endpoint = await read_cdp_endpoint(startup_path);
    if (existing_endpoint) {
      const existing = this.create_delegate(existing_endpoint);
      try {
        const observation = await existing.create_session({});
        await existing.close_session({ session_id: observation.session_id });
        this.delegate = existing;
        return existing;
      } catch {
        await existing.dispose();
        await unlink(startup_path).catch(() => undefined);
      }
    }

    const executable_path = await resolve_browser_executable(this.options.executable_path);
    const browser_process = spawn(executable_path, [
      "--remote-debugging-port=0",
      `--user-data-dir=${profile_path}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ], { stdio: "ignore", windowsHide: true });
    this.browser_process = browser_process;
    const startup_error = new Promise<never>((_resolve, reject) => {
      browser_process.once("error", reject);
      browser_process.once("exit", (code, signal) => {
        reject(new Error(`Local browser exited during startup: ${code ?? signal ?? "unknown"}`));
      });
    });
    let endpoint: string;
    try {
      endpoint = await Promise.race([
        wait_for_cdp_endpoint(startup_path, this.options.timeout_ms ?? DEFAULT_TIMEOUT_MS),
        startup_error,
      ]);
    } catch (error) {
      if (this.browser_process === browser_process) this.browser_process = null;
      await stop_process(browser_process);
      throw error;
    }
    const delegate = this.create_delegate(endpoint);
    this.delegate = delegate;
    return delegate;
  }

  /** 用统一页面参数创建 Playwright CDP Provider。 */
  private create_delegate(cdp_url: string): PlaywrightBrowserProvider {
    return new PlaywrightBrowserProvider({
      cdp_url,
      ...(this.options.default_url ? { default_url: this.options.default_url } : {}),
      ...(this.options.timeout_ms !== undefined ? { timeout_ms: this.options.timeout_ms } : {}),
      ...(this.options.max_observation_chars !== undefined
        ? { max_observation_chars: this.options.max_observation_chars }
        : {}),
    });
  }
}

/** 等待 Chrome 写入 DevToolsActivePort。 */
async function wait_for_cdp_endpoint(file_path: string, timeout_ms: number): Promise<string> {
  const deadline = Date.now() + Math.min(60_000, Math.max(1_000, timeout_ms));
  while (Date.now() < deadline) {
    const endpoint = await read_cdp_endpoint(file_path);
    if (endpoint) return endpoint;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Local browser did not expose CDP within ${timeout_ms} ms`);
}

/** 从 Chrome 启动文件读取本地 CDP 地址。 */
async function read_cdp_endpoint(file_path: string): Promise<string | null> {
  try {
    const [port] = (await readFile(file_path, "utf8")).trim().split(/\r?\n/u);
    if (!/^\d+$/u.test(port)) return null;
    return `http://127.0.0.1:${port}`;
  } catch {
    return null;
  }
}

/** 查找当前操作系统可用的 Chrome/Chromium。 */
async function resolve_browser_executable(explicit_path: string | undefined): Promise<string> {
  const candidates = explicit_path?.trim()
    ? [explicit_path.trim()]
    : browser_candidates();
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 继续尝试下一个平台候选。
    }
  }
  throw new Error("No local Chrome or Chromium executable was found");
}

/** 返回当前平台的浏览器候选路径。 */
function browser_candidates(): string[] {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  if (process.platform === "win32") {
    return [
      path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google/Chrome/Application/chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
      path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
    ];
  }
  const path_directories = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]
    .flatMap((name) => path_directories.map((directory) => path.join(directory, name)));
}

/** 等待已拥有子进程退出，超时后由调用方决定是否强制终止。 */
async function wait_for_exit(browser_process: ChildProcess, timeout_ms: number): Promise<void> {
  if (browser_process.exitCode !== null || browser_process.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeout_ms);
    browser_process.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

/** 终止当前 Provider 明确拥有的浏览器进程。 */
async function stop_process(browser_process: ChildProcess): Promise<void> {
  if (browser_process.exitCode !== null || browser_process.signalCode !== null) return;
  browser_process.kill("SIGTERM");
  await wait_for_exit(browser_process, 3_000);
  if (browser_process.exitCode === null && browser_process.signalCode === null) {
    browser_process.kill("SIGKILL");
  }
}
