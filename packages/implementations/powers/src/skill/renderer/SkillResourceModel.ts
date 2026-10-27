/** Resource projections keep canonical sharing separate from source-owned navigation and reads. */
import type { SkillMainviewSnapshot } from "@/skill/types/SkillMainview.js";

/** A distinct physical Skill with one stable, validated source used for navigation and reads. */
export interface SkillResource {
  /** Source-owned route key; contains no filesystem path and is never used directly to read. */
  readonly route_id: string;
  /** Canonical directory identity supplied by the host for shared usage comparison. */
  readonly resource_id: string;
  /** Exact directory ID passed to the source's read action. */
  readonly skill_id: string;
  /** Owner Agent ID, or null for a home-directory entry. */
  readonly agent_id: string | null;
  /** Human-readable owner label for disambiguating identical Skill names. */
  readonly source_label: string;
  /** Display-only directory path supplied by the host. */
  readonly source_path: string;
  /** Skill frontmatter title. */
  readonly name: string;
  /** Skill frontmatter description. */
  readonly description: string;
}

/** Prefer the home entry for shared directories; preserve all independent Agent copies. */
export function collect_skills(snapshot?: SkillMainviewSnapshot): SkillResource[] {
  const resources = new Map<string, SkillResource>();
  for (const skill of snapshot?.available ?? []) {
    if (!resources.has(skill.resource_id)) resources.set(skill.resource_id, {
      ...skill, skill_id: skill.id, agent_id: null, source_label: "用户目录",
      route_id: skill_route_id(null, skill.id),
    });
  }
  for (const agent of snapshot?.agents ?? []) for (const skill of agent.skills) {
    if (!resources.has(skill.resource_id)) resources.set(skill.resource_id, {
      ...skill, skill_id: skill.id, agent_id: agent.agent_id, source_label: `Agent · ${agent.name}`,
      route_id: skill_route_id(agent.agent_id, skill.id),
    });
  }
  return [...resources.values()].sort((left, right) => left.name.localeCompare(right.name) || left.route_id.localeCompare(right.route_id));
}

/** Resolve the selected source even if another alias becomes the preferred sidebar entry. */
export function find_skill_resource(snapshot: SkillMainviewSnapshot | undefined, route_id: string): SkillResource | undefined {
  const listed = collect_skills(snapshot).find((skill) => skill.route_id === route_id);
  if (listed || !snapshot) return listed;
  for (const skill of snapshot.available) if (skill_route_id(null, skill.id) === route_id) {
    return { ...skill, skill_id: skill.id, agent_id: null, source_label: "用户目录", route_id };
  }
  for (const agent of snapshot.agents) for (const skill of agent.skills) {
    if (skill_route_id(agent.agent_id, skill.id) === route_id) {
      return { ...skill, skill_id: skill.id, agent_id: agent.agent_id, source_label: `Agent · ${agent.name}`, route_id };
    }
  }
  return undefined;
}

/** Encode owner and directory separately, preventing collisions between home and Agent sources. */
function skill_route_id(agent_id: string | null, skill_id: string): string {
  return agent_id === null ? `home:${encodeURIComponent(skill_id)}` : `agent:${encodeURIComponent(agent_id)}:${encodeURIComponent(skill_id)}`;
}
