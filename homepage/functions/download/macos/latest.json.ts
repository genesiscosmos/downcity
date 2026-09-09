import { json_response, method_not_allowed, read_manifest } from "../../_lib/release";

/** 返回当前 macOS Desktop 稳定版本 manifest。 */
export async function onRequest(context: PagesFunction<{ RELEASES: R2Bucket }>): Promise<Response> {
  if (context.request.method !== "GET" && context.request.method !== "HEAD") return method_not_allowed();
  if (!context.env.RELEASES) return json_response({ error: "Release bucket is not configured." }, 500);
  const manifest = await read_manifest(context.env.RELEASES);
  if (!manifest) return json_response({ error: "Release manifest is unavailable or invalid." }, 502);
  const response = json_response(manifest, 200, "public, max-age=60");
  if (context.request.method === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
  return response;
}
