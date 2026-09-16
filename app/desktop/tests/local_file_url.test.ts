/**
 * @file 验证 Desktop 本地文件 URL 的编解码与 Markdown 图片地址改写。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  build_local_file_url,
  is_url_like,
  read_local_file_path,
  read_local_file_url,
  resolve_markdown_image_src,
} from "../src/common/file/local_file_url.ts";

test("绝对路径编码为受控协议 URL", () => {
  assert.equal(build_local_file_url("/Users/a/b.png"), "downcity-file://local/Users/a/b.png");
  // 逐段编码：空格与中文进入 URL，分隔符保持原样。
  assert.equal(
    build_local_file_url("/Users/a b/图 1.png"),
    "downcity-file://local/Users/a%20b/%E5%9B%BE%201.png",
  );
});

test("拒绝相对路径与协议相对地址", () => {
  assert.equal(build_local_file_url("./a.png"), null);
  assert.equal(build_local_file_url("a.png"), null);
  assert.equal(build_local_file_url("//host/a.png"), null);
  assert.equal(build_local_file_url(""), null);
});

test("协议 URL 可解回绝对路径", () => {
  assert.equal(read_local_file_url("downcity-file://local/Users/a%20b.png"), "/Users/a b.png");
  assert.equal(read_local_file_path("/Users/a%20b.png"), "/Users/a b.png");
});

test("拒绝非本协议、非本 host 与非法编码", () => {
  assert.equal(read_local_file_url("https://example.com/a.png"), null);
  assert.equal(read_local_file_url("downcity-file://other/a.png"), null);
  assert.equal(read_local_file_path("Users/a.png"), null);
  assert.equal(read_local_file_path("/a%2.png"), null);
  assert.equal(read_local_file_path("/a\0b"), null);
});

test("Markdown 图片地址按来源分流改写", () => {
  // 本地绝对路径与 file URL 改写为受控协议。
  assert.equal(resolve_markdown_image_src("/tmp/a.png"), "downcity-file://local/tmp/a.png");
  assert.equal(
    resolve_markdown_image_src("file:///tmp/a.png"),
    "downcity-file://local/tmp/a.png",
  );
  // 网络、内联与相对地址原样保留。
  assert.equal(
    resolve_markdown_image_src("https://example.com/a.png"),
    "https://example.com/a.png",
  );
  assert.equal(resolve_markdown_image_src("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
  assert.equal(resolve_markdown_image_src("./a.png"), "./a.png");
  assert.equal(resolve_markdown_image_src("//host/a.png"), "//host/a.png");
  // 已是受控协议时不重复改写。
  assert.equal(
    resolve_markdown_image_src("downcity-file://local/tmp/a.png"),
    "downcity-file://local/tmp/a.png",
  );
  // 空值与畸形输入保持原样，不能抛错。
  assert.equal(resolve_markdown_image_src(""), "");
  assert.equal(resolve_markdown_image_src("file://"), "file://");
});

test("协议识别不把本地路径误判为 URL", () => {
  assert.equal(is_url_like("https://a/b"), true);
  assert.equal(is_url_like("/tmp/a.png"), false);
});
