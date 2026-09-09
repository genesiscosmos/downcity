import { content_disposition, content_type_for, is_valid_filename, is_valid_version, method_not_allowed } from "../../../_lib/release";

/** 从 R2 流式返回指定版本的 Downcity Desktop 文件。 */
export async function onRequest(context: PagesFunction<{ RELEASES: R2Bucket }>): Promise<Response> {
  if (context.request.method !== "GET" && context.request.method !== "HEAD") return method_not_allowed();
  const version = String(context.params.version ?? "");
  const filename = String(context.params.filename ?? "");
  if (!is_valid_version(version) || !is_valid_filename(filename)) return new Response("Not Found", { status: 404 });
  if (!context.env.RELEASES) return new Response("Release bucket is not configured.", { status: 500 });
  const object = await context.env.RELEASES.get(`releases/packages/macos/${version}/${filename}`);
  if (!object) return new Response("Not Found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", content_type_for(filename));
  headers.set("content-disposition", content_disposition(filename));
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  return new Response(context.request.method === "HEAD" ? null : object.body, { headers });
}
