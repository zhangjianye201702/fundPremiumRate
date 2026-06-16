/**
 * 日志模块
 * 基于 winston 实现统一的日志记录，便于问题排查
 */
const winston = require('winston');
const config = require('../config');

const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    })
  ),
  transports: [
    // 控制台输出
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // 错误日志写入文件
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    // 全部日志写入文件
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

module.exports = logger;
