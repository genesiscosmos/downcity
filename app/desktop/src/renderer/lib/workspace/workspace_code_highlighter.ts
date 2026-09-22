/**
 * Workspace 源码视图的语法高亮调度。
 *
 * 着色本身在 `workspace_highlight_core`（主线程与 Worker 共用），这里只决定「在哪跑」与
 * 「失败怎么办」：
 *
 * 1. **优先在 Worker 中着色。** 着色是 CPU 密集的同步计算，命中 400k 字符上限内的文件时
 *    可能占用主线程数百毫秒，期间滚动与输入都会卡顿。Worker 隔离后主线程只负责接收结果。
 * 2. **Worker 不可用时回退主线程。** 创建失败或 Worker 报错时，用同一份核心逻辑在主线程重跑
 *    这些请求：功能不变，只是失去线程隔离。
 * 3. **失败一律降级为纯文本。** 与核心一致：着色失败或行数不一致时返回 undefined。
 *
 * 结果的新旧由调用方判定，不在这里做「最新请求胜出」：同一时刻可能有两个预览在读不同文件
 * （主视图与右侧文件面板），按全局最新丢弃会让先发的那次永远退化成纯文本。调用方已经用
 * 自己的 `active` 标记丢弃过期结果，这里只需保证每个请求都能拿到属于自己的答案。
 */

import { highlight_code_lines_core, should_skip_highlight, type HighlightedToken } from "./workspace_highlight_core";
import type { WorkspaceLanguage } from "./workspace_file_language";

export type { HighlightedToken };

/** 主线程提交给 Worker 的一次着色请求。 */
interface HighlightWorkerRequest {
  /** 请求标识，回传时原样带回，用于找到对应的等待者。 */
  request_id: number;
  /** 需要着色的源码全文。 */
  code: string;
  /** 源码语言。 */
  language: WorkspaceLanguage;
  /** 调用方即将渲染的行数，用于校验 token 行数是否对齐。 */
  expected_line_count: number;
}

/** Worker 回传的着色结果。 */
interface HighlightWorkerResponse {
  /** 对应请求的标识。 */
  request_id: number;
  /** 着色片段；失败或跳过时为 undefined。 */
  tokens?: HighlightedToken[][];
}

/** 一次已提交但尚未回传的请求。 */
interface PendingHighlight {
  /** 原始请求；Worker 失败时据此在主线程重跑。 */
  request: HighlightWorkerRequest;
  /** 完成这次请求。 */
  resolve: (tokens: HighlightedToken[][] | undefined) => void;
}

/** 进程内共享的高亮 Worker；创建开销与内存都不小，必须复用同一份。 */
let worker: Worker | undefined;

/** Worker 是否已被判定不可用；置位后不再重试，直接走主线程。 */
let worker_unavailable = false;

/** 已提交请求的登记表。 */
const pending_highlights = new Map<number, PendingHighlight>();

/** 下一个请求标识。 */
let next_request_id = 1;

/**
 * Worker 失败时收口全部在途请求。
 *
 * 不直接把结果定成 undefined（那会静默退化成纯文本），而是改在主线程重跑一遍：
 * 失败原因通常是环境限制而非源码本身，用户不该因此失去着色。
 */
function fallback_pending_to_main_thread(): void {
  const pending = [...pending_highlights.values()];
  pending_highlights.clear();
  for (const entry of pending) {
    void highlight_code_lines_core(
      entry.request.code,
      entry.request.language,
      entry.request.expected_line_count,
    ).then(entry.resolve, () => entry.resolve(undefined));
  }
}

/** 惰性创建 Worker；失败时标记不可用并返回 undefined。 */
function get_worker(): Worker | undefined {
  if (worker || worker_unavailable) return worker;
  try {
    const created = new Worker(new URL("./highlight.worker.ts", import.meta.url), { type: "module" });
    created.onmessage = (event: MessageEvent<HighlightWorkerResponse>) => {
      const response = event.data;
      const pending = pending_highlights.get(response.request_id);
      if (!pending) return;
      pending_highlights.delete(response.request_id);
      pending.resolve(response.tokens);
    };
    created.onerror = () => {
      // Worker 在运行时失败：标记不可用，让在途请求回到主线程，后续请求不再尝试创建。
      worker_unavailable = true;
      worker = undefined;
      fallback_pending_to_main_thread();
    };
    worker = created;
    return created;
  } catch {
    worker_unavailable = true;
    return undefined;
  }
}

/** 通过 Worker 提交一次着色请求；Worker 不可用时直接在主线程执行。 */
function highlight_in_worker(code: string, language: WorkspaceLanguage, expected_line_count: number): Promise<HighlightedToken[][] | undefined> {
  const active_worker = get_worker();
  if (!active_worker) return highlight_code_lines_core(code, language, expected_line_count);
  const request_id = next_request_id;
  next_request_id += 1;
  const request: HighlightWorkerRequest = { request_id, code, language, expected_line_count };
  return new Promise<HighlightedToken[][] | undefined>((resolve) => {
    pending_highlights.set(request_id, { request, resolve });
    active_worker.postMessage(request);
  });
}

/**
 * 把源码着色为按行分组的片段。
 *
 * `expected_line_count` 是调用方即将渲染的行数，按 `split("\n")` 的原样行数计（含末尾空行）。
 * 只有 token 行数与之一致时才返回结果，否则返回 undefined，避免行号与内容错位。
 */
export async function highlight_code_lines(code: string, language: WorkspaceLanguage, expected_line_count: number): Promise<HighlightedToken[][] | undefined> {
  // 明显不值得着色的请求不必往返一次 Worker。
  if (should_skip_highlight(code, expected_line_count)) return undefined;
  return await highlight_in_worker(code, language, expected_line_count);
}
