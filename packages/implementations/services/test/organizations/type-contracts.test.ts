/** Organizations Service 公共类型编译契约。 */

import {
  OrganizationsService,
  type OrganizationCreateInput,
  type OrganizationMembershipRecord,
} from "../../src/index.js";

const service = new OrganizationsService({ max_organizations_per_user: 3 });
const create_input: OrganizationCreateInput = {
  name: "Research Team",
  join_policy: "closed",
};
const membership = {} as OrganizationMembershipRecord;

void service;
void create_input;
void membership;
