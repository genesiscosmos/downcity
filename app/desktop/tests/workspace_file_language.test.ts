/** 源码视图语言识别测试。 */

import assert from "node:assert/strict";
import test from "node:test";
import { resolve_workspace_language, supported_languages } from "../src/renderer/lib/workspace/workspace_file_language.ts";

test("按扩展名识别常见语言", () => {
  assert.equal(resolve_workspace_language("src/index.ts"), "typescript");
  assert.equal(resolve_workspace_language("src/App.tsx"), "tsx");
  assert.equal(resolve_workspace_language("scripts/build.mjs"), "javascript");
  assert.equal(resolve_workspace_language("docs/guide.mdx"), "mdx");
  assert.equal(resolve_workspace_language("styles/theme.scss"), "scss");
  assert.equal(resolve_workspace_language("config/app.yaml"), "yaml");
});

test("大小写不敏感，并取最后一个扩展名", () => {
  assert.equal(resolve_workspace_language("SRC/Index.TS"), "typescript");
  assert.equal(resolve_workspace_language("archive.tar.gz"), undefined);
});

test("无扩展名时按文件名识别", () => {
  assert.equal(resolve_workspace_language("docker/Dockerfile"), "dockerfile");
  assert.equal(resolve_workspace_language("Makefile"), "makefile");
  assert.equal(resolve_workspace_language(".bashrc"), "shellscript");
});

test("未登记的类型不着色", () => {
  assert.equal(resolve_workspace_language(".gitignore"), undefined);
  assert.equal(resolve_workspace_language("assets/logo.png"), undefined);
  assert.equal(resolve_workspace_language("LICENSE"), undefined);
  assert.equal(resolve_workspace_language(""), undefined);
});

test("识别结果都在受支持语言表内", () => {
  const samples = ["a.ts", "b.py", "c.rs", "d.go", "Dockerfile", "Makefile", "e.kt", "f.lua"];
  for (const sample of samples) {
    const language = resolve_workspace_language(sample);
    if (language) assert.ok(supported_languages.includes(language), `${sample} → ${language} 不在受支持语言表内`);
  }
});
