/**
 * 基金服务模块
 * 整合数据采集与溢价率计算，提供统一的数据查询接口
 * 支持按基金类型、溢价率等条件筛选和排序
 */
const dataFetcher = require('./dataFetcher');
const { calculatePremiumRate, getRiskLevel, validateFundData } = require('./premiumCalculator');
const logger = require('../utils/logger');

// 内存缓存：存储所有基金数据
let fundDataCache = [];
// 最后更新时间
let lastUpdateTime = null;

/**
 * 获取所有基金数据（QDII + 跨境ETF）
 * 并发采集净值和市场价格，计算溢价率
 * @returns {Promise<Array>} 完整的基金溢价率数据列表
 */
async function fetchAllFundData() {
  logger.info('开始采集基金数据...');
  const startTime = Date.now();

  try {
    // 并发获取QDII基金列表和跨境ETF列表
    const [qdiiFunds, etfFunds] = await Promise.all([
      dataFetcher.fetchQDIIFundList().catch(err => {
        logger.error(`获取QDII基金列表失败，使用空列表: ${err.message}`);
        return [];
      }),
      dataFetcher.fetchCrossBorderETFList()
    ]);

    // 合并基金列表，ETF数据补充交易所信息
    const allFunds = [
      ...qdiiFunds.map(f => ({ ...f, exchange: null })),
      ...etfFunds
    ];

    logger.info(`共需采集 ${allFunds.length} 只基金数据`);

    // 分批并发获取净值和价格（避免请求过多）
    const batchSize = 10;
    const results = [];

    for (let i = 0; i < allFunds.length; i += batchSize) {
      const batch = allFunds.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(fund => processSingleFund(fund))
      );
      results.push(...batchResults.filter(r => r !== null));
    }

    // 更新缓存
    fundDataCache = results;
    lastUpdateTime = new Date();

    const duration = Date.now() - startTime;
    logger.info(`基金数据采集完成，共获取 ${results.length} 条有效数据，耗时 ${duration}ms`);

    return results;
  } catch (error) {
    logger.error(`基金数据采集失败: ${error.message}`);
    throw error;
  }
}

/**
 * 处理单只基金：获取净值和价格，计算溢价率
 * @param {object} fund - 基金基本信息
 * @returns {Promise<object|null>} 处理后的基金数据，失败返回 null
 */
async function processSingleFund(fund) {
  try {
    // 获取基金净值
    const navData = await dataFetcher.fetchFundNAV(fund.fundCode);
    if (!navData) {
      return null;
    }

    // 获取市场价格（场内基金才有）
    let priceData = null;
    if (fund.exchange) {
      priceData = await dataFetcher.fetchMarketPrice(fund.fundCode, fund.exchange);
    }

    // 构建基金数据对象
    const fundData = {
      fundCode: fund.fundCode,
      fundName: fund.fundName,
      fundType: fund.fundType,
      // 优先使用估算净值（更实时），无则用最新净值
      nav: navData.estimatedNav || navData.nav,
      navTime: navData.estimatedTime || navData.navTime,
      // 市场价格（场内基金）
      marketPrice: priceData ? priceData.price : null,
      marketPriceTime: lastUpdateTime ? lastUpdateTime.toISOString() : new Date().toISOString(),
      // 涨跌幅
      changeRate: priceData ? priceData.changeRate : navData.growthRate,
      // 交易信息
      volume: priceData ? priceData.volume : null,
      amount: priceData ? priceData.amount : null
    };

    // 数据格式校验
    const validation = validateFundData(fundData);
    if (!validation.isValid) {
      logger.warn(`基金 ${fund.fundCode} 数据校验失败: ${validation.errors.join(', ')}`);
      return null;
    }

    // 计算溢价率（只有同时有价格和净值时才能计算）
    if (fundData.marketPrice !== null && fundData.nav) {
      fundData.premiumRate = calculatePremiumRate(fundData.marketPrice, fundData.nav);
      fundData.riskLevel = getRiskLevel(fundData.premiumRate);
    } else {
      fundData.premiumRate = null;
      fundData.riskLevel = 'unknown';
    }

    return fundData;
  } catch (error) {
    logger.warn(`处理基金 ${fund.fundCode} 失败: ${error.message}`);
    return null;
  }
}

/**
 * 获取缓存的基金数据（带筛选和排序）
 * @param {object} options - 筛选和排序选项
 * @param {string} options.fundType - 基金类型筛选（QDII/ETF/LOF/ALL）
 * @param {string} options.sortBy - 排序字段（premiumRate/changeRate/fundName）
 * @param {string} options.sortOrder - 排序顺序（asc/desc）
 * @param {number} options.minPremium - 最低溢价率筛选
 * @param {number} options.maxPremium - 最高溢价率筛选
 * @param {string} options.keyword - 关键词搜索（基金代码或名称）
 * @returns {object} { data: Array, total: number, updateTime: string }
 */
function getCachedFundData(options = {}) {
  let data = [...fundDataCache];

  // 按基金类型筛选
  if (options.fundType && options.fundType !== 'ALL') {
    data = data.filter(f => f.fundType === options.fundType);
  }

  // 关键词搜索
  if (options.keyword) {
    const kw = options.keyword.toLowerCase();
    data = data.filter(f =>
      f.fundCode.toLowerCase().includes(kw) ||
      f.fundName.toLowerCase().includes(kw)
    );
  }

  // 按溢价率范围筛选
  if (options.minPremium !== undefined && options.minPremium !== null) {
    data = data.filter(f => f.premiumRate !== null && f.premiumRate >= options.minPremium);
  }
  if (options.maxPremium !== undefined && options.maxPremium !== null) {
    data = data.filter(f => f.premiumRate !== null && f.premiumRate <= options.maxPremium);
  }

  // 排序
  const sortBy = options.sortBy || 'premiumRate';
  const sortOrder = options.sortOrder || 'desc';
  data.sort((a, b) => {
    let valA = a[sortBy];
    let valB = b[sortBy];
    // null 值排到最后
    if (valA === null) return 1;
    if (valB === null) return -1;
    if (typeof valA === 'string') {
      return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return sortOrder === 'asc' ? valA - valB : valB - valA;
  });

  return {
    data,
    total: data.length,
    updateTime: lastUpdateTime ? lastUpdateTime.toISOString() : null
  };
}

/**
 * 获取最后更新时间
 * @returns {string|null} ISO 格式时间
 */
function getLastUpdateTime() {
  return lastUpdateTime ? lastUpdateTime.toISOString() : null;
}

module.exports = {
  fetchAllFundData,
  getCachedFundData,
  getLastUpdateTime
};
