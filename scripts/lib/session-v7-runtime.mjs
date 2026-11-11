/**
 * Offline migration's source-runtime bridge.
 *
 * Load the checked-out codec/schema/Step algorithm directly, so stale bin artifacts cannot
 * silently define the migration. Hooks are scoped to the agent/type source trees and are
 * removed after loading. Node >= 22.18 and installed workspace dependencies are required.
 * No Agent, City host, filesystem store or execution loop is constructed here.
 */
import fs from "node:fs";
import { fail } from "./session-v7-database.mjs";
import path from "node:path";
import { registerHooks as register_hooks, stripTypeScriptTypes as strip_types } from "node:module";
import { fileURLToPath as file_url_to_path, pathToFileURL as path_to_file_url } from "node:url";

const public_root = path.resolve(path.dirname(file_url_to_path(import.meta.url)), "../..");
const agent_source = path.join(public_root, "packages/agent/src/");
const type_source = path.join(public_root, "packages/type/src/");

/** Import only pure runtime modules, with source-local aliases and TS transformation. */
export async function load_runtime() {
  const hook = register_hooks({
    resolve(specifier, context, next_resolve) {
      const parent_path = context.parentURL?.startsWith("file:") ? file_url_to_path(context.parentURL) : "";
      if (parent_path.startsWith(agent_source) || parent_path.startsWith(type_source)) {
        let target;
        if (specifier.startsWith("@/")) target = path.join(agent_source, specifier.slice(2));
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
      if (file_path.endsWith(".ts") && (file_path.startsWith(agent_source) || file_path.startsWith(type_source))) {
        return { format: "module", source: strip_types(fs.readFileSync(file_path, "utf8"), { mode: "strip", sourceUrl: url }), shortCircuit: true };
      }
      return next_load(url, context);
    },
  });
  try {
    const load = relative => import(path_to_file_url(path.join(agent_source, relative)).href);
    const schema = await load("session/storage/SessionStorageSchema.ts");
    if (schema.SESSION_STORAGE_SCHEMA_VERSION !== 7) fail("runtime_target_is_not_v7");
    const modules = await Promise.all([
      load("session/storage/SessionStorageCodec.ts"),
      load("session/messages/SessionStablePrefix.ts"),
      load("types/sdk/SessionPromptActor.ts"),
      load("session/storage/SessionMessagePreview.ts"),
      load("session/loop/SessionInputFacts.ts"),
    ]);
    return Object.assign({}, schema, ...modules);
  } finally { hook.deregister(); }
}
