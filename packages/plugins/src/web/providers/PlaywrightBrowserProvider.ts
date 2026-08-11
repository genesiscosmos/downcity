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
import type { Browser, BrowserContext, Page } from "playwright-core";
import type {
  BrowserActInput,
  BrowserCloseSessionInput,
  BrowserCreateSessionInput,
  BrowserExtractInput,
  BrowserExtractResult,
  BrowserObservation,
  BrowserObserveInput,
  BrowserProvider,
} from "@/web/types/WebPlugin.js";
import type { PlaywrightBrowserProviderOptions } from "@/web/types/PlaywrightBrowserProvider.js";

const DEFAULT_URL = "about:blank";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CHARS = 12_000;
const MAX_WAIT_MS = 60_000;

/** provider 内部持有的浏览器 session。 */
interface PlaywrightBrowserSession {
  /** session 唯一标识。 */
  session_id: string;
  /** session 所在的浏览器上下文。 */
  context: BrowserContext;
  /** session 唯一拥有的页面。 */
  page: Page;
}

/** 把字符上限归一化到安全范围。 */
function normalize_max_chars(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(100_000, Math.max(1, Math.floor(value ?? fallback)));
}

/** 把超时归一化到安全范围。 */
function normalize_timeout_ms(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_WAIT_MS, Math.max(1_000, Math.floor(value ?? DEFAULT_TIMEOUT_MS)));
}

/** 把错误转换成稳定文本。 */
function describe_error(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 基于 Playwright/CDP 的浏览器 provider。 */
export class PlaywrightBrowserProvider implements BrowserProvider {
  /** provider 稳定名称。 */
  readonly name = "playwright-cdp";

  /** 构造参数。 */
  private readonly options: Required<PlaywrightBrowserProviderOptions>;

  /** 当前 CDP 浏览器连接。 */
  private browser: Browser | null = null;

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
      timeout_ms: normalize_timeout_ms(options.timeout_ms),
      max_observation_chars: normalize_max_chars(
        options.max_observation_chars,
        DEFAULT_MAX_CHARS,
      ),
    };
  }

  /** 创建一个新的页面 session。 */
  async create_session(
    input: BrowserCreateSessionInput,
  ): Promise<BrowserObservation> {
    const browser = await this.get_browser();
    const context = browser.contexts()[0] ?? await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(this.options.timeout_ms);
    page.setDefaultNavigationTimeout(this.options.timeout_ms);
    const session_id = randomUUID();
    const session = { session_id, context, page };
    this.sessions.set(session_id, session);

    try {
      const url = String(input.url || this.options.default_url).trim();
      if (url && url !== DEFAULT_URL) {
        await page.goto(url, { waitUntil: "domcontentloaded" });
      }
      return await this.read_observation(session, input.include_screenshot);
    } catch (error) {
      await this.close_session({ session_id }).catch(() => undefined);
      throw new Error(`Browser session creation failed: ${describe_error(error)}`);
    }
  }

  /** 读取当前页面状态。 */
  async observe(input: BrowserObserveInput): Promise<BrowserObservation> {
    return await this.read_observation(
      this.require_session(input.session_id),
      input.include_screenshot,
    );
  }

  /** 执行确定性浏览器动作。 */
  async act(input: BrowserActInput): Promise<BrowserObservation> {
    const session = this.require_session(input.session_id);
    const { page } = session;
    const action = input.action;

    if (action.type === "goto") {
      await page.goto(action.url, { waitUntil: "domcontentloaded" });
    } else if (action.type === "click") {
      await page.locator(action.selector).click();
    } else if (action.type === "fill") {
      await page.locator(action.selector).fill(action.value);
    } else if (action.type === "press") {
      await page.locator(action.selector).press(action.key);
    } else if (action.type === "scroll") {
      await page.evaluate(
        ([x, y]) => globalThis.scrollBy(x, y),
        [action.x ?? 0, action.y ?? 0] as [number, number],
      );
    } else {
      const milliseconds = Math.min(
        MAX_WAIT_MS,
        Math.max(0, Math.floor(action.milliseconds ?? 500)),
      );
      await page.waitForTimeout(milliseconds);
    }

    return await this.read_observation(session, input.include_screenshot);
  }

  /** 从当前页面抽取文本。 */
  async extract(input: BrowserExtractInput): Promise<BrowserExtractResult> {
    const session = this.require_session(input.session_id);
    const locator = input.selector
      ? session.page.locator(input.selector)
      : session.page.locator("body");
    const content = (await locator.allTextContents()).join("\n");
    const max_chars = normalize_max_chars(
      input.max_chars,
      this.options.max_observation_chars,
    );
    return {
      provider: this.name,
      session_id: session.session_id,
      url: session.page.url(),
      content: content.slice(0, max_chars),
    };
  }

  /** 关闭指定 session 拥有的页面。 */
  async close_session(input: BrowserCloseSessionInput): Promise<void> {
    const session = this.sessions.get(input.session_id);
    if (!session) return;
    this.sessions.delete(input.session_id);
    await session.page.close().catch(() => undefined);
  }

  /** 关闭所有页面和 CDP 连接。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const session_ids = [...this.sessions.keys()];
    await Promise.all(
      session_ids.map(async (session_id) => {
        await this.close_session({ session_id });
      }),
    );
    const browser = this.browser;
    this.browser = null;
    await browser?.close().catch(() => undefined);
  }

  /** 懒连接 CDP 浏览器。 */
  private async get_browser(): Promise<Browser> {
    if (this.disposed) {
      throw new Error("PlaywrightBrowserProvider is disposed");
    }
    if (this.browser?.isConnected()) return this.browser;
    this.browser = await chromium.connectOverCDP(this.options.cdp_url, {
      timeout: this.options.timeout_ms,
    });
    this.browser.on("disconnected", () => {
      this.browser = null;
      this.sessions.clear();
    });
    return this.browser;
  }

  /** 读取 session，不存在时抛出稳定错误。 */
  private require_session(session_id: string): PlaywrightBrowserSession {
    const session = this.sessions.get(session_id);
    if (!session) {
      throw new Error(`Browser session not found: ${session_id}`);
    }
    return session;
  }

  /** 生成当前页面的模型友好观察结果。 */
  private async read_observation(
    session: PlaywrightBrowserSession,
    include_screenshot: boolean | undefined,
  ): Promise<BrowserObservation> {
    const page = session.page;
    const text = await page.locator("body").innerText().catch(() => "");
    const screenshot_data_url = include_screenshot
      ? `data:image/png;base64,${(await page.screenshot({ type: "png" })).toString("base64")}`
      : undefined;
    return {
      provider: this.name,
      session_id: session.session_id,
      url: page.url(),
      title: await page.title().catch(() => ""),
      text: text.slice(0, this.options.max_observation_chars),
      screenshot_data_url: screenshot_data_url ?? null,
    };
  }
}
