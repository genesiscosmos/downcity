/** Federation 关闭竞争回归：后台 Action / Hook 和维护结束前不得释放数据库。 */
import assert from "node:assert/strict";
import test from "node:test";
import { Downtown, Service } from "../bin/index.js";
import { createSqliteDb } from "./sqlite-db.mjs";

for (const operation of ["queue_action", "queue_after", "maintenance"]) {
  test(`dispose waits for ${operation} and rejects new work`, async () => {
    const database = createSqliteDb(":memory:");
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    let database_closes = 0;
    const close_database = database.on_dispose.bind(database);
    database.on_dispose = async () => { database_closes++; await close_database(); };
    const wait_and_query = async () => {
      entered.resolve();
      await release.promise;
      await database.query({ sql: "SELECT 1", params: [] });
    };
    class ProbeService extends Service {
      constructor() {
        super({ id: "dispose_probe", name: "Dispose probe" });
        const action = this.action("wait", async () => {
          if (operation === "queue_action") await wait_and_query();
          return { ok: true };
        });
        if (operation === "queue_after") action.after(wait_and_query);
      }
      async on_maintenance() { await wait_and_query(); }
    }
    const federation = new Downtown({ database });
    federation.use(new ProbeService());
    await federation.ready();
    const queue = federation.queue;
    const running = operation === "maintenance"
      ? federation.maintenance()
      : queue.call({ service: "dispose_probe", action: "wait" });
    try {
      await entered.promise;
      let closed = false;
      const closing = federation.dispose().then(() => { closed = true; });
      await new Promise(setImmediate);
      assert.equal(closed, false);
      assert.equal(database_closes, 0);
      await assert.rejects(queue.call({ service: "dispose_probe", action: "wait" }), /federation_disposed/u);
      assert.throws(() => federation.maintenance(), /federation_disposed/u);
      release.resolve();
      await running;
      await closing;
      await federation.dispose();
      assert.equal(closed, true);
      assert.equal(database_closes, 1);
    } finally {
      release.resolve();
      await running.catch(() => {});
      await federation.dispose();
    }
  });
}

test("dispose drains a failing queue execution before closing its database", async () => {
  const database = createSqliteDb(":memory:");
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const service = new Service({ id: "failure_probe", name: "Failure probe" });
  service.action("fail", async () => {
    entered.resolve();
    await release.promise;
    await database.query({ sql: "SELECT 1", params: [] });
    throw new Error("expected_action_failure");
  });
  const federation = new Downtown({ database });
  federation.use(service);
  await federation.ready();
  const running = assert.rejects(federation.queue.call({ service: service.id, action: "fail" }), /expected_action_failure/u);
  try {
    await entered.promise;
    const closing = federation.dispose();
    release.resolve();
    await running;
    await closing;
    await assert.rejects(database.query({ sql: "SELECT 1", params: [] }), { name: "DatabaseClosedError" });
  } finally {
    release.resolve();
    await running;
    await federation.dispose();
  }
});
