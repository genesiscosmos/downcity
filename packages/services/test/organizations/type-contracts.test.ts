/** Organizations Service 公共类型编译契约。 */

import {
  OrganizationsService,
  type OrganizationCreateInput,
  type OrganizationMembershipRecord,
  type OrganizationScopeType,
} from "../../src/index.js";

const service = new OrganizationsService({ max_organizations_per_user: 3 });
const create_input: OrganizationCreateInput = {
  name: "Research Team",
  scope_type: "bureau",
};
const scope_type: OrganizationScopeType = "federation";
const membership = {} as OrganizationMembershipRecord;

void service;
void create_input;
void scope_type;
void membership;
