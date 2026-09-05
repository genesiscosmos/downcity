/** Desktop 中英文翻译资源结构测试。 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const namespaces = ["common", "navigation", "settings", "chat", "resources", "plugin"] as const;

/** 将嵌套翻译对象展开成稳定 key 集合。 */
function flatten_keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) => flatten_keys(child, prefix ? `${prefix}.${key}` : key));
}

/** 读取一份打包前翻译资源。 */
async function read_resource(language: "en" | "zh", namespace: typeof namespaces[number]): Promise<Record<string, unknown>> {
  const url = new URL(`../src/renderer/locales/${language}/${namespace}.json`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8")) as Record<string, unknown>;
}

test("中英文翻译资源拥有完全相同的 key", async () => {
  for (const namespace of namespaces) {
    const [english, chinese] = await Promise.all([read_resource("en", namespace), read_resource("zh", namespace)]);
    assert.deepEqual(flatten_keys(chinese).sort(), flatten_keys(english).sort(), `${namespace} namespace key 不一致`);
  }
});

test("翻译资源不包含空文案", async () => {
  for (const language of ["en", "zh"] as const) {
    for (const namespace of namespaces) {
      const resource = await read_resource(language, namespace);
      const empty_keys = flatten_keys(resource).filter((key) => {
        const value = key.split(".").reduce<unknown>((current, segment) => current && typeof current === "object" ? (current as Record<string, unknown>)[segment] : undefined, resource);
        return typeof value !== "string" || !value.trim();
      });
      assert.deepEqual(empty_keys, [], `${language}/${namespace} 存在空文案`);
    }
  }
});
