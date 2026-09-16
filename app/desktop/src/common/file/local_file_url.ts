/**
 * Desktop 本地文件 URL 协议：渲染进程与主进程共用的纯函数。
 *
 * 关键点（中文）
 * - 聊天内容里的 Markdown 会引用 Agent 产出的本地文件；渲染进程不能直接读绝对路径，
 *   因此把绝对路径编码成受控协议的 URL，由主进程按允许根校验后再返回文件。
 * - 这里只做字符串编解码与路径形状判断，不访问文件系统，方便两侧共用与单测。
 * - 允许范围与真实路径校验由主进程负责，本模块不做授权判断。
 */

/** 受控本地文件协议名。 */
export const local_file_scheme = "downcity-file";

/** 协议 URL 中承载绝对路径的固定 host。 */
export const local_file_host = "local";

/** 判断值是否为带协议的 URL（例如 http:、data:、file:）。 */
export function is_url_like(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:/iu.test(value);
}

/**
 * 把本地绝对路径编码为受控协议 URL。
 *
 * 关键点（中文）
 * - 逐段编码，避免 `%2F` 让路径段与分隔符混淆。
 * - 只接受绝对路径；相对路径返回 null，由调用方决定是否原样保留。
 */
export function build_local_file_url(file_path: string): string | null {
  const value = String(file_path || "").trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\0")) return null;
  const encoded_path = value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `${local_file_scheme}://${local_file_host}${encoded_path}`;
}

/**
 * 从受控协议 URL 解出本地绝对路径。
 *
 * 关键点（中文）
 * - 只接受本协议与固定 host；其余一律返回 null。
 * - 只做解码与形状校验，是否允许访问由主进程按允许根判断。
 */
export function read_local_file_url(input: string): string | null {
  const value = String(input || "").trim();
  if (!value.startsWith(`${local_file_scheme}://`)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hostname !== local_file_host) return null;
  return read_local_file_path(url.pathname);
}

/** 从协议 pathname 解出本地绝对路径；非法时返回 null。 */
export function read_local_file_path(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/") || decoded.includes("\0")) return null;
  return decoded;
}

/**
 * 把 Markdown 里的图片地址解析为渲染进程可加载的地址。
 *
 * 关键点（中文）
 * - `http(s)`、`data:` 等网络或内联地址原样保留，交给浏览器加载。
 * - `file://` 与裸绝对路径改写为受控协议 URL。
 * - 相对路径与协议相对地址（`//host/path`）原样保留，不做猜测。
 * - 单字母协议（例如 Windows 盘符 `C:\`）不做特判，Desktop 只面向 macOS 与 Linux 打包目标。
 */
export function resolve_markdown_image_src(src: string): string {
  const value = String(src || "").trim();
  if (!value) return src;
  if (value.startsWith("//")) return src;
  if (is_url_like(value)) {
    if (!value.startsWith("file://")) return src;
    let local_path: string | null;
    try {
      local_path = read_local_file_path(new URL(value).pathname);
    } catch {
      local_path = null;
    }
    // 裸 `file://` 解出的路径是根目录，不是文件，按原样保留交给浏览器。
    return local_path && local_path !== "/" ? build_local_file_url(local_path) ?? src : src;
  }
  if (!value.startsWith("/")) return src;
  return build_local_file_url(value) ?? src;
}
