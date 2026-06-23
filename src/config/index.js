/**
 * 应用配置文件
 * 集中管理服务端口、数据更新频率、Python 采集脚本路径等配置项
 *
 * 数据架构说明：
 * 本项目采用「Python 数据层 + Node 桥接」架构。
 * 数据采集由 Python 脚本（基于 AkShare）完成，输出 JSON 文件；
 * Node.js 后端读取该 JSON 文件，通过 RESTful API 提供给前端展示。
 */
const path = require('path');

module.exports = {
  // 服务监听端口
  PORT: process.env.PORT || 3000,
  // 数据刷新间隔（毫秒），15分钟 = 15 * 60 * 1000
  REFRESH_INTERVAL: 15 * 60 * 1000,
  // 定时任务 cron 表达式：每15分钟执行一次
  CRON_EXPRESSION: '*/15 * * * *',
  // HTTP 请求超时时间（毫秒），用于 API 路由内部逻辑
  REQUEST_TIMEOUT: 10000,

  /**
   * Python 数据采集相关配置
   * Node 通过 child_process 调用 Python 脚本执行 AkShare 数据采集
   */
  PYTHON: {
    // Python 可执行文件：优先使用环境变量，默认 'py'（Windows Python 启动器）
    executable: process.env.PYTHON_EXECUTABLE || 'py',
    // AkShare 数据采集脚本路径（相对项目根目录）
    scriptPath: path.join(__dirname, '..', 'scripts', 'akshare_fetcher.py'),
    // 采集结果输出文件路径（相对项目根目录）
    dataFilePath: path.join(__dirname, '..', '..', 'data', 'fund_data.json'),
    // 子进程执行超时时间（毫秒），AkShare 采集含分页请求，设为 120 秒
    execTimeout: 120000
  },

  // 日志配置
  LOG_LEVEL: 'info'
};
