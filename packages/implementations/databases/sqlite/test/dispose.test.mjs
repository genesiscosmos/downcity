/** 原生 SQLite 释放必须等待已接受的事务和排队操作，保留提交/回滚语义。 */
import assert from "node:assert/strict";
import test from "node:test";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Database } from "../bin/index.js";

for (const should_fail of [false, true]) {
  test(`concurrent dispose waits for transaction ${should_fail ? "rollback" : "commit"}`, async () => {
    const database = new Database({ filename: ":memory:" });
    const schema = sqliteTable("close_probe", { item_id: text("item_id").primaryKey() });
    await database.ensure_table(schema);
    const table = database.table(schema);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const running = database.transaction(async (transaction) => {
      await transaction.table(schema).insert({ item_id: "in_transaction" });
      entered.resolve();
      await release.promise;
      if (should_fail) throw new Error("expected_transaction_failure");
      await transaction.table(schema).insert({ item_id: "before_commit" });
    });
    // 提前安装拒绝观察，关闭竞争不能产生未处理 rejection。
    const completed = should_fail ? assert.rejects(running, /expected_transaction_failure/u) : running;
    try {
      await entered.promise;
      // 关闭之前接受的普通操作要在事务结束后完成，读到正确的提交/回滚结果。
      const queued = table.select();
      const first_close = database.dispose();
      const second_close = database.dispose();
      assert.equal(first_close, second_close);
      let closed = false;
      void first_close.then(() => { closed = true; });
      await new Promise(setImmediate);
      assert.equal(closed, false);
      await assert.rejects(table.select(), { name: "DatabaseClosedError" });
      release.resolve();
      await completed;
      const rows = await queued;
      assert.equal(rows.length, should_fail ? 0 : 2);
      await Promise.all([first_close, second_close]);
      assert.equal(closed, true);
      await assert.rejects(database.query({ sql: "SELECT 1", params: [] }), { name: "DatabaseClosedError" });
    } finally {
      release.resolve();
      await completed;
      await database.dispose();
    }
  });
}
