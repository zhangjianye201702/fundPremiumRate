/**
 * 数据采集模块
 * 负责从东方财富等金融数据源获取QDII基金和场内ETF的净值与市场价格数据
 * 包含异常处理机制：连接失败重试、数据格式校验、错误提示
 */
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

// 创建带超时的 axios 实例
const httpClient = axios.create({
  timeout: config.REQUEST_TIMEOUT,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://fund.eastmoney.com/'
  }
});

/**
 * 带重试机制的 HTTP GET 请求
 * @param {string} url - 请求地址
 * @param {object} params - 查询参数
 * @param {number} retries - 剩余重试次数，默认3次
 * @returns {Promise<object>} 响应数据
 * @throws {Error} 当所有重试均失败时抛出异常
 */
async function fetchWithRetry(url, params = {}, retries = 3) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await httpClient.get(url, { params });
      // 校验响应状态
      if (response.status !== 200) {
        throw new Error(`HTTP状态码异常: ${response.status}`);
      }
      return response.data;
    } catch (error) {
      lastError = error;
      logger.warn(`请求失败（第${i + 1}次）: ${url}，错误: ${error.message}`);
      // 最后一次重试不再等待
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
  throw new Error(`数据源请求失败，已重试${retries}次: ${lastError.message}`);
}

/**
 * 获取QDII基金列表
 * 从东方财富基金交易平台获取QDII类型基金的基本信息
 * @returns {Promise<Array>} QDII基金列表，含基金代码、名称等
 */
async function fetchQDIIFundList() {
  const url = config.DATA_SOURCES.EASTMONEY.fundListUrl;
  // ft=qdii 表示筛选QDII类型基金
  const params = {
    ft: 'qdii',
    pi: 1,
    pn: 500, // 每页500条，尽量一次性获取
    po: 1,
    fd: '',
    fl: 0,
    is498: 0
  };

  try {
    const data = await fetchWithRetry(url, params);
    // 东方财富返回的是 JSONP 格式，需要提取 JSON 部分
    const funds = parseEastMoneyFundList(data);
    logger.info(`成功获取QDII基金列表，共 ${funds.length} 只基金`);
    return funds;
  } catch (error) {
    logger.error(`获取QDII基金列表失败: ${error.message}`);
    throw error;
  }
}

/**
 * 解析东方财富基金列表数据
 * 东方财富返回的数据格式为 var rankData = { datas: "...", ... }
 * @param {string|object} rawData - 原始响应数据
 * @returns {Array} 解析后的基金列表
 */
function parseEastMoneyFundList(rawData) {
  try {
    let jsonData;
    if (typeof rawData === 'string') {
      // 提取 var rankData = {...} 中的 JSON 内容
      const match = rawData.match(/var\s+rankData\s*=\s*(\{[\s\S]*\});?/);
      if (!match) {
        throw new Error('无法解析基金列表数据格式');
      }
      jsonData = JSON.parse(match[1]);
    } else {
      jsonData = rawData;
    }

    // datas 字段是用逗号分隔的基金信息字符串
    if (!jsonData.datas) {
      throw new Error('基金列表数据为空');
    }

    const fundList = jsonData.datas.split('|').map(item => {
      const fields = item.split(',');
      // 东方财富基金列表字段顺序
      return {
        fundCode: fields[0],       // 基金代码
        fundName: fields[1],       // 基金名称
        fundType: 'QDII',          // 基金类型
        // 场内/场外标识（部分QDII为LOF可在场内交易）
        isTradable: fields[30] === '1' || fields[24] === '场内'
      };
    }).filter(fund => fund.fundCode && fund.fundName);

    return fundList;
  } catch (error) {
    logger.error(`解析基金列表数据失败: ${error.message}`);
    throw new Error(`基金列表数据格式异常: ${error.message}`);
  }
}

/**
 * 获取场内交易ETF基金列表（包含跨境ETF，即投资海外市场的ETF）
 * @returns {Promise<Array>} 跨境ETF基金列表
 */
async function fetchCrossBorderETFList() {
  // 跨境ETF在上海和深圳交易所上市，使用东方财富行情接口
  // 这里使用预设的常见跨境ETF列表，实际可扩展为动态获取
  const crossBorderETFs = [
    { fundCode: '513100', fundName: '纳指ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '513500', fundName: '标普500ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159920', fundName: '恒生ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '510900', fundName: 'H股ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159941', fundName: '纳指100ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513050', fundName: '中概互联ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '164906', fundName: '中概互联LOF', fundType: 'LOF', exchange: 'SZ' },
    { fundCode: '159605', fundName: '中概互联网ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513330', fundName: '恒生科技指数ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159948', fundName: '恒生科技ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513010', fundName: '恒生科技ETF基金', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159740', fundName: '恒生科技指数ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513180', fundName: '恒生科技ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159509', fundName: '纳指科技ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513980', fundName: '日经ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159865', fundName: '日本东证ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159611', fundName: '德国ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513030', fundName: '德国DAX ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159712', fundName: '法国CAC40 ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159766', fundName: '法国CAC40 ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159709', fundName: '亚太精选ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159687', fundName: '东南亚科技ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '520560', fundName: '沙特ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159329', fundName: '标普油气ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513850', fundName: '标普油气ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159697', fundName: '全球芯片ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159545', fundName: '恒生医疗ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513060', fundName: '恒生医疗ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159723', fundName: '恒生生物科技ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159892', fundName: '恒生央企ETF', fundType: 'ETF', exchange: 'SZ' }
  ];

  logger.info(`加载跨境ETF列表，共 ${crossBorderETFs.length} 只`);
  return crossBorderETFs;
}

/**
 * 获取基金净值数据（估算净值）
 * 从东方财富基金估值接口获取实时估算净值
 * @param {string} fundCode - 基金代码
 * @returns {Promise<object>} 含净值、净值时间等信息
 */
async function fetchFundNAV(fundCode) {
  const url = `${config.DATA_SOURCES.EASTMONEY.fundDetailUrl}/${fundCode}.js`;
  try {
    const data = await fetchWithRetry(url);
    // 响应格式: jsonpgz({...});
    const match = data.match(/jsonpgz\((.*)\);/);
    if (!match) {
      throw new Error('净值数据格式异常');
    }
    const navData = JSON.parse(match[1]);
    // 校验必要字段
    if (!navData.dwjz || isNaN(parseFloat(navData.dwjz))) {
      throw new Error('净值数据无效');
    }
    return {
      nav: parseFloat(navData.dwjz),           // 单位净值
      navTime: navData.jzrq || '',             // 净值日期
      estimatedNav: parseFloat(navData.gsz),   // 估算净值
      estimatedTime: navData.gztime || '',     // 估算时间
      growthRate: parseFloat(navData.gszzl)    // 估算涨跌幅
    };
  } catch (error) {
    logger.warn(`获取基金 ${fundCode} 净值失败: ${error.message}`);
    return null;
  }
}

/**
 * 获取场内基金实时交易价格
 * @param {string} fundCode - 基金代码
 * @param {string} exchange - 交易所（SH/SZ）
 * @returns {Promise<object>} 含当前价格、涨跌幅等信息
 */
async function fetchMarketPrice(fundCode, exchange) {
  // 根据交易所确定市场前缀：上海1，深圳0
  const marketPrefix = exchange === 'SH' ? '1' : '0';
  const secid = `${marketPrefix}.${fundCode}`;
  const url = config.DATA_SOURCES.EASTMONEY.quoteUrl;
  const params = {
    secid: secid,
    fields: 'f43,f44,f45,f46,f47,f48,f57,f58,f170',
    // f43=最新价, f44=最高, f45=最低, f46=今开, f47=成交量, f48=成交额, f57=代码, f58=名称, f170=涨跌幅
    fltt: 2
  };

  try {
    const data = await fetchWithRetry(url, params);
    if (!data || !data.data) {
      throw new Error('行情数据为空');
    }
    const quote = data.data;
    // 校验价格有效性
    const price = quote.f43;
    if (price === undefined || price === '-' || isNaN(price)) {
      throw new Error('价格数据无效');
    }
    return {
      price: price,           // 最新价（元）
      high: quote.f44,        // 最高价
      low: quote.f45,         // 最低价
      open: quote.f46,        // 开盘价
      volume: quote.f47,      // 成交量（手）
      amount: quote.f48,      // 成交额（元）
      changeRate: quote.f170  // 涨跌幅（%）
    };
  } catch (error) {
    logger.warn(`获取基金 ${fundCode} 市场价格失败: ${error.message}`);
    return null;
  }
}

module.exports = {
  fetchQDIIFundList,
  fetchCrossBorderETFList,
  fetchFundNAV,
  fetchMarketPrice,
  fetchWithRetry
};
