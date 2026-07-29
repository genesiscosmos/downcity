/** Organizations Service 公共类型编译契约。 */

import {
  OrganizationsService,
  type OrganizationCreateInput,
  type OrganizationMembershipRecord,
  type OrganizationTokenClaims,
} from "../../src/index.js";

const service = new OrganizationsService({ max_organizations_per_user: 3 });
const create_input: OrganizationCreateInput = {
  name: "Research Team",
  server_url: "https://spaces.example.com",
};
const claims: OrganizationTokenClaims = {
  user_id: "user_1",
  city_id: "vibecape",
  organization_id: "org_01J00000000000000000000000",
  membership_id: "mem_01J00000000000000000000000",
};
const membership = {} as OrganizationMembershipRecord;

void service;
void create_input;
void claims;
void membership;
