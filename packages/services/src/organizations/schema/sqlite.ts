/** Organizations Service 的 SQLite Schema 与幂等 DDL。 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Organization 主表。 */
export const sqlite_organizations = sqliteTable("service_organizations", {
  organization_id: text("organization_id").primaryKey(),
  name: text("name").notNull(),
  scope_type: text("scope_type").notNull(),
  scope_bureau_id: text("scope_bureau_id").notNull(),
  state: text("state").notNull(),
  created_by: text("created_by").notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
  archived_at: text("archived_at").notNull(),
});

/** Organization Membership 历史表。 */
export const sqlite_organization_memberships = sqliteTable("service_organization_memberships", {
  membership_id: text("membership_id").primaryKey(),
  organization_id: text("organization_id").notNull(),
  user_id: text("user_id").notNull(),
  role: text("role").notNull(),
  state: text("state").notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
  removed_at: text("removed_at").notNull(),
  removed_by: text("removed_by").notNull(),
});

/** 用户当前拥有 Organization 的并发安全额度槽位。 */
export const sqlite_organization_owner_slots = sqliteTable("service_organization_owner_slots", {
  user_id: text("user_id").notNull(),
  slot: integer("slot").notNull(),
  organization_id: text("organization_id").primaryKey(),
  created_at: text("created_at").notNull(),
});

/** 用户主动申请加入 Organization 的记录。 */
export const sqlite_organization_join_requests = sqliteTable("service_organization_join_requests", {
  request_id: text("request_id").primaryKey(),
  organization_id: text("organization_id").notNull(),
  user_id: text("user_id").notNull(),
  state: text("state").notNull(),
  requested_at: text("requested_at").notNull(),
  decided_at: text("decided_at").notNull(),
  decided_by: text("decided_by").notNull(),
});

/** SQLite 完整数据库约束，必须在通用建表器前执行。 */
export const sqlite_organizations_ddl = [
  `CREATE TABLE IF NOT EXISTS service_organizations (
    organization_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('federation', 'bureau')),
    scope_bureau_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT NOT NULL,
    CHECK ((scope_type = 'federation' AND scope_bureau_id = '') OR (scope_type = 'bureau' AND scope_bureau_id <> ''))
  )`,
  `CREATE TABLE IF NOT EXISTS service_organization_memberships (
    membership_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES service_organizations(organization_id),
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    state TEXT NOT NULL CHECK (state IN ('active', 'removed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    removed_at TEXT NOT NULL,
    removed_by TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS service_organization_owner_slots (
    user_id TEXT NOT NULL,
    slot INTEGER NOT NULL CHECK (slot > 0),
    organization_id TEXT PRIMARY KEY REFERENCES service_organizations(organization_id),
    created_at TEXT NOT NULL,
    UNIQUE (user_id, slot)
  )`,
  `CREATE TABLE IF NOT EXISTS service_organization_join_requests (
    request_id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES service_organizations(organization_id),
    user_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'rejected', 'canceled')),
    requested_at TEXT NOT NULL,
    decided_at TEXT NOT NULL,
    decided_by TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS service_organization_active_member_idx ON service_organization_memberships (organization_id, user_id) WHERE state = 'active'",
  "CREATE UNIQUE INDEX IF NOT EXISTS service_organization_active_owner_idx ON service_organization_memberships (organization_id) WHERE state = 'active' AND role = 'owner'",
  "CREATE UNIQUE INDEX IF NOT EXISTS service_organization_pending_join_idx ON service_organization_join_requests (organization_id, user_id) WHERE state = 'pending'",
  "CREATE INDEX IF NOT EXISTS service_organization_membership_user_idx ON service_organization_memberships (user_id, state, organization_id)",
];

/** SQLite 方言下的全部 Organizations 表。 */
export const sqlite_organization_tables = {
  organizations: sqlite_organizations,
  memberships: sqlite_organization_memberships,
  owner_slots: sqlite_organization_owner_slots,
  join_requests: sqlite_organization_join_requests,
};
