/**
 * 溢价率计算引擎
 * 负责计算基金溢价率，并对数据进行校验和清洗
 * 溢价率公式：(市场价格 - 基金净值) / 基金净值 × 100%
 */
const logger = require('../utils/logger');

/**
 * 计算溢价率
 * @param {number} marketPrice - 市场交易价格
 * @param {number} nav - 基金净值
 * @returns {number|null} 溢价率百分比，数据无效时返回 null
 */
function calculatePremiumRate(marketPrice, nav) {
  // 数据有效性校验：必须为有效数字且净值大于0
  if (typeof marketPrice !== 'number' || typeof nav !== 'number') {
    return null;
  }
  if (isNaN(marketPrice) || isNaN(nav)) {
    return null;
  }
  if (nav <= 0) {
    logger.warn(`净值数据异常（≤0），无法计算溢价率: nav=${nav}`);
    return null;
  }
  // 溢价率 = (市场价格 - 净值) / 净值 × 100%
  const premiumRate = ((marketPrice - nav) / nav) * 100;
  // 四舍五入保留两位小数
  return Math.round(premiumRate * 100) / 100;
}

/**
 * 根据溢价率判断风险等级
 * @param {number|null} premiumRate - 溢价率
 * @returns {string} 风险等级：high(高风险)、medium(中风险)、low(低风险)、unknown(未知)
 */
function getRiskLevel(premiumRate) {
  if (premiumRate === null || premiumRate === undefined) {
    return 'unknown';
  }
  // 溢价率 > 5% 为高风险，2%-5% 为中风险，< 2% 为低风险（含折价）
  if (premiumRate > 5) {
    return 'high';
  } else if (premiumRate > 2) {
    return 'medium';
  } else {
    return 'low';
  }
}

/**
 * 数据格式校验：检查基金数据是否完整有效
 * @param {object} fundData - 基金数据对象
 * @returns {object} { isValid: boolean, errors: string[] }
 */
function validateFundData(fundData) {
  const errors = [];

  // 校验基金代码
  if (!fundData.fundCode || typeof fundData.fundCode !== 'string') {
    errors.push('基金代码缺失或格式错误');
  }

  // 校验基金名称
  if (!fundData.fundName || typeof fundData.fundName !== 'string') {
    errors.push('基金名称缺失或格式错误');
  }

  // 校验基金类型
  const validTypes = ['QDII', 'ETF', 'LOF'];
  if (!validTypes.includes(fundData.fundType)) {
    errors.push(`基金类型无效: ${fundData.fundType}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

module.exports = {
  calculatePremiumRate,
  getRiskLevel,
  validateFundData
};
