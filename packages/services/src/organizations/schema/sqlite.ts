/** Organizations Service 的 SQLite Schema 与幂等 DDL。 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Organization 主表。 */
export const sqlite_organizations = sqliteTable("service_organizations", {
  organization_id: text("organization_id").primaryKey(),
  city_id: text("city_id").notNull(),
  name: text("name").notNull(),
  server_url: text("server_url").notNull(),
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
  city_id: text("city_id").notNull(),
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

/** 撤权事件 Outbox。 */
export const sqlite_organization_events = sqliteTable("service_organization_events", {
  event_id: text("event_id").primaryKey(),
  event_type: text("event_type").notNull(),
  city_id: text("city_id").notNull(),
  organization_id: text("organization_id").notNull(),
  membership_id: text("membership_id").notNull(),
  user_id: text("user_id").notNull(),
  target_url: text("target_url").notNull(),
  payload_json: text("payload_json").notNull(),
  delivery_state: text("delivery_state").notNull(),
  delivery_attempts: integer("delivery_attempts").notNull(),
  last_error: text("last_error").notNull(),
  created_at: text("created_at").notNull(),
  delivered_at: text("delivered_at").notNull(),
});

/** SQLite 完整数据库约束，必须在通用建表器前执行。 */
export const sqlite_organizations_ddl = [
  `CREATE TABLE IF NOT EXISTS service_organizations (
    organization_id TEXT PRIMARY KEY,
    city_id TEXT NOT NULL,
    name TEXT NOT NULL,
    server_url TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT NOT NULL
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
    city_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    slot INTEGER NOT NULL CHECK (slot > 0),
    organization_id TEXT PRIMARY KEY REFERENCES service_organizations(organization_id),
    created_at TEXT NOT NULL,
    UNIQUE (city_id, user_id, slot)
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
  `CREATE TABLE IF NOT EXISTS service_organization_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL CHECK (event_type IN ('organization.membership.removed', 'organization.archived', 'organization.server_url.changed')),
    city_id TEXT NOT NULL,
    organization_id TEXT NOT NULL REFERENCES service_organizations(organization_id),
    membership_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    target_url TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    delivery_state TEXT NOT NULL CHECK (delivery_state IN ('pending', 'delivered')),
    delivery_attempts INTEGER NOT NULL CHECK (delivery_attempts >= 0),
    last_error TEXT NOT NULL,
    created_at TEXT NOT NULL,
    delivered_at TEXT NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS service_organization_active_member_idx ON service_organization_memberships (organization_id, user_id) WHERE state = 'active'",
  "CREATE UNIQUE INDEX IF NOT EXISTS service_organization_active_owner_idx ON service_organization_memberships (organization_id) WHERE state = 'active' AND role = 'owner'",
  "CREATE UNIQUE INDEX IF NOT EXISTS service_organization_pending_join_idx ON service_organization_join_requests (organization_id, user_id) WHERE state = 'pending'",
  "CREATE INDEX IF NOT EXISTS service_organization_membership_user_idx ON service_organization_memberships (user_id, state, organization_id)",
  "CREATE INDEX IF NOT EXISTS service_organization_event_delivery_idx ON service_organization_events (delivery_state, created_at)",
];

/** SQLite 方言下的全部 Organizations 表。 */
export const sqlite_organization_tables = {
  organizations: sqlite_organizations,
  memberships: sqlite_organization_memberships,
  owner_slots: sqlite_organization_owner_slots,
  join_requests: sqlite_organization_join_requests,
  events: sqlite_organization_events,
};
