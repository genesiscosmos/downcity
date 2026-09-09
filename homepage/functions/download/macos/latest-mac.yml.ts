import { json_response, method_not_allowed, read_manifest } from "../../_lib/release";

/** 返回 electron-updater 所需的 macOS feed，并将产物 URL 指向 Pages 路由。 */
export async function onRequest(context: PagesFunction<{ RELEASES: R2Bucket }>): Promise<Response> {
  if (context.request.method !== "GET" && context.request.method !== "HEAD") return method_not_allowed();
  if (!context.env.RELEASES) return json_response({ error: "Release bucket is not configured." }, 500);
  const manifest = await read_manifest(context.env.RELEASES);
  if (!manifest) return json_response({ error: "Release manifest is unavailable or invalid." }, 502);
  const object = await context.env.RELEASES.get(manifest.latest_mac_yml_path);
  if (!object) return json_response({ error: "Latest macOS updater feed was not found." }, 404);
  const source = await object.text();
  const version_prefix = `/download/macos/${manifest.version}/`;
  const rewritten = source.replace(/(^\s*(?:-\s+)?(?:url|path):\s*)(downcity-\d+\.\d+\.\d+\.(?:dmg|zip)(?:\.blockmap)?)/gim, (_match, prefix, filename) => `${prefix}${version_prefix}${filename}`);
  return new Response(context.request.method === "HEAD" ? null : rewritten, {
    headers: { "content-type": "application/x-yaml; charset=utf-8", "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" },
  });
}
