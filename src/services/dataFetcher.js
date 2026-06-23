/**
 * 数据采集模块（Python 桥接层）
 * ==================================
 * 负责调用 Python 脚本（基于 AkShare）采集主要投资国外的 LOF/ETF 基金实时行情，
 * 并读取采集结果 JSON 文件供上层服务使用。
 *
 * 架构说明：
 * 数据采集逻辑已迁移至 Python 脚本 src/scripts/akshare_fetcher.py，
 * 本模块仅负责「触发采集」与「读取结果」两件事，不再直接发起 HTTP 请求。
 *
 * 为什么这样设计：
 * - AkShare 是 Python 生态成熟的金融数据库，封装了东方财富等数据源的复杂接口；
 * - Node 端通过 child_process 调用 Python，解耦数据采集与 Web 服务；
 * - 采集结果以 JSON 文件落盘，Node 读取后即可提供 API，降低耦合度。
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * 触发 Python 脚本采集数据
 * 通过 child_process.execFile 调用 AkShare 采集脚本，等待其输出 JSON 文件
 *
 * @param {number} timeout - 子进程超时时间（毫秒），默认取 config.PYTHON.execTimeout
 * @returns {Promise<object>} 采集结果（含 updateTime 与 data 数组）
 * @throws {Error} Python 脚本执行失败、超时或输出文件不存在时抛出异常
 */
function runPythonFetcher(timeout = config.PYTHON.execTimeout) {
  const { executable, scriptPath, dataFilePath } = config.PYTHON;

  return new Promise((resolve, reject) => {
    logger.info(`启动 Python 数据采集: ${executable} ${scriptPath} ${dataFilePath}`);

    // 调用 Python 脚本，传入输出文件路径作为参数
    // 注意：execFile 不经过 shell，参数以数组传递，更安全
    const child = execFile(
      executable,
      [scriptPath, dataFilePath],
      {
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB，避免输出过大被截断
        windowsHide: true            // Windows 下隐藏子进程窗口
      },
      (error, stdout, stderr) => {
        // Python 脚本的进度日志走 stderr，这里输出便于排查
        if (stderr) {
          // AkShare 的进度条与采集日志都在 stderr，属于正常输出，记录为 debug
          logger.debug(`Python 采集日志:\n${stderr}`);
        }

        if (error) {
          // 子进程异常（含超时、非零退出码）
          const msg = error.killed
            ? `Python 采集超时（超过 ${timeout}ms）`
            : `Python 采集失败: ${error.message}`;
          logger.error(msg);
          return reject(new Error(msg));
        }

        // 采集成功后读取结果文件
        try {
          const result = readDataFile();
          logger.info(`Python 采集完成，共获取 ${result.data.length} 条数据`);
          resolve(result);
        } catch (readErr) {
          logger.error(`读取采集结果失败: ${readErr.message}`);
          reject(readErr);
        }
      }
    );
  });
}

/**
 * 读取采集结果 JSON 文件
 * 文件由 Python 脚本写入，结构为 { updateTime: string, data: Array }
 *
 * @returns {object} 采集结果，含 updateTime（ISO 时间字符串）与 data（基金数组）
 * @throws {Error} 文件不存在或格式错误时抛出异常
 */
function readDataFile() {
  const filePath = config.PYTHON.dataFilePath;

  // 文件存在性检查
  if (!fs.existsSync(filePath)) {
    throw new Error(`数据文件不存在: ${filePath}，请先执行数据采集`);
  }

  // 读取并解析 JSON
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);

  // 基本结构校验
  if (!parsed || !Array.isArray(parsed.data)) {
    throw new Error('数据文件格式异常：缺少 data 数组');
  }

  return {
    updateTime: parsed.updateTime || null,
    data: parsed.data
  };
}

/**
 * 获取数据文件最后修改时间
 * 用于判断缓存数据的新鲜度，避免 Python 脚本未运行时 API 返回过期数据而无感知
 *
 * @returns {string|null} 文件最后修改时间的 ISO 字符串，文件不存在返回 null
 */
function getDataFileMtime() {
  const filePath = config.PYTHON.dataFilePath;
  try {
    const stat = fs.statSync(filePath);
    return stat.mtime.toISOString();
  } catch (e) {
    return null;
  }
}

/**
 * 确保数据输出目录存在
 * 在首次采集前调用，避免 Python 脚本写入文件时因目录缺失而失败
 */
function ensureDataDir() {
  const filePath = config.PYTHON.dataFilePath;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info(`已创建数据目录: ${dir}`);
  }
}

module.exports = {
  runPythonFetcher,
  readDataFile,
  getDataFileMtime,
  ensureDataDir
};
