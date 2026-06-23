/**
 * Express 应用主入口
 * 启动 Web 服务器，提供 RESTful API 和静态页面服务
 */
const express = require('express');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');
const fundService = require('./services/fundService');
const scheduler = require('./services/scheduler');

const app = express();

// 中间件：解析 JSON 请求体
app.use(express.json());

// 静态文件服务（前端页面）
app.use(express.static(path.join(__dirname, '../public')));

/**
 * API 路由定义
 */

/**
 * 获取基金溢价率数据
 * 支持筛选和排序参数
 * GET /api/funds
 * 查询参数:
 *   - fundType: 基金类型（ETF/LOF/ALL），默认 ALL
 *   - sortBy: 排序字段（estimatedPremiumRate/premiumRate/changeRate/fundName/marketPrice/nav/estimatedNav），默认 estimatedPremiumRate
 *   - sortOrder: 排序顺序（asc/desc），默认 desc
 *   - minPremium: 最低溢价率（数字）
 *   - maxPremium: 最高溢价率（数字）
 *   - keyword: 关键词（基金代码或名称）
 *   - page: 页码（从1开始），不传则返回全部
 *   - pageSize: 每页条数，默认 20
 */
app.get('/api/funds', (req, res) => {
  try {
    const options = {
      fundType: req.query.fundType || 'ALL',
      sortBy: req.query.sortBy || 'estimatedPremiumRate',
      sortOrder: req.query.sortOrder || 'desc',
      minPremium: req.query.minPremium !== undefined ? parseFloat(req.query.minPremium) : undefined,
      maxPremium: req.query.maxPremium !== undefined ? parseFloat(req.query.maxPremium) : undefined,
      keyword: req.query.keyword || '',
      page: req.query.page !== undefined ? parseInt(req.query.page) : undefined,
      pageSize: req.query.pageSize !== undefined ? parseInt(req.query.pageSize) : undefined
    };

    // 参数校验
    if (options.minPremium !== undefined && isNaN(options.minPremium)) {
      return res.status(400).json({ error: 'minPremium 参数无效，必须为数字' });
    }
    if (options.maxPremium !== undefined && isNaN(options.maxPremium)) {
      return res.status(400).json({ error: 'maxPremium 参数无效，必须为数字' });
    }

    const result = fundService.getCachedFundData(options);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error(`API /api/funds 错误: ${error.message}`);
    res.status(500).json({ error: '获取基金数据失败', message: error.message });
  }
});

/**
 * 手动触发数据刷新
 * POST /api/refresh
 */
app.post('/api/refresh', async (req, res) => {
  try {
    logger.info('收到手动刷新请求');
    await fundService.fetchAllFundData();
    res.json({
      success: true,
      message: '数据刷新成功',
      updateTime: fundService.getLastUpdateTime()
    });
  } catch (error) {
    logger.error(`手动刷新失败: ${error.message}`);
    res.status(500).json({ error: '数据刷新失败', message: error.message });
  }
});

/**
 * 获取数据更新状态
 * GET /api/status
 */
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    updateTime: fundService.getLastUpdateTime(),
    refreshInterval: config.REFRESH_INTERVAL,
    cronExpression: config.CRON_EXPRESSION
  });
});

/**
 * 健康检查接口
 * GET /api/health
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * 全局错误处理中间件
 */
app.use((err, req, res, next) => {
  logger.error(`未处理的异常: ${err.message}`);
  res.status(500).json({ error: '服务器内部错误', message: err.message });
});

/**
 * 启动服务器
 */
const server = app.listen(config.PORT, () => {
  logger.info(`跨境基金溢价率查看服务已启动（数据源：AkShare）`);
  logger.info(`访问地址: http://localhost:${config.PORT}`);
  logger.info(`API文档地址: http://localhost:${config.PORT}/api/status`);

  // 启动定时任务，自动每15分钟刷新数据（调用 AkShare 采集脚本）
  scheduler.startScheduledTask();
});

/**
 * 优雅退出处理
 * 收到终止信号时停止定时任务并关闭服务器
 */
process.on('SIGTERM', () => {
  logger.info('收到 SIGTERM 信号，正在关闭服务...');
  scheduler.stopScheduledTask();
  server.close(() => {
    logger.info('服务已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('收到 SIGINT 信号，正在关闭服务...');
  scheduler.stopScheduledTask();
  server.close(() => {
    logger.info('服务已关闭');
    process.exit(0);
  });
});

module.exports = app;
