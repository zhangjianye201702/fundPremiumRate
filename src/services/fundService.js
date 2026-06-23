/**
 * 基金服务模块
 * ==================================
 * 整合数据采集与缓存，提供统一的基金溢价率查询接口。
 * 数据采集委托给 dataFetcher（Python 桥接层），本模块负责缓存管理、筛选与排序。
 *
 * 数据范围：主要投资国外的 LOF 与 ETF 基金（跨境品种），
 * 溢价率基于 AkShare 提供的 IOPV 实时估值与场内最新价计算。
 */
const dataFetcher = require('./dataFetcher');
const logger = require('../utils/logger');

// 内存缓存：存储所有基金数据（由 Python 采集脚本写入，Node 读取后缓存）
let fundDataCache = [];
// 最后更新时间（取自 Python 输出的 JSON，反映数据采集时刻）
let lastUpdateTime = null;

/**
 * 触发一次完整的数据采集
 * 调用 Python 脚本（AkShare）获取跨境 LOF/ETF 行情，结果写入 JSON 文件后载入缓存
 *
 * @returns {Promise<Array>} 采集到的基金数据列表
 * @throws {Error} 采集过程失败时抛出（如 Python 脚本异常、数据文件不可读）
 */
async function fetchAllFundData() {
  logger.info('开始采集基金数据（AkShare）...');
  const startTime = Date.now();

  try {
    // 确保数据输出目录存在（首次运行时创建）
    dataFetcher.ensureDataDir();

    // 调用 Python 脚本采集数据，内部会等待脚本完成并读取结果文件
    const result = await dataFetcher.runPythonFetcher();

    // 更新内存缓存
    fundDataCache = result.data || [];
    lastUpdateTime = result.updateTime || dataFetcher.getDataFileMtime();

    const duration = Date.now() - startTime;
    logger.info(`基金数据采集完成，共 ${fundDataCache.length} 条，耗时 ${duration}ms`);

    return fundDataCache;
  } catch (error) {
    logger.error(`基金数据采集失败: ${error.message}`);
    throw error;
  }
}

/**
 * 从数据文件重新载入缓存（不触发采集）
 * 用于服务启动时若已有历史数据文件，可直接载入供前端展示，无需等待采集
 *
 * @returns {boolean} 是否成功载入
 */
function loadFromDataFile() {
  try {
    const result = dataFetcher.readDataFile();
    fundDataCache = result.data || [];
    lastUpdateTime = result.updateTime || dataFetcher.getDataFileMtime();
    logger.info(`从数据文件载入缓存成功，共 ${fundDataCache.length} 条数据`);
    return true;
  } catch (e) {
    logger.warn(`数据文件不可用，首次需等待采集: ${e.message}`);
    return false;
  }
}

/**
 * 获取缓存的基金数据（带筛选、排序和分页）
 * 所有筛选/排序均在 Node 端完成，基于已缓存的 Python 采集结果
 *
 * @param {object} options - 筛选和排序选项
 * @param {string} options.fundType - 基金类型筛选（ETF/LOF/ALL）
 * @param {string} options.sortBy - 排序字段（premiumRate/estimatedPremiumRate/changeRate/fundName/marketPrice/nav/estimatedNav）
 * @param {string} options.sortOrder - 排序顺序（asc/desc）
 * @param {number} options.minPremium - 最低溢价率筛选
 * @param {number} options.maxPremium - 最高溢价率筛选
 * @param {string} options.keyword - 关键词搜索（基金代码或名称）
 * @param {number} options.page - 页码（从1开始），不传或 ≤0 表示不分页（返回全部）
 * @param {number} options.pageSize - 每页条数，默认 10
 * @returns {object} { data: Array, total: number, updateTime: string, page?, pageSize?, totalPages? }
 */
function getCachedFundData(options = {}) {
  let data = [...fundDataCache];

  // 按基金类型筛选（跨境品种仅有 ETF 与 LOF 两类）
  if (options.fundType && options.fundType !== 'ALL') {
    data = data.filter(f => f.fundType === options.fundType);
  }

  // 关键词搜索（匹配基金代码或名称，大小写不敏感）
  if (options.keyword) {
    const kw = options.keyword.toLowerCase();
    data = data.filter(f =>
      f.fundCode.toLowerCase().includes(kw) ||
      f.fundName.toLowerCase().includes(kw)
    );
  }

  // 按溢价率范围筛选
  // 说明：优先以「T日实时溢价率(estimatedPremiumRate)」为准，缺失时回退「T-1溢价率(premiumRate)」
  if (options.minPremium !== undefined && options.minPremium !== null) {
    data = data.filter(f => {
      const v = f.estimatedPremiumRate !== null && f.estimatedPremiumRate !== undefined
        ? f.estimatedPremiumRate
        : f.premiumRate;
      return v !== null && v !== undefined && v >= options.minPremium;
    });
  }
  if (options.maxPremium !== undefined && options.maxPremium !== null) {
    data = data.filter(f => {
      const v = f.estimatedPremiumRate !== null && f.estimatedPremiumRate !== undefined
        ? f.estimatedPremiumRate
        : f.premiumRate;
      return v !== null && v !== undefined && v <= options.maxPremium;
    });
  }

  // 排序：默认按 T 日实时溢价率降序
  const sortBy = options.sortBy || 'estimatedPremiumRate';
  const sortOrder = options.sortOrder || 'desc';
  data.sort((a, b) => {
    let valA = a[sortBy];
    let valB = b[sortBy];
    // null/undefined 值统一排到最后（无论升降序）
    if (valA === null || valA === undefined) return 1;
    if (valB === null || valB === undefined) return -1;
    // 字符串字段（如基金名称）按 localeCompare 排序
    if (typeof valA === 'string') {
      return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    // 数值字段
    return sortOrder === 'asc' ? valA - valB : valB - valA;
  });

  // total 为筛选+排序后的总条数（分页前）
  const total = data.length;

  // 分页处理：page > 0 时启用分页，否则返回全部数据
  const page = parseInt(options.page);
  const pageSize = parseInt(options.pageSize) > 0 ? parseInt(options.pageSize) : 10;
  const usePaging = !isNaN(page) && page > 0;

  if (usePaging) {
    // 计算总页数（向上取整，total 为 0 时为 0 页）
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
    // 越界页码保护：page 超出总页数时返回最后一页（或空）
    const safePage = Math.min(page, Math.max(totalPages, 1));
    const startIndex = (safePage - 1) * pageSize;
    const pagedData = data.slice(startIndex, startIndex + pageSize);

    return {
      data: pagedData,
      total,
      updateTime: lastUpdateTime,
      page: safePage,
      pageSize,
      totalPages
    };
  }

  // 不分页：返回全部
  return {
    data,
    total,
    updateTime: lastUpdateTime
  };
}

/**
 * 获取最后更新时间
 * @returns {string|null} ISO 格式时间字符串，无数据时返回 null
 */
function getLastUpdateTime() {
  return lastUpdateTime;
}

module.exports = {
  fetchAllFundData,
  loadFromDataFile,
  getCachedFundData,
  getLastUpdateTime
};
