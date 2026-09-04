/**
 * @file City 根入口应用装配 facade 测试。
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Agent,
  City,
  Group,
  LocalFileSystem,
  LocalStorageProvider,
  MemoryStorageProvider,
  RemoteAgent,
  Shell,
  Workspace,
} from "../bin/index.js";

test("City 根入口导出应用装配所需的稳定构造器", () => {
  for (const constructor of [
    Agent,
    City,
    Group,
    LocalFileSystem,
    LocalStorageProvider,
    MemoryStorageProvider,
    RemoteAgent,
    Shell,
    Workspace,
  ]) {
    assert.equal(typeof constructor, "function");
  }
});
