/**
 * 定时任务调度器
 * 使用 node-cron 每15分钟自动刷新基金数据
 * 确保数据更新频率不低于每15分钟一次
 */
const cron = require('node-cron');
const config = require('../config');
const fundService = require('./fundService');
const logger = require('../utils/logger');

// 定时任务实例引用
let scheduledTask = null;
// 是否正在刷新中（防止任务重叠）
let isRefreshing = false;

/**
 * 执行数据刷新任务
 * 包含防重入机制，避免上一次刷新未完成时重复执行
 */
async function executeRefresh() {
  if (isRefreshing) {
    logger.warn('上一次数据刷新尚未完成，跳过本次执行');
    return;
  }

  isRefreshing = true;
  try {
    await fundService.fetchAllFundData();
    logger.info('定时数据刷新成功完成');
  } catch (error) {
    logger.error(`定时数据刷新失败: ${error.message}`);
  } finally {
    isRefreshing = false;
  }
}

/**
 * 启动定时任务
 * 按 config.CRON_EXPRESSION 配置的频率（默认每15分钟）执行数据刷新
 */
function startScheduledTask() {
  if (scheduledTask) {
    logger.warn('定时任务已在运行，无需重复启动');
    return;
  }

  // 启动时立即执行一次数据采集
  logger.info('启动首次数据采集...');
  executeRefresh();

  // 注册定时任务
  scheduledTask = cron.schedule(config.CRON_EXPRESSION, () => {
    logger.info(`定时任务触发，执行数据刷新 [${new Date().toLocaleString('zh-CN')}]`);
    executeRefresh();
  });

  logger.info(`定时任务已启动，执行频率: ${config.CRON_EXPRESSION}（每15分钟一次）`);
}

/**
 * 停止定时任务
 */
function stopScheduledTask() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info('定时任务已停止');
  }
}

module.exports = {
  startScheduledTask,
  stopScheduledTask,
  executeRefresh
};
