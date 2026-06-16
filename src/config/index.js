/**
 * 应用配置文件
 * 集中管理服务端口、数据更新频率、数据源等配置项
 */
module.exports = {
  // 服务监听端口
  PORT: process.env.PORT || 3000,
  // 数据刷新间隔（毫秒），15分钟 = 15 * 60 * 1000
  REFRESH_INTERVAL: 15 * 60 * 1000,
  // 定时任务 cron 表达式：每15分钟执行一次
  CRON_EXPRESSION: '*/15 * * * *',
  // HTTP 请求超时时间（毫秒）
  REQUEST_TIMEOUT: 10000,
  // 数据源配置
  DATA_SOURCES: {
    EASTMONEY: {
      // 基金列表接口（获取QDII基金代码列表）
      fundListUrl: 'https://fundapi.eastmoney.com/fundtradenew.aspx',
      // 基金详情接口（获取基金净值数据）
      fundDetailUrl: 'https://fundgz.1234567.com.cn/js'
    },
    // 腾讯行情接口（获取场内ETF实时交易价格，稳定可靠）
    TENCENT: {
      quoteUrl: 'https://qt.gtimg.cn/q'
    }
  },
  // 日志配置
  LOG_LEVEL: 'info'
};
