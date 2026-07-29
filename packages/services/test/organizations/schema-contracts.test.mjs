/** Organizations Service SQLite/PostgreSQL Schema 契约测试。 */

import assert from "node:assert/strict"
import test from "node:test"
import { getTableName } from "drizzle-orm"
import {
  pg_organization_events,
  pg_organization_join_requests,
  pg_organization_memberships,
  pg_organization_owner_slots,
  pg_organizations,
  sqlite_organization_events,
  sqlite_organization_join_requests,
  sqlite_organization_memberships,
  sqlite_organization_owner_slots,
  sqlite_organizations,
} from "../../bin/index.js"

test("organization schemas use identical physical table names across dialects", () => {
  const sqlite_tables = [
    sqlite_organizations,
    sqlite_organization_memberships,
    sqlite_organization_owner_slots,
    sqlite_organization_join_requests,
    sqlite_organization_events,
  ].map(getTableName)
  const postgres_tables = [
    pg_organizations,
    pg_organization_memberships,
    pg_organization_owner_slots,
    pg_organization_join_requests,
    pg_organization_events,
  ].map(getTableName)
  assert.deepEqual(postgres_tables, sqlite_tables)
  assert.equal(new Set(sqlite_tables).size, 5)
})
