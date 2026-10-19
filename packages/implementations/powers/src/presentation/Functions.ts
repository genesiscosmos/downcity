/** Presentation 的本地领域计算，注册到 OpenUI 函数目录；不访问网络或模型。 */
import { defineFunction } from "@openuidev/lang-core";
import { z } from "zod";

const compound_parameters = z.object({
  principal: z.number().min(0).max(1e12),
  annual_rate: z.number().min(-1).max(1),
  years: z.number().int().min(1).max(100),
});

/** 以年为采样点的有界复利序列，年利率使用小数。 */
export const COMPOUND_VALUES = defineFunction({
  name: "CompoundValues",
  description: "Annual compound-interest values from year 0 through years. Rate is decimal: 0.05 = 5%. principal 0..1e12, annual_rate -1..1, integer years 1..100.",
  params: compound_parameters,
  returns: z.array(z.number().finite()).max(101),
  fn: ({ principal, annual_rate, years }) => Array.from({ length: years + 1 }, (_, year) => principal * (1 + annual_rate) ** year),
});

/** 有界年限标签，与复利序列长度保持一致。 */
export const YEAR_LABELS = defineFunction({
  name: "YearLabels",
  description: "Labels for years 0 through years, integer years 1..100.",
  params: z.object({ years: z.number().int().min(1).max(100) }),
  returns: z.array(z.string()).max(101),
  fn: ({ years }) => Array.from({ length: years + 1 }, (_, year) => String(year)),
});
