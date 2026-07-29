/** Organizations Service 的 ULID 风格稳定 ID 生成器。 */

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 生成 Organization ID。 */
export function new_organization_id(): string {
  return `org_${new_ulid()}`;
}

/** 生成 Membership ID。 */
export function new_membership_id(): string {
  return `mem_${new_ulid()}`;
}

/** 生成 Join Request ID。 */
export function new_join_request_id(): string {
  return `join_${new_ulid()}`;
}

/** 生成撤权 Event ID。 */
export function new_organization_event_id(): string {
  return `orgevt_${new_ulid()}`;
}

/** 生成按时间大致有序的 26 位 Crockford Base32 ID。 */
function new_ulid(): string {
  let time = Date.now();
  let encoded_time = "";
  for (let index = 0; index < 10; index += 1) {
    encoded_time = alphabet[time % 32] + encoded_time;
    time = Math.floor(time / 32);
  }
  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  let encoded_random = "";
  for (let index = 0; index < 16; index += 1) {
    encoded_random += alphabet[random[index] % 32];
  }
  return `${encoded_time}${encoded_random}`;
}
