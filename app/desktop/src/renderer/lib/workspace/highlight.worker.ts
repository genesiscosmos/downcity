/**
 * Workspace 源码高亮 Worker。
 *
 * 把 Shiki 的语法编译与整篇着色移出渲染主线程：即使命中 400k 字符上限内的文件，着色也可能
 * 占用主线程数百毫秒，期间输入与滚动都会卡顿。着色逻辑复用 `workspace_highlight_core`，
 * 与主线程回退路径完全一致。
 *
 * **语言语法在 Worker 内动态 import。** 这会让 Vite 为 Worker 单独产出一份语言分块（与主线程
 * 回退路径那份重复，见 `docs/desktop-performance-budget.md` 的产物说明）。它们都是懒加载的，
 * 首次打开源码视图才创建 Worker、才拉取对应语言，不进入首屏。
 *
 * 逐条处理、逐条回传：请求与结果用 `request_id` 配对，Worker 不判断新旧。结果是否仍然有效
 * 由调用方决定——同一时刻可能有多个预览在读不同文件，按「最新胜出」丢弃会让先发的那次
 * 永远拿不到结果。
 *
 * **待人工验证：** 打包产物用 `loadFile` 走 `file://` 协议，而 `file://` 源下的 Worker 创建
 * 是否被允许尚未在本机验证（Electron 在开发沙箱内无法启动）。若不可用，调度层会回退到
 * 主线程着色，行为与引入 Worker 前一致——即失去线程隔离，但不会失效。
 */

import { highlight_code_lines_core, type HighlightedToken } from "./workspace_highlight_core";
import type { WorkspaceLanguage } from "./workspace_file_language";

/** 主线程提交的一次着色请求。 */
interface HighlightWorkerRequest {
  /** 请求标识，回传时原样带回。 */
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
  /** 着色片段；失败或跳过时为 undefined，由调用方按纯文本渲染。 */
  tokens?: HighlightedToken[][];
}

/**
 * Worker 全局作用域的最小形态。
 *
 * 只声明这里真正用到的两个成员，而不是引入 `webworker` lib：该 lib 与渲染进程已启用的
 * DOM lib 存在大量同名声明，同时引入会污染整个 web 项目的类型环境。
 */
interface HighlightWorkerScope {
  /** 接收主线程提交的请求。 */
  onmessage: ((event: MessageEvent<HighlightWorkerRequest>) => void) | null;
  /** 向主线程回传结果。 */
  postMessage: (message: HighlightWorkerResponse) => void;
}

const worker_scope = self as unknown as HighlightWorkerScope;

worker_scope.onmessage = (event: MessageEvent<HighlightWorkerRequest>) => {
  const request = event.data;
  void highlight_code_lines_core(request.code, request.language, request.expected_line_count).then((tokens) => {
    worker_scope.postMessage({ request_id: request.request_id, ...(tokens ? { tokens } : {}) });
  });
};
