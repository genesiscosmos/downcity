/** Homepage Desktop release 下载协议的共享校验与响应工具。 */

export type ReleaseManifest = {
  /** 当前稳定版本号。 */
  version: string;
  /** macOS 安装包文件名。 */
  file: string;
  /** macOS 安装包在 R2 中的对象路径。 */
  path: string;
  /** R2 中 latest-mac.yml 的对象路径。 */
  latest_mac_yml_path: string;
};

export function method_not_allowed(): Response {
  return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
}

export function json_response(value: unknown, status = 200, cache_control = "no-store"): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache_control,
      "x-content-type-options": "nosniff",
    },
  });
}

export function is_valid_version(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value);
}

export function is_valid_filename(value: string): boolean {
  return /^downcity-\d+\.\d+\.\d+\.(?:dmg|zip)(?:\.blockmap|\.sha256)?$/.test(value) || value === "latest-mac.yml";
}

export function content_type_for(filename: string): string {
  if (filename.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (filename.endsWith(".zip")) return "application/zip";
  if (filename.endsWith(".sha256")) return "text/plain; charset=utf-8";
  if (filename.endsWith(".yml")) return "application/x-yaml; charset=utf-8";
  return "application/octet-stream";
}

export function content_disposition(filename: string): string {
  return `attachment; filename="${filename}"`;
}

export async function read_manifest(bucket: R2Bucket): Promise<ReleaseManifest | null> {
  const object = await bucket.get("releases/manifests/macos-latest.json");
  if (!object) return null;
  try {
    const manifest = await object.json<ReleaseManifest>();
    if (!manifest?.version || !manifest.file || !manifest.path || !manifest.latest_mac_yml_path) return null;
    if (!is_valid_version(manifest.version) || !is_valid_filename(manifest.file)) return null;
    return manifest;
  } catch {
    return null;
  }
}
