# QDII基金溢价率实时查看模块

## 项目简介

本项目是一个用于实时查看所有QDII基金及场内交易跨境ETF产品溢价率的Web应用。系统从东方财富网获取实时基金净值与市场交易价格数据，自动计算溢价率，并以直观的表格形式展示，支持筛选、排序等功能。

### 核心功能

- **数据采集**：从东方财富网获取QDII基金净值和场内ETF实时交易价格
- **溢价率计算**：公式 `(市场价格 - 基金净值) / 基金净值 × 100%`
- **实时展示**：表格形式呈现基金代码、名称、价格、净值、溢价率等
- **筛选排序**：按基金类型、溢价率范围、关键词等条件筛选，支持多字段排序
- **自动刷新**：每15分钟自动更新数据
- **异常处理**：连接失败重试、数据格式校验、错误提示

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + Express |
| 前端 | 原生 HTML / CSS / JavaScript |
| 数据源 | 东方财富网公开接口 |
| 定时任务 | node-cron |
| 日志 | winston |
| HTTP 客户端 | axios |

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务

```bash
npm start
```

### 3. 访问页面

打开浏览器访问：`http://localhost:3000`

服务启动后会立即进行首次数据采集，之后每15分钟自动刷新。

---

## 项目结构

```
fundPremiumRate/
├── package.json                    # 项目配置与依赖
├── README.md                       # 本说明文档
├── src/
│   ├── app.js                      # Express 应用入口，定义API路由
│   ├── config/
│   │   └── index.js                # 配置文件（端口、刷新频率、数据源等）
│   ├── utils/
│   │   └── logger.js               # 日志模块（winston）
│   └── services/
│       ├── dataFetcher.js          # 数据采集模块（获取净值与价格）
│       ├── premiumCalculator.js    # 溢价率计算引擎
│       ├── fundService.js          # 基金服务（整合采集与计算）
│       └── scheduler.js            # 定时任务调度器
├── public/                         # 前端静态资源
│   ├── index.html                  # 主页面
│   ├── css/
│   │   └── style.css               # 样式表
│   └── js/
│       └── app.js                  # 前端交互逻辑
└── logs/                           # 运行日志（自动生成）
```

---

## API 接口文档

### 1. 获取基金溢价率数据

**接口地址**：`GET /api/funds`

**请求参数（Query）**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| fundType | string | 否 | ALL | 基金类型：`ALL`(全部)、`QDII`、`ETF`、`LOF` |
| sortBy | string | 否 | premiumRate | 排序字段：`premiumRate`(溢价率)、`changeRate`(涨跌幅)、`fundName`(名称)、`marketPrice`(价格)、`nav`(净值) |
| sortOrder | string | 否 | desc | 排序方向：`asc`(升序)、`desc`(降序) |
| minPremium | number | 否 | - | 最低溢价率筛选（如 `5` 表示 ≥5%） |
| maxPremium | number | 否 | - | 最高溢价率筛选 |
| keyword | string | 否 | - | 关键词搜索（基金代码或名称） |

**响应示例**：

```json
{
  "success": true,
  "data": [
    {
      "fundCode": "513100",
      "fundName": "纳指ETF",
      "fundType": "ETF",
      "nav": 1.5234,
      "navTime": "2026-06-15",
      "marketPrice": 1.5800,
      "changeRate": 2.35,
      "volume": 1234567,
      "amount": 98765432,
      "premiumRate": 3.71,
      "riskLevel": "medium"
    }
  ],
  "total": 1,
  "updateTime": "2026-06-16T10:00:00.000Z"
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| fundCode | string | 基金代码 |
| fundName | string | 基金名称 |
| fundType | string | 基金类型（QDII/ETF/LOF） |
| nav | number | 基金净值（元） |
| navTime | string | 净值日期 |
| marketPrice | number/null | 市场交易价格（元），场外基金为 null |
| changeRate | number/null | 涨跌幅（%） |
| volume | number/null | 成交量（手） |
| amount | number/null | 成交额（元） |
| premiumRate | number/null | 溢价率（%），无法计算时为 null |
| riskLevel | string | 风险等级：high(>5%)、medium(2-5%)、low(<2%)、unknown |

---

### 2. 手动刷新数据

**接口地址**：`POST /api/refresh`

**响应示例**：

```json
{
  "success": true,
  "message": "数据刷新成功",
  "updateTime": "2026-06-16T10:15:00.000Z"
}
```

---

### 3. 获取数据更新状态

**接口地址**：`GET /api/status`

**响应示例**：

```json
{
  "success": true,
  "updateTime": "2026-06-16T10:00:00.000Z",
  "refreshInterval": 900000,
  "cronExpression": "*/15 * * * *"
}
```

---

### 4. 健康检查

**接口地址**：`GET /api/health`

**响应示例**：

```json
{
  "status": "ok",
  "timestamp": "2026-06-16T10:00:00.000Z"
}
```

---

## 溢价率计算说明

### 计算公式

```
溢价率 = (市场价格 - 基金净值) / 基金净值 × 100%
```

- **正溢价（溢价率 > 0）**：市场价格高于净值，买入需支付溢价
- **负溢价/折价（溢价率 < 0）**：市场价格低于净值，可折价买入
- **高溢价风险**：溢价率 > 5% 时标记为高风险，买入后溢价回落可能造成亏损

### 风险等级划分

| 等级 | 溢价率范围 | 说明 |
|------|------------|------|
| 高风险 | > 5% | 溢价过高，买入风险大 |
| 中风险 | 2% ~ 5% | 存在一定溢价，需关注 |
| 低风险 | < 2% | 溢价较低或折价 |
| 未知 | 无法计算 | 数据缺失 |

---

## 数据源说明

本项目使用东方财富网的公开数据接口：

| 数据 | 接口 | 说明 |
|------|------|------|
| QDII基金列表 | `fundapi.eastmoney.com` | 获取所有QDII基金代码与名称 |
| 基金净值 | `fundgz.1234567.com.cn` | 获取基金实时估算净值 |
| 场内行情 | `push2.eastmoney.com` | 获取ETF/LOF场内交易价格 |

> **注意**：数据接口来自东方财富网公开页面，非官方API，可能存在变更风险。如接口失效，需更新 `src/config/index.js` 中的地址。

---

## 异常处理机制

1. **网络请求失败**：自动重试3次，每次间隔递增（1s、2s、3s）
2. **数据格式校验**：对净值、价格等关键字段进行类型和范围校验
3. **错误日志**：所有异常记录到 `logs/error.log`
4. **前端提示**：数据获取失败时显示错误提示横幅

---

## 配置说明

配置文件位于 `src/config/index.js`，可调整以下参数：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| PORT | 3000 | 服务监听端口 |
| REFRESH_INTERVAL | 900000 | 数据刷新间隔（毫秒，15分钟） |
| CRON_EXPRESSION | `*/15 * * * *` | 定时任务cron表达式 |
| REQUEST_TIMEOUT | 10000 | HTTP请求超时（毫秒） |

---

## 使用建议

1. **投资参考**：溢价率仅供参考，高溢价基金买入后可能面临溢价回归导致的亏损
2. **交易时段**：场内价格在交易时段（9:30-15:00）实时变化，非交易时段显示收盘价
3. **净值延迟**：QDII基金净值通常有1-2天延迟（因海外市场时差），溢价率计算基于最新可得净值
