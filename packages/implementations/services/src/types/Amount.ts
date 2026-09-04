/**
 * Credits 金额类型。
 *
 * 关键说明（中文）
 * - credits 是系统唯一账务单位
 * - 1 USD = 1_000_000 credits
 * - 数据库与账务计算统一使用 credits 整数，避免浮点误差
 */

/**
 * 1 USD 对应的 credits 数量。
 */
export const CREDITS_PER_USD = 1_000_000;

/**
 * USD 展示小数精度。
 */
export const USD_DECIMAL_PLACES = 6;

/**
 * 以 credits 表示的账务金额。
 */
export type Credits = number;
