/**
 * 显式远程媒体读取：有界取得远端字节，再交给当前 Session 持久化为本地附件。
 * 不把远端文件名作为本机路径，不自动下载大文件；与 Workspace read 共用媒体预算。
 */
import crypto from "node:crypto";
import path from "node:path";
import type { ToolCallContext } from "@downcity/type";
import type { ReadFileToolSuccess } from "@downcity/type/workspace";
import { max_explicit_media_bytes, max_request_media_bytes, read_image_dimensions, estimate_image_tokens } from "@downcity/type/workspace";
import type { SshMediaResult, SshMediaMessage } from "./types/Ssh.js";
import type { SshFileSystem } from "./SshFileSystem.js";
/** 只从真实签名识别受支持的媒体。 */
function media_type(bytes: Buffer): string | undefined {
    if (bytes.subarray(0, 5).toString("ascii") === "%PDF-")
        return "application/pdf";
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return "image/jpeg";
    if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP")
        return "image/webp";
    if (["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)))
        return "image/gif";
    return undefined;
}
/** 返回已绑定字节快照的消息；未知格式和超限媒体保留引用。 */
export async function read_ssh_media(files: SshFileSystem, output: ReadFileToolSuccess, context: ToolCallContext): Promise<SshMediaResult> {
    const messages: SshMediaMessage[] = [];
    if (output.total_bytes > max_explicit_media_bytes)
        return { output, messages };
    context.abort_signal?.throwIfAborted();
    const data = Buffer.from(await files.rpc<string>("media", { path: output.file_path, expected_version: output.file_version }, { signal: context.abort_signal }), "base64");
    if (data.length > max_explicit_media_bytes)
        throw new Error("Remote media changed and exceeds 2 MiB");
    const type = media_type(data);
    if (!type)
        return { output, messages };
    const dimensions = type.startsWith("image/") ? read_image_dimensions(data) : undefined;
    const tokens = dimensions ? estimate_image_tokens(dimensions) : Math.ceil(data.length / 3) * 4;
    const existing_bytes = (context.messages || []).reduce((sum, message) => sum + message.content.reduce((total, item) => {
        for (const part of item.type === "tool_result" ? item.content : [item]) {
            if (part.type === "file" && part.source.type === "base64")
                total += Buffer.byteLength(part.source.data, "base64");
        }
        return total;
    }, 0), 0);
    if ((context.reserve_media && !context.reserve_media(data.length, existing_bytes, tokens)) || data.length + existing_bytes > max_request_media_bytes)
        throw new Error("Remote media exceeds the current request budget");
    // 版本绑定的是已经读取的内容快照；Session 持久化后会转换为该本地附件的真实版本。
    messages.push({ role: "user", parts: [{ type: "file", url: `data:${type};base64,${data.toString("base64")}`, media_type: type, filename: path.posix.basename(output.file_path), media_version: `sha256:${crypto.createHash("sha256").update(data).digest("hex")}` }] });
    return { output: { ...output, type: type.startsWith("image/") ? "image" : "binary", mime_type: type }, messages };
}
