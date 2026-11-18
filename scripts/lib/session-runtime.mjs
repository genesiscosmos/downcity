/**
 * Current pure-protocol/runtime bridge for offline maintenance.
 *
 * Load the checked-out codec/schema/Step algorithm directly, so stale bin artifacts cannot
 * silently define maintenance. Historical schemas are owned by separate offline loaders;
 * this bridge never imports a per-Session database schema. Hooks are scoped to the agent/type source trees and are
 * removed after loading. Node >= 22.18 and installed workspace dependencies are required.
 * No Agent, City host, filesystem store or execution loop is constructed here.
 */
import fs from "node:fs";
import path from "node:path";
import { registerHooks as register_hooks, stripTypeScriptTypes as strip_types, createRequire as create_require } from "node:module";
import { fileURLToPath as file_url_to_path, pathToFileURL as path_to_file_url } from "node:url";

const public_root = path.resolve(path.dirname(file_url_to_path(import.meta.url)), "../..");
const agent_source = path.join(public_root, "packages/agent/src/");
const type_source = path.join(public_root, "packages/type/src/");
const city_source = path.join(public_root, "packages/city/src/");

/** Import only pure runtime modules, with source-local aliases and TS transformation. */
export async function load_runtime(agent_database = true, protocol = "current") {
  if (!["current", "historical-v9", "historical-v10"].includes(protocol)) throw new Error("offline_runtime_protocol_invalid");
  const historical_version = protocol === "historical-v9" ? 9 : protocol === "historical-v10" ? 10 : undefined;
  // City 的错误类使用 TS 参数属性；由已安装编译器转换，避免依赖 Node 的实验转换模式。
  const typescript = agent_database ? create_require(path.join(city_source, "offline.cjs"))("typescript") : undefined;
  const hook = register_hooks({
    resolve(specifier, context, next_resolve) {
      const parent_path = context.parentURL?.startsWith("file:") ? file_url_to_path(context.parentURL) : "";
      if ([agent_source, type_source, city_source].some(root => parent_path.startsWith(root))) {
        let target;
        if (specifier.startsWith("@/")) target = path.join(parent_path.startsWith(city_source) ? city_source : agent_source, specifier.slice(2));
        // 纯门禁只依赖 schema，离线桥不加载 Agent 执行器或已构建的 package 入口。
        else if (specifier === "@downcity/agent" && parent_path === path.join(city_source, "local/resources/SessionStorageReadiness.ts")) target = path.join(agent_source, "session/storage/agent-db/AgentSessionSchema.ts");
        else if (specifier === "@downcity/type") target = path.join(type_source, "index.ts");
        else if (specifier.startsWith("@downcity/type/")) target = path.join(type_source, `${specifier.slice(15)}.ts`);
        else if (specifier.startsWith(".")) target = path.resolve(path.dirname(parent_path), specifier);
        if (target?.endsWith(".js")) target = `${target.slice(0, -3)}.ts`;
        if (target && fs.existsSync(target)) return { url: path_to_file_url(target).href, shortCircuit: true };
      }
      return next_resolve(specifier, context);
    },
    load(url, context, next_load) {
      const file_path = url.startsWith("file:") ? file_url_to_path(url) : "";
      if (file_path.endsWith(".ts") && [agent_source, type_source, city_source].some(root => file_path.startsWith(root))) {
        const source = fs.readFileSync(file_path, "utf8");
        return { format: "module", source: file_path.startsWith(city_source)
          ? typescript.transpileModule(source, { compilerOptions: { target: typescript.ScriptTarget.ESNext, module: typescript.ModuleKind.ESNext } }).outputText
          : strip_types(source, { mode: "strip", sourceUrl: url }), shortCircuit: true };
      }
      return next_load(url, context);
    },
  });
  try {
    const load = relative => import(path_to_file_url(path.join(agent_source, relative)).href);
    const modules = await Promise.all([
      historical_version
        ? import(new URL(`../fixtures/session-v${historical_version}/codec.mjs`, import.meta.url))
        : load("session/storage/SessionStorageCodec.ts"),
      load("session/messages/SessionStablePrefix.ts"),
      load("types/sdk/SessionPromptActor.ts"),
      load("session/storage/SessionMessagePreview.ts"),
      load("session/loop/SessionInputFacts.ts"),
    ]);
    if (agent_database) modules.push(...await Promise.all([
      load("session/storage/agent-db/AgentSessionSchema.ts"),
      load("session/storage/agent-db/AgentSessionFileLease.ts"),
      load("session/storage/ModelBindingCodec.ts"),
      protocol === "historical-v9"
        ? import(new URL("../fixtures/session-v9/result-reference.mjs", import.meta.url))
        : load("model/results/ResultReference.ts"),
      protocol === "historical-v9"
        ? import(new URL("../fixtures/session-v9/result-disclosure.mjs", import.meta.url))
        : load("model/results/ResultDisclosure.ts"),
      import(path_to_file_url(path.join(city_source, "local/resources/RootLease.ts")).href),
      import(path_to_file_url(path.join(city_source, "local/resources/SessionStorageReadiness.ts")).href),
      import(path_to_file_url(path.join(type_source, "types/session/SessionOrigin.ts")).href),
      import(path_to_file_url(path.join(type_source, "types/workspace/AttachmentPolicy.ts")).href),
    ]));
    const runtime = Object.assign({}, ...modules);
    if (historical_version && agent_database) {
      runtime.AGENT_SESSION_SCHEMA_VERSION = historical_version;
      runtime.AGENT_SESSION_SCHEMA_SQL = fs.readFileSync(new URL(`../fixtures/session-v${historical_version}/schema.sql`, import.meta.url), "utf8");
      runtime.assert_agent_session_schema = (database, agent_id) => {
        if (database.prepare("PRAGMA user_version").get().user_version !== historical_version) throw new Error(`v${historical_version}_tool_database_version_mismatch`);
        const row = database.prepare("SELECT agent_id,format_version FROM storage_metadata WHERE singleton_id=1").get();
        if (row?.agent_id !== agent_id || row.format_version !== historical_version) throw new Error("session_storage_identity_conflict");
      };
      Object.assign(runtime, await import(new URL(`../fixtures/session-v${historical_version}/readiness.mjs`, import.meta.url)));
    }
    return runtime;
  } finally { hook.deregister(); }
}
