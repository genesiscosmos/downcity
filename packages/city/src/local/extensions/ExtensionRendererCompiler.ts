/**
 * Power 浏览器源码独立编译，不执行浏览器入口。相对 import 和资产限定在固定快照内，
 * React/DOM/Power SDK 只通过宿主模块桥接；作者 node_modules 中的副本不会进入 bundle。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import type { ExtensionRendererArtifact, ExtensionRendererCompileOptions } from "../types/ExtensionRenderer.js";
import { ExtensionFailure } from "./ExtensionError.js";

/** 首版浏览器稳定宿主模块，不暴露 Node SDK、数据库或主进程对象。 */
export const EXTENSION_BROWSER_MODULES: Readonly<Record<string, string>> = Object.freeze({
  react: "downcity-power://runtime/react",
  "react/jsx-runtime": "downcity-power://runtime/react/jsx-runtime",
  "react/jsx-dev-runtime": "downcity-power://runtime/react/jsx-dev-runtime",
  "react-dom": "downcity-power://runtime/react-dom",
  "@downcity/city/power/react": "downcity-power://runtime/power-react",
});

/** 编译并原子写出浏览器产物，具体入口由唯一项目导出的 Power 对象声明。 */
export async function compile_extension_renderer(options: ExtensionRendererCompileOptions): Promise<ExtensionRendererArtifact> {
  const source = await fs.realpath(options.source_path);
  const requested = path.resolve(source, options.entry);
  if (!inside(source, requested)) throw new ExtensionFailure("renderer_entry_invalid", "Renderer entry must stay inside the project", "compile", 2);
  const manifest = await fs.readFile(path.join(source, "package.json"), "utf8").then((text) => JSON.parse(text), () => ({}));
  const declared = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies }));
  const output = path.resolve(options.output_path);
  let result;
  try {
    result = await build({ entryPoints: [requested], outfile: path.join(output, "renderer.js"), bundle: true, write: false, metafile: true,
      platform: "browser", format: "esm", target: "es2022", jsx: "automatic", logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
      loader: { ".png": "file", ".jpg": "file", ".jpeg": "file", ".webp": "file", ".gif": "file", ".svg": "file", ".woff": "file", ".woff2": "file", ".ttf": "file" },
      assetNames: "assets/[name]-[hash]", publicPath: options.resource_base_url,
      plugins: [{ name: "extension-browser-boundary", setup(builder) {
        builder.onResolve({ filter: /.*/ }, async (args) => {
          if (args.pluginData === "resolved") return;
          const runtime = options.runtime_modules[args.path];
          if (runtime) return { path: runtime, external: true };
          if (args.path.startsWith("@downcity/") || args.path.startsWith("react/") || args.path.startsWith("react-dom/") || args.path.startsWith("node:") || /^(https?:|file:|data:)/u.test(args.path)) throw new Error("Unsupported browser runtime module");
          if (!args.path.startsWith(".") && !path.isAbsolute(args.path) && !args.path.startsWith("#") && !args.importer.split(path.sep).includes("node_modules")) {
            const package_name = args.path.startsWith("@") ? args.path.split("/").slice(0, 2).join("/") : args.path.split("/")[0]!;
            if (!declared.has(package_name)) throw new Error("Browser dependency must be declared");
          }
          const resolved = await builder.resolve(args.path, { resolveDir: args.resolveDir, importer: args.importer, kind: args.kind, pluginData: "resolved" });
          if (resolved.errors.length) return resolved;
          const actual = await fs.realpath(resolved.path);
          if (!inside(source, actual)) throw new Error("Browser import escapes project");
          return { path: actual };
        });
      } }],
    });
  } catch { throw new ExtensionFailure("renderer_compile_failed", "Renderer compilation failed; check browser imports, dependencies and project paths", "compile", 2, { entry: options.entry }); }
  const files: Record<string, string> = {};
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true, mode: 0o700 });
  for (const file of result.outputFiles) {
    const relative = path.relative(output, file.path).split(path.sep).join("/");
    if (!inside(output, file.path)) throw new ExtensionFailure("renderer_output_invalid", "Renderer output escapes its generation", "compile", 2);
    files[relative] = createHash("sha256").update(file.contents).digest("hex");
    await fs.mkdir(path.dirname(file.path), { recursive: true });
    await fs.writeFile(file.path, file.contents, { mode: 0o600 });
  }
  return { directory: output, entry: "renderer.js", files, styles: Object.keys(files).filter((name) => name.endsWith(".css")) };
}

/** 只读取当前活动编译产物，路径和摘要每次重新确认；不暴露源码或依赖目录。 */
export async function read_extension_renderer_resource(artifact: ExtensionRendererArtifact, resource: string): Promise<Response> {
  if (!resource || resource.includes("\\") || resource.includes("\0") || resource.split("/").some((part) => !part || part === "." || part === "..") || !Object.hasOwn(artifact.files, resource)) return new Response("Not Found", { status: 404 });
  try {
    const filename = path.resolve(artifact.directory, resource);
    const root = await fs.realpath(artifact.directory);
    const actual = await fs.realpath(filename);
    if (!inside(root, actual) || path.resolve(root, resource) !== actual || (await fs.lstat(filename)).isSymbolicLink()) throw new Error();
    const contents = await fs.readFile(actual);
    if (createHash("sha256").update(contents).digest("hex") !== artifact.files[resource]) throw new Error();
    return new Response(new Uint8Array(contents), { headers: { "Content-Type": renderer_content_type(resource), "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response("Renderer resource is unavailable", { status: 410 }); }
}

/** 所有浏览器资源均使用固定 MIME，不允许目录猜测。 */
function renderer_content_type(filename: string): string {
  const types: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf" };
  return types[path.extname(filename)] ?? "application/octet-stream";
}

function inside(root: string, filename: string): boolean {
  const relative = path.relative(root, filename);
  return Boolean(relative) && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}
