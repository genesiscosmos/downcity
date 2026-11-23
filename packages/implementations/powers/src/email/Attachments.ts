/**
 * 邮件附件只在 Power 私有文件端口内保存。外部文件名只用作显示元数据，不参与路径拼接。
 * 发送仅接受本 Power 返回的随机标识，避免绕过 Workspace 能力权限读取任意宿主文件。
 */
import { randomUUID } from "node:crypto";
import type { PowerStorage } from "@downcity/city/power";
import type { Attachment } from "mailparser";
import type Mail from "nodemailer/lib/mailer/index.js";
import { z } from "zod";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const manifest_schema = z.object({
  filename: z.string().max(255),
  content_type: z.string().max(200),
  size: z.number().int().min(0).max(MAX_ATTACHMENT_BYTES),
});
/** 处理不可信文件名，去掉路径、控制字符和危险长度。 */
export function safe_filename(name: string | undefined): string {
  return (
    (name ?? "attachment")
      .split(/[\\/]/)
      .at(-1)!
      .replace(/[\u0000-\u001f\u007f]/g, "_")
      .slice(0, 255) || "attachment"
  );
}
/** 返回受限附件内联读取，编码清晰且不会执行内容。 */
export function read_attachment(attachment: Attachment) {
  if (attachment.content.length > 1024 * 1024)
    throw new Error(
      "Inline attachment read exceeds 1 MiB; use download_attachment",
    );
  return {
    filename: safe_filename(attachment.filename),
    content_type: attachment.contentType,
    encoding: "base64",
    content: attachment.content.toString("base64"),
    size: attachment.content.length,
    untrusted: true,
  };
}
/** 保存有限附件并返回稳定随机标识；失败时清理半成品。 */
export async function download_attachment(
  storage: PowerStorage,
  attachment: Attachment,
) {
  if (attachment.content.length > MAX_ATTACHMENT_BYTES)
    throw new Error("Attachment exceeds the 20 MiB download limit");
  const attachment_id = randomUUID();
  const directory = `attachments/${attachment_id}`;
  const manifest = {
    filename: safe_filename(attachment.filename),
    content_type: attachment.contentType.slice(0, 200),
    size: attachment.content.length,
  };
  await storage.files.ensure_directory(directory);
  try {
    await storage.files.write_file_atomically(
      `${directory}/content`,
      attachment.content,
    );
    await storage.files.write_file_atomically(
      `${directory}/manifest.json`,
      JSON.stringify(manifest),
    );
  } catch (error) {
    await storage.files.remove_path(directory);
    throw error;
  }
  return {
    attachment_id,
    ...manifest,
    file_path: storage.files.resolve_path(directory, "content"),
    untrusted: true,
  };
}
/** 为 SMTP 构造 Buffer 附件，显式拒绝任意路径与 URL。 */
export async function outgoing_attachments(
  storage: PowerStorage,
  attachment_ids: string[] = [],
) {
  const attachments: Mail.Attachment[] = [];
  let total = 0;
  for (const attachment_id of attachment_ids) {
    z.uuid().parse(attachment_id);
    const directory = `attachments/${attachment_id}`;
    if ((await storage.files.file_size(`${directory}/manifest.json`)) > 2048)
      throw new Error("Invalid attachment metadata");
    const manifest = manifest_schema.parse(
      JSON.parse(
        (await storage.files.read_file(`${directory}/manifest.json`)).toString(
          "utf8",
        ),
      ),
    );
    const size = await storage.files.file_size(`${directory}/content`);
    total += size;
    if (size !== manifest.size || total > MAX_ATTACHMENT_BYTES)
      throw new Error("Outgoing attachments exceed 20 MiB or have changed");
    const content = await storage.files.read_file(`${directory}/content`);
    if (content.length !== size)
      throw new Error("Attachment changed while reading");
    attachments.push({
      filename: safe_filename(manifest.filename),
      contentType: manifest.content_type,
      content,
    });
  }
  return attachments;
}
