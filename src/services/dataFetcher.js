/**
 * 数据采集模块
 * 负责从东方财富等金融数据源获取QDII基金和场内ETF的净值与市场价格数据
 * 包含异常处理机制：连接失败重试、数据格式校验、错误提示
 */
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

// 创建带超时的 axios 实例
// 注意：行情接口（push2.eastmoney.com）需要 Referer 为 quote.eastmoney.com 才能正常访问
// Referer 为 fund.eastmoney.com 时会被拒绝（socket hang up）
const httpClient = axios.create({
  timeout: config.REQUEST_TIMEOUT,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://quote.eastmoney.com/center/gridlist.html',
    'Accept': '*/*'
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
 * 数据来源：东方财富外盘ETF列表页面
 * @returns {Promise<Array>} 跨境ETF基金列表
 */
async function fetchCrossBorderETFList() {
  // 外盘ETF完整列表，来源：东方财富外盘ETF排行页
  // https://emrnweb.eastmoney.com/etf/RankETF?fundtype=vaeefw
  const crossBorderETFs = [
    // ========== 纳斯达克100系列（共12只） ==========
    { fundCode: '513100', fundName: '纳指ETF国泰', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159941', fundName: '纳指ETF广发', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513300', fundName: '纳斯达克ETF华夏', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '513390', fundName: '纳指ETF博时', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159632', fundName: '纳斯达克ETF华安', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159660', fundName: '纳斯达克ETF汇添富', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159501', fundName: '纳斯达克ETF嘉实', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159696', fundName: '纳斯达克ETF易方达', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513870', fundName: '纳斯达克ETF富国', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159513', fundName: '纳斯达克ETF华泰', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159523', fundName: '纳斯达克ETF大成', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159509', fundName: '纳指科技ETF景顺', fundType: 'ETF', exchange: 'SZ' },

    // ========== 标普/道琼斯/美国市场 ==========
    { fundCode: '513500', fundName: '标普500ETF博时', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '513550', fundName: '标普500ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '513400', fundName: '道琼斯ETF鹏华', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '513850', fundName: '美国50ETF易方达', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159502', fundName: '标普生物科技ETF嘉实', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159529', fundName: '标普消费ETF景顺', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513290', fundName: '纳指生物科技ETF汇添富', fundType: 'ETF', exchange: 'SH' },

    // ========== 中概互联/跨境互联网 ==========
    { fundCode: '513050', fundName: '中概互联ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '164906', fundName: '中概互联LOF', fundType: 'LOF', exchange: 'SZ' },
    { fundCode: '159605', fundName: '中概互联网ETF', fundType: 'ETF', exchange: 'SZ' },

    // ========== 恒生科技系列 ==========
    { fundCode: '513330', fundName: '恒生科技指数ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159948', fundName: '恒生科技ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513010', fundName: '恒生科技ETF基金', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159740', fundName: '恒生科技指数ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513180', fundName: '恒生科技ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '513130', fundName: '恒生科技指数ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '513160', fundName: '恒生科技ETF', fundType: 'ETF', exchange: 'SH' },

    // ========== 恒生指数/H股/港股通系列 ==========
    { fundCode: '159920', fundName: '恒生ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '510900', fundName: 'H股ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '513090', fundName: '香港证券ETF易方达', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '513190', fundName: '港股通金融ETF华夏', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '513140', fundName: '港股通金融ETF华泰柏瑞', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '513530', fundName: '港股通红利ETF华泰柏瑞', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159726', fundName: '港股通高股息ETF华夏', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159196', fundName: '港股通信息技术ETF易方达', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159545', fundName: '恒生红利低波ETF易方达', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159822', fundName: '新经济ETF银华', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513690', fundName: '港股红利ETF博时', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '513750', fundName: '港股通非银ETF广发', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '513630', fundName: '港股低波红利ETF摩根', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159131', fundName: '港股通信息技术ETF华宝', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513910', fundName: '港股通央企红利ETF华夏', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159723', fundName: '恒生生物科技ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159892', fundName: '恒生央企ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513060', fundName: '恒生医疗ETF', fundType: 'ETF', exchange: 'SH' },

    // ========== 日本市场 ==========
    { fundCode: '513520', fundName: '日经ETF华夏', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '513980', fundName: '日经ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '513800', fundName: '日本东证指数ETF南方', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159865', fundName: '日本东证ETF', fundType: 'ETF', exchange: 'SZ' },

    // ========== 德国/法国/欧洲市场 ==========
    { fundCode: '159561', fundName: '德国ETF嘉实', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159611', fundName: '德国ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513030', fundName: '德国DAX ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159712', fundName: '法国CAC40 ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '159766', fundName: '法国CAC40 ETF', fundType: 'ETF', exchange: 'SZ' },

    // ========== 亚太/东南亚/沙特/全球/其他 ==========
    { fundCode: '159687', fundName: '亚太精选ETF南方', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513730', fundName: '东南亚科技ETF华泰柏瑞', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '520580', fundName: '新兴亚洲ETF招商', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159329', fundName: '沙特ETF南方', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '520560', fundName: '沙特ETF', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '513310', fundName: '中韩半导体ETF华泰柏瑞', fundType: 'ETF', exchange: 'SH' },
    { fundCode: '159697', fundName: '全球芯片ETF', fundType: 'ETF', exchange: 'SZ' },
    { fundCode: '513360', fundName: '教育ETF博时', fundType: 'ETF', exchange: 'SH' },
  ];

  // 按基金代码去重（同一代码可能出现多次，保留第一个）
  const seen = new Set();
  const uniqueETFs = crossBorderETFs.filter(etf => {
    if (seen.has(etf.fundCode)) return false;
    seen.add(etf.fundCode);
    return true;
  });

  logger.info(`加载跨境ETF列表，共 ${uniqueETFs.length} 只`);
  return uniqueETFs;
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
 * 批量获取场内基金实时交易价格
 * 使用腾讯行情接口（qt.gtimg.cn），支持批量查询，稳定可靠
 * 返回格式：v_sh513100="1~名称~代码~最新价~昨收~今开~成交量~..."
 * @param {Array<object>} funds - 基金列表，每项含 fundCode 和 exchange（SH/SZ）
 * @returns {Promise<Map<string, object>>} 以基金代码为 key 的价格信息映射
 */
async function fetchMarketPricesBatch(funds) {
  const url = config.DATA_SOURCES.TENCENT.quoteUrl;
  // 构建查询参数：上海sh前缀，深圳sz前缀
  const codes = funds.map(f => {
    const prefix = f.exchange === 'SH' ? 'sh' : 'sz';
    return `${prefix}${f.fundCode}`;
  });

  const result = new Map();

  try {
    // 腾讯接口支持批量查询，参数格式：q=sh513100,sz159920
    const data = await fetchWithRetry(url, { q: codes.join(',') });

    if (!data || typeof data !== 'string') {
      throw new Error('行情数据为空');
    }

    // 按行解析每只基金的数据
    // 格式：v_sh513100="1~纳指ETF~513100~2.280~...";
    // 注意：响应中可能包含换行符，需先去除
    const lines = data.replace(/\r?\n/g, '').split(';').filter(line => line.trim());

    for (const line of lines) {
      // 使用 \d{6} 精确匹配6位基金代码，避免 \w+ 贪婪匹配吃掉数字
      const match = line.match(/v_\w+?(\d{6})="(.+?)"/);
      if (!match) continue;

      const fundCode = match[1];
      const fields = match[2].split('~');

      // 腾讯行情字段索引：
      // 3=最新价, 4=昨收, 5=今开, 6=成交量(手),
      // 31=涨跌额, 32=涨跌幅(%), 33=最高, 34=最低, 37=成交额(万元)
      const price = parseFloat(fields[3]);

      // 校验价格有效性
      if (!isNaN(price) && price > 0) {
        result.set(fundCode, {
          price: price,                       // 最新价（元）
          high: parseFloat(fields[33]) || 0,  // 最高价
          low: parseFloat(fields[34]) || 0,   // 最低价
          open: parseFloat(fields[5]) || 0,   // 开盘价
          volume: parseInt(fields[6]) || 0,   // 成交量（手）
          amount: (parseFloat(fields[37]) || 0) * 10000, // 成交额（元，原始为万元）
          changeRate: parseFloat(fields[32]) || 0         // 涨跌幅（%）
        });
      }
    }

    logger.info(`批量获取行情成功，共 ${result.size}/${funds.length} 只基金有价格数据`);
    return result;
  } catch (error) {
    logger.error(`批量获取行情数据失败: ${error.message}`);
    return result;
  }
}

module.exports = {
  fetchQDIIFundList,
  fetchCrossBorderETFList,
  fetchFundNAV,
  fetchMarketPricesBatch,
  fetchWithRetry
};
