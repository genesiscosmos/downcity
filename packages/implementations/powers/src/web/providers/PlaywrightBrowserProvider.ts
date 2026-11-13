/**
 * 基于 Playwright/CDP 的浏览器 provider。
 *
 * 关键点（中文）
 * - provider 只连接外部已启动的 CDP 浏览器，不负责安装或启动 Chrome。
 * - 每个 session 拥有独立 Page；连接与 session 生命周期统一由 provider 回收。
 * - action 只暴露确定性 DOM 操作，AI 语义动作由后续 Stagehand adapter 承担。
 */

import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import type { Browser, Locator, Page } from "playwright-core";
import type {
  BrowserAction,
  BrowserActInput,
  BrowserCloseSessionInput,
  BrowserCreateSessionInput,
  BrowserExtractInput,
  BrowserExtractResult,
  BrowserElementReference,
  BrowserListSessionsResult,
  BrowserObservation,
  BrowserObserveInput,
  BrowserProvider,
} from "@/web/types/WebPower.js";
import type { PlaywrightBrowserProviderOptions } from "@/web/types/PlaywrightBrowserProvider.js";
import { browser_timeout_ms, run_browser_operation, wait_for_browser } from "@/web/providers/BrowserOperation.js";

/** 关闭当前操作拥有的页面；完整清理也有期限，防止 CDP 失联阻塞收尾。 */
async function close_browser_page(page: Page): Promise<void> {
  await run_browser_operation(3_000, undefined, async (signal) => wait_for_browser(page.close({ runBeforeUnload: false }), signal));
}

const DEFAULT_URL = "about:blank";
const DEFAULT_MAX_CHARS = 12_000;
const MAX_WAIT_MS = 60_000;
const MAX_ELEMENT_REFS = 200;
const INTERACTIVE_SELECTOR = [
  "a:visible",
  "button:visible",
  "input:visible",
  "textarea:visible",
  "select:visible",
  "[role=button]:visible",
  "[role=link]:visible",
  "[role=checkbox]:visible",
  "[role=radio]:visible",
  "[role=combobox]:visible",
  "[role=menuitem]:visible",
  "[tabindex]:visible",
].join(",");

/** provider 内部持有的浏览器 session。 */
interface PlaywrightBrowserSession {
  /** session 唯一标识。 */
  session_id: string;
  /** session 唯一拥有的页面。 */
  page: Page;
  /** 最近一次 observation 的代次。 */
  observation_generation: number;
  /** 最近一次 observation 生成的元素引用。 */
  element_refs: Map<string, Locator>;
  /** 最近一次 observation 记录的页面 URL。 */
  last_url: string;
  /** 最近一次 observation 记录的页面标题。 */
  last_title: string;
}

/** 从页面一次性读取的可交互元素元数据。 */
interface BrowserElementMetadata {
  /** 元素在当前 Locator 集合中的位置。 */
  index: number;
  /** 元素 HTML 标签名。 */
  tag: string;
  /** 元素显式或推导出的可访问角色。 */
  role: string;
  /** 元素可访问名称或简短可见文本。 */
  name: string;
}

/** 把字符上限归一化到安全范围。 */
function normalize_max_chars(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(100_000, Math.max(1, Math.floor(value ?? fallback)));
}

/** 把错误转换成稳定文本。 */
function describe_error(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 仅保留 CDP endpoint 的协议、主机与端口。 */
function sanitize_cdp_endpoint(cdp_url: string): string {
  try {
    const endpoint = new URL(cdp_url);
    const port = endpoint.port ? `:${endpoint.port}` : "";
    return `${endpoint.protocol}//${endpoint.hostname}${port}`;
  } catch {
    return "[redacted-cdp-endpoint]";
  }
}

/** 删除错误文本中 URL 携带的认证信息、路径和查询参数。 */
function sanitize_error_message(error: unknown): string {
  return describe_error(error).replace(
    /(?:https?|wss?):\/\/[^\s"'<>]+/giu,
    (value) => sanitize_cdp_endpoint(value.replace(/[),.;]+$/u, "")),
  );
}

/** 创建包含稳定阶段标识和脱敏 endpoint 的 session 错误。 */
function create_session_error(
  stage: "connect" | "resolve-context" | "create-page" | "initialize-page",
  cdp_url: string,
  detail: string,
  cause?: unknown,
): Error {
  const endpoint = sanitize_cdp_endpoint(cdp_url);
  const cause_detail = cause === undefined
    ? ""
    : ` ${sanitize_error_message(cause)}`;
  return new Error(
    `Unable to create browser session during ${stage} for ${endpoint}: ${detail}${cause_detail}`,
  );
}

/** 基于 Playwright/CDP 的浏览器 provider。 */
export class PlaywrightBrowserProvider implements BrowserProvider {
  /** provider 稳定名称。 */
  readonly name = "playwright-cdp";

  /** 构造参数。 */
  private readonly options: Required<PlaywrightBrowserProviderOptions>;

  /** 当前 CDP 浏览器连接。 */
  private browser: Browser | null = null;

  /** 并发首次操作共享连接，避免连接迟到时覆盖其他连接。 */
  private connection: Promise<Browser> | null = null;

  /** 当前 provider 拥有的 session。 */
  private readonly sessions = new Map<string, PlaywrightBrowserSession>();

  /** provider 是否已释放。 */
  private disposed = false;

  constructor(options: PlaywrightBrowserProviderOptions) {
    const cdp_url = String(options.cdp_url || "").trim();
    if (!cdp_url) {
      throw new TypeError("PlaywrightBrowserProvider requires cdp_url");
    }
    this.options = {
      cdp_url,
      default_url: String(options.default_url || DEFAULT_URL),
      timeout_ms: browser_timeout_ms(options.timeout_ms),
      max_observation_chars: normalize_max_chars(
        options.max_observation_chars,
        DEFAULT_MAX_CHARS,
      ),
    };
  }

  /** 创建一个新的页面 session。 */
  async create_session(input: BrowserCreateSessionInput, upstream_signal?: AbortSignal): Promise<BrowserObservation> {
    return await run_browser_operation(this.options.timeout_ms, upstream_signal, (signal) => this.create_page_session(input, signal));
  }

  /** 创建页面并在发布观察前检查取消；迟到页面只进入清理，不进入 session 表。 */
  private async create_page_session(input: BrowserCreateSessionInput, signal: AbortSignal): Promise<BrowserObservation> {
    let browser: Browser;
    try {
      browser = await wait_for_browser(this.get_browser(), signal);
    } catch (error) {
      throw create_session_error(
        "connect",
        this.options.cdp_url,
        "the CDP connection could not be established.",
        error,
      );
    }

    const context = browser.contexts()[0];
    if (!context) {
      throw create_session_error(
        "resolve-context",
        this.options.cdp_url,
        "Playwright did not expose the browser's default context. Use a compatible Chromium CDP endpoint.",
      );
    }

    let acquired_page: Page | undefined;
    let cleanup: Promise<void> | undefined;
    const close_page = () => acquired_page ? cleanup ??= close_browser_page(acquired_page) : Promise.resolve();
    let page: Page;
    try {
      page = await wait_for_browser(context.newPage().then((created_page) => {
        acquired_page = created_page;
        if (signal.aborted || this.disposed) {
          void close_page().catch(() => undefined);
          throw signal.reason ?? new Error("PlaywrightBrowserProvider is disposed");
        }
        return created_page;
      }), signal);
    } catch (error) {
      // 页面可能恰好在等待被取消前返回，仍需由本次调用回收。
      await close_page().catch(() => undefined);
      throw create_session_error(
        "create-page",
        this.options.cdp_url,
        "the CDP endpoint does not support creating a page in its default context.",
        error,
      );
    }

    const on_abort = () => { void close_page().catch(() => undefined); };
    signal.addEventListener("abort", on_abort, { once: true });
    try {
      signal.throwIfAborted();
      page.setDefaultTimeout(this.options.timeout_ms);
      page.setDefaultNavigationTimeout(this.options.timeout_ms);
      const url = String(input.url || this.options.default_url).trim();
      if (url && url !== DEFAULT_URL) {
        await wait_for_browser(page.goto(url, { waitUntil: "domcontentloaded" }), signal);
      }
      const session = {
        session_id: randomUUID(),
        page,
        observation_generation: 0,
        element_refs: new Map<string, Locator>(),
        last_url: "",
        last_title: "",
      };
      const observation = await this.read_observation(
        session,
        input.include_screenshot,
        signal,
      );
      signal.throwIfAborted();
      this.sessions.set(session.session_id, session);
      return observation;
    } catch (error) {
      await close_page().catch(() => undefined);
      throw create_session_error(
        "initialize-page",
        this.options.cdp_url,
        "the new page could not be initialized.",
        error,
      );
    } finally {
      signal.removeEventListener("abort", on_abort);
    }
  }

  /** 读取当前页面状态；取消只关闭本次操作的页面。 */
  async observe(input: BrowserObserveInput, upstream_signal?: AbortSignal): Promise<BrowserObservation> {
    return await this.run_session_operation(input.session_id, upstream_signal, (session, signal) =>
      this.read_observation(session, input.include_screenshot, signal));
  }

  /** 执行确定性浏览器动作。 */
  async act(input: BrowserActInput, upstream_signal?: AbortSignal): Promise<BrowserObservation> {
    return await this.run_session_operation(input.session_id, upstream_signal, async (session, signal) => {
      signal.throwIfAborted();
      const { page } = session;
      const action = input.action;

      if (action.type === "goto") {
        await page.goto(action.url, { waitUntil: "domcontentloaded" });
      } else if (action.type === "click") {
        await this.resolve_action_locator(session, action).click();
      } else if (action.type === "fill") {
        await this.resolve_action_locator(session, action).fill(action.value);
      } else if (action.type === "press") {
        await this.resolve_action_locator(session, action).press(action.key);
      } else if (action.type === "scroll") {
        await page.evaluate(
          ([x, y]) => globalThis.scrollBy(x, y),
          [action.x ?? 0, action.y ?? 0] as [number, number],
        );
      } else {
        const milliseconds = Math.min(MAX_WAIT_MS, Math.max(0, Math.floor(action.milliseconds ?? 500)));
        await page.waitForTimeout(milliseconds);
      }

      signal.throwIfAborted();
      return await this.read_observation(session, input.include_screenshot, signal);
    });
  }

  /** 从当前页面抽取文本。 */
  async extract(input: BrowserExtractInput, upstream_signal?: AbortSignal): Promise<BrowserExtractResult> {
    return await this.run_session_operation(input.session_id, upstream_signal, async (session, signal) => {
      const locator = session.page.locator(input.selector || "body");
      const content = (await wait_for_browser(locator.allTextContents(), signal)).join("\n");
      const max_chars = normalize_max_chars(input.max_chars, this.options.max_observation_chars);
      return {
        provider: this.name,
        session_id: session.session_id,
        url: session.page.url(),
        content: content.slice(0, max_chars),
      };
    });
  }

  /** 关闭指定 session 拥有的页面。 */
  async close_session(input: BrowserCloseSessionInput, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const session = this.sessions.get(input.session_id);
    if (!session) return;
    const cleanup = close_browser_page(session.page).then(() => {
      if (this.sessions.get(input.session_id) === session) this.sessions.delete(input.session_id);
    });
    if (signal) await wait_for_browser(cleanup, signal);
    else await cleanup;
  }

  /**
   * 列出当前仍由 provider 拥有的 session。
   *
   * 关键点（中文）：URL 与标题取最近一次观察的快照，因此读取本身不会触碰页面；
   * 未观察过的新 session 回退到页面当前状态。
   */
  async list_sessions(signal?: AbortSignal): Promise<BrowserListSessionsResult> {
    signal?.throwIfAborted();
    const sessions = await Promise.all([...this.sessions.values()].map(async (session) => ({
      session_id: session.session_id,
      url: session.last_url || session.page.url(),
      title: session.last_title,
      observation_generation: session.observation_generation,
    })));
    return { provider: this.name, sessions };
  }

  /** 关闭所有页面和 CDP 连接。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const session_ids = [...this.sessions.keys()];
    await Promise.allSettled(session_ids.map((session_id) => this.close_session({ session_id })));
    this.sessions.clear();
    const browser = this.browser;
    this.browser = null;
    if (browser) await run_browser_operation(3_000, undefined, async (signal) => wait_for_browser(browser.close(), signal)).catch(() => undefined);
    // 连接中的实例由 get_browser 的 disposed 检查清理，不等待失联的连接。
  }

  /** 懒连接 CDP 浏览器。 */
  private async get_browser(): Promise<Browser> {
    if (this.disposed) {
      throw new Error("PlaywrightBrowserProvider is disposed");
    }
    if (this.browser?.isConnected()) return this.browser;
    if (this.connection) return await this.connection;
    const connection = chromium.connectOverCDP(this.options.cdp_url, {
      timeout: this.options.timeout_ms,
      noDefaults: true,
    }).then(async (browser) => {
      if (this.disposed) {
        await run_browser_operation(3_000, undefined, async (signal) => wait_for_browser(browser.close(), signal)).catch(() => undefined);
        throw new Error("PlaywrightBrowserProvider is disposed");
      }
      this.browser = browser;
      browser.on("disconnected", () => {
        if (this.browser !== browser) return;
        this.browser = null;
        this.sessions.clear();
      });
      return browser;
    });
    this.connection = connection;
    try { return await connection; }
    finally { if (this.connection === connection) this.connection = null; }
  }

  /** 为已存在的页面绑定取消清理，避免取消后继续执行页面动作。 */
  private async run_session_operation<T>(
    session_id: string,
    upstream_signal: AbortSignal | undefined,
    execute: (session: PlaywrightBrowserSession, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return await run_browser_operation(this.options.timeout_ms, upstream_signal, async (signal) => {
      const session = this.require_session(session_id);
      const on_abort = () => {
        if (this.sessions.get(session_id) === session) this.sessions.delete(session_id);
        void close_browser_page(session.page).catch(() => undefined);
      };
      signal.addEventListener("abort", on_abort, { once: true });
      try {
        signal.throwIfAborted();
        return await wait_for_browser(execute(session, signal), signal);
      } finally {
        signal.removeEventListener("abort", on_abort);
      }
    });
  }

  /** 读取 session，不存在时抛出稳定错误。 */
  private require_session(session_id: string): PlaywrightBrowserSession {
    const session = this.sessions.get(session_id);
    if (!session) {
      throw new Error(`Browser session not found: ${session_id}`);
    }
    return session;
  }

  /** 根据当前 observation ref 或显式 selector 解析动作目标。 */
  private resolve_action_locator(
    session: PlaywrightBrowserSession,
    action: Extract<BrowserAction, { type: "click" | "fill" | "press" }>,
  ): Locator {
    if (action.ref) {
      if (action.observation_generation !== session.observation_generation) {
        throw new Error(
          `Browser element reference is stale: expected observation generation ${session.observation_generation}`,
        );
      }
      const locator = session.element_refs.get(action.ref);
      if (!locator) {
        throw new Error(`Browser element reference not found: ${action.ref}`);
      }
      return locator;
    }
    if (action.selector) return session.page.locator(action.selector);
    throw new Error("Browser action requires exactly one of ref or selector");
  }

  /** 生成当前页面的模型友好观察结果。 */
  private async read_observation(
    session: PlaywrightBrowserSession,
    include_screenshot: boolean | undefined,
    signal: AbortSignal,
  ): Promise<BrowserObservation> {
    signal.throwIfAborted();
    const page = session.page;
    const body = page.locator("body");
    const [text, accessibility_snapshot, title] = await wait_for_browser(Promise.all([
      body.innerText().catch(() => ""),
      body.ariaSnapshot().catch(() => ""),
      page.title().catch(() => ""),
    ]), signal);
    const elements = await this.read_element_references(session, signal);
    const screenshot_data_url = include_screenshot
      ? `data:image/png;base64,${(await wait_for_browser(page.screenshot({ type: "png" }), signal)).toString("base64")}`
      : undefined;
    signal.throwIfAborted();
    session.last_url = page.url();
    session.last_title = title;
    return {
      provider: this.name,
      session_id: session.session_id,
      url: session.last_url,
      title,
      observation_generation: session.observation_generation,
      accessibility_snapshot: accessibility_snapshot.slice(
        0,
        this.options.max_observation_chars,
      ),
      text: text.slice(0, this.options.max_observation_chars),
      elements,
      screenshot_data_url: screenshot_data_url ?? null,
    };
  }

  /** 为当前页面生成仅在本次 observation 内有效的元素引用。 */
  private async read_element_references(
    session: PlaywrightBrowserSession,
    signal: AbortSignal,
  ): Promise<BrowserElementReference[]> {
    signal.throwIfAborted();
    const locator = session.page.locator(INTERACTIVE_SELECTOR);
    const metadata = await wait_for_browser(locator.evaluateAll((elements, max_elements) =>
      elements.slice(0, max_elements).map((element, index) => {
        const html_element = element as HTMLElement;
        const tag = element.tagName.toLowerCase();
        const explicit_role = element.getAttribute("role")?.trim();
        const role = explicit_role || ({
          a: "link",
          button: "button",
          input: "input",
          textarea: "textbox",
          select: "combobox",
        }[tag] ?? "interactive");
        const value = "value" in html_element
          ? String((html_element as HTMLInputElement).value || "")
          : "";
        const name = String(
          element.getAttribute("aria-label")
          || html_element.innerText
          || value
          || element.getAttribute("placeholder")
          || element.getAttribute("title")
          || "",
        ).replace(/\s+/gu, " ").trim().slice(0, 240);
        return { index, tag, role, name };
      }), MAX_ELEMENT_REFS).catch(() => [] as BrowserElementMetadata[]), signal);

    session.observation_generation += 1;
    session.element_refs.clear();
    return metadata.map((element, position) => {
      const ref = `e${position + 1}`;
      session.element_refs.set(ref, locator.nth(element.index));
      return {
        ref,
        tag: element.tag,
        role: element.role,
        name: element.name,
      };
    });
  }
}
