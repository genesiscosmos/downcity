import { method_not_allowed, read_manifest } from "../_lib/release";

/** 将稳定下载地址重定向到当前版本 DMG。 */
export async function onRequest(context: PagesFunction<{ RELEASES: R2Bucket }>): Promise<Response> {
  if (context.request.method !== "GET" && context.request.method !== "HEAD") return method_not_allowed();
  if (!context.env.RELEASES) return new Response("Release bucket is not configured.", { status: 500 });
  const manifest = await read_manifest(context.env.RELEASES);
  if (!manifest) return new Response("Release manifest is unavailable or invalid.", { status: 502 });
  const url = new URL(context.request.url);
  url.pathname = `/download/macos/${manifest.version}/${manifest.file}`;
  return Response.redirect(url.toString(), 302);
}
