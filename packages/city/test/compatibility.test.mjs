/**
 * @downcity/city 迁移入口兼容测试。
 */

import assert from "node:assert/strict"
import test from "node:test"

import { City, Federation, FederationAdmin } from "../bin/index.js"

test("city package 继续转发旧 Federation API", () => {
  assert.equal(typeof City, "function")
  assert.equal(typeof Federation, "function")
  assert.equal(typeof FederationAdmin, "function")
})
