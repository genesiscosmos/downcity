/**
 * 右侧 BayBar 的「域 / 分区」模型与选择规则。
 *
 * 两级语义：
 * - 一级 tab = 域（domain），回答「看哪个对象」，例如「Agent」「本轮」；
 * - 二级 tab = 分区（section），回答「看该对象的哪一部分」，例如「身份」「Model」。
 *
 * 与早期版本的关键差别：域是按语义划分的固定集合，不是「当前能提供什么」的枚举。
 * 因此「本轮」在没有文件改动时依然存在（显示空态），tab 条不会忽长忽短；
 * 以后新增「记忆」「任务」这类内容时，加一个域即可，不需要重新考虑组织原则。
 */

import type { ReactNode } from "react";

/** 域内的一个分区，对应二级 tab。 */
export interface BayBarSection {
  /** 分区稳定标识。 */
  id: string;
  /** 二级 tab 使用的名称。 */
  label: string;
  /** 分区内容。 */
  content: ReactNode;
}

/** 一级 tab 的一个域。 */
export interface BayBarDomain {
  /** 域稳定标识。 */
  id: string;
  /** 一级 tab 与无障碍标签使用的名称，用名词，尽量简短。 */
  label: string;
  /** 域内的分区；至少一个，否则该域不成立。 */
  sections: BayBarSection[];
}

/** 当前显示的位置。 */
export interface BayBarSelection {
  /** 当前域。 */
  domain_id: string;
  /** 当前域内的分区。 */
  section_id: string;
}

/** 把选择序列化为可持久化的字符串。 */
export function format_selection(selection: BayBarSelection): string {
  return `${selection.domain_id}:${selection.section_id}`;
}

/** 从持久化字符串还原选择；格式不合法时返回 null。 */
export function parse_selection(value: string | null): BayBarSelection | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const domain_id = value.slice(0, separator);
  const section_id = value.slice(separator + 1);
  return domain_id && section_id ? { domain_id, section_id } : null;
}

/**
 * 解析当前应当显示的选择。
 *
 * 优先沿用它之前的选择，失效时逐级回退，最终一定落在「第一个域的第一个分区」，
 * 而不是返回 null——展开右侧就应该有内容可看。域集合为空时才返回 null（右侧整体不存在）。
 */
export function resolve_selection(domains: readonly BayBarDomain[], previous: BayBarSelection | null): BayBarSelection | null {
  const usable_domains = domains.filter((domain) => domain.sections.length > 0);
  const first_domain = usable_domains[0];
  if (!first_domain) return null;
  if (previous) {
    const domain = usable_domains.find((item) => item.id === previous.domain_id);
    if (domain) {
      const section = domain.sections.find((item) => item.id === previous.section_id);
      return section ? previous : { domain_id: domain.id, section_id: domain.sections[0]!.id };
    }
  }
  return { domain_id: first_domain.id, section_id: first_domain.sections[0]!.id };
}

/** 切换域时，尽量保留该域上次看过的分区；没记录则用第一个。 */
export function resolve_domain_switch(domains: readonly BayBarDomain[], domain_id: string): BayBarSelection | null {
  const domain = domains.find((item) => item.id === domain_id);
  const section = domain?.sections[0];
  return domain && section ? { domain_id: domain.id, section_id: section.id } : null;
}

/** 当前视图的选择持久化键；不同视图之间互相隔离。 */
export function baybar_storage_key(view_key: string): string {
  return `downcity.baybar_selection:${view_key}`;
}
