import assert from "node:assert/strict";
import test from "node:test";
import { MIB, create_part_plan, format_progress, upload_small_object } from "./r2-multipart-upload.mjs";

test("R2 multipart plan keeps the final part smaller", () => {
  assert.deepEqual(create_part_plan(12 * MIB, 5 * MIB), [
    { part_number: 1, start: 0, end: 5 * MIB - 1, size: 5 * MIB },
    { part_number: 2, start: 5 * MIB, end: 10 * MIB - 1, size: 5 * MIB },
    { part_number: 3, start: 10 * MIB, end: 12 * MIB - 1, size: 2 * MIB },
  ]);
});

test("versioned R2 objects cannot be overwritten with different content", async () => {
  const client = { async send() { return { ContentLength: 10, Metadata: { sha256: "different" } }; } };
  await assert.rejects(upload_small_object({
    client,
    bucket: "downcity",
    key: "releases/packages/macos/0.1.0/downcity-0.1.0.dmg",
    file_path: "/unused",
    file_size: 10,
    sha256: "expected",
    content_type: "application/octet-stream",
    cache_control: "immutable",
  }), /immutable R2 object/);
});

test("progress formatter reports upload percentage", () => {
  assert.match(format_progress({ uploaded_bytes: MIB, total_bytes: 2 * MIB, completed_parts: 1, total_parts: 2, elapsed_ms: 1000 }), /50\.0%/);
});
