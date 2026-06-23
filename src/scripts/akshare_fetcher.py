# -*- coding: utf-8 -*-
"""
AkShare 数据采集脚本
====================
使用 AkShare 平台获取主要投资国外的 LOF 与 ETF 基金实时行情，
计算溢价率（基于 IOPV 实时估值与 T-1 单位净值），并将结果输出为 JSON 文件，
供 Node.js 后端读取展示。

数据来源接口（东方财富，经 AkShare 封装）：
- fund_etf_spot_em: 场内 ETF 实时行情（含 IOPV 实时估值、基金折价率）
- fund_lof_spot_em: 场内 LOF 实时行情
- fund_open_fund_daily_em: 开放式基金每日净值（用于获取 T-1 单位净值）

运行方式：
    py akshare_fetcher.py [输出文件路径]

输出 JSON 结构：
{
    "updateTime": "2026-06-17T10:30:00+08:00",   // 采集时间（ISO 格式）
    "data": [ ...基金数据列表... ]
}
"""
import sys
import io
import json
import time
import traceback
from datetime import datetime

# 统一标准输出编码为 utf-8，避免 Windows 控制台中文乱码
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

import akshare as ak
import pandas as pd


# ===========================================================================
# 配置区
# ===========================================================================

# 跨境/海外基金名称关键词：用于从 LOF/ETF 全量列表中筛选主要投资国外的品种
# 命中任一关键词即视为跨境基金（涵盖美股、欧股、日股、港股、中概、商品等）
CROSS_BORDER_KEYWORDS = [
    # 美股相关
    '纳指', '纳斯达克', '标普', '道琼斯', '美国', '美股',
    # 中概 / 跨境互联网
    '中概', '互联',
    # 全球 / 海外
    '全球', '海外',
    # 亚太 / 东南亚 / 中东
    '亚洲', '亚太', '东南亚', '日本', '日经', '沙特', '印度', '越南', '韩国',
    # 欧洲
    '德国', '法国', '英国', '欧洲', 'DAX', 'CAC',
    # 港股
    '恒生', '港股', 'H股', '港股通',
    # 商品 / 资源（部分 QDII 商品基金也在场内交易）
    '原油', '黄金', '油气', '商品',
]

# 拼接为正则表达式（OR 关系），用于 pandas str.contains 匹配
CROSS_BORDER_PATTERN = '|'.join(CROSS_BORDER_KEYWORDS)

# AkShare 接口请求重试参数（该数据源偶发连接中断，需重试）
MAX_RETRIES = 3
RETRY_DELAY = 2  # 重试间隔（秒）

# 场内行情字段中，若最新价为 0 或 NaN，视为当日无有效报价（如停牌、未开盘）
INVALID_PRICE = 0


# ===========================================================================
# 工具函数
# ===========================================================================

def request_with_retry(func, *args, **kwargs):
    """
    带重试机制的 AkShare 接口调用
    AkShare 底层请求东方财富接口，偶发 RemoteDisconnected，需重试保障稳定性

    @param {function} func - 要调用的函数（如 ak.fund_etf_spot_em）
    @param {tuple} args - 位置参数
    @param {dict} kwargs - 关键字参数
    @returns {object} 函数返回值（通常为 DataFrame）
    @throws {Exception} 所有重试均失败时抛出最后一次异常
    """
    last_exception = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            last_exception = e
            # 输出重试日志到 stderr，便于排查
            print(f"[重试 {attempt}/{MAX_RETRIES}] 接口调用失败: {e}", file=sys.stderr)
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY * attempt)  # 递增等待
    # 所有重试失败，抛出异常
    raise last_exception


def safe_float(value, default=None):
    """
    安全转换为浮点数
    处理空值、异常字符串等情况

    @param {any} value - 原始值
    @param {any} default - 转换失败时的默认返回值
    @returns {float|any} 转换后的浮点数或默认值
    """
    if value is None or pd.isna(value):
        return default
    try:
        result = float(value)
        # NaN 判断（float('nan') 不会被 pd.isna 捕获时的兜底）
        if result != result:
            return default
        return result
    except (ValueError, TypeError):
        return default


def calc_premium_rate(market_price, nav):
    """
    计算溢价率（百分比）
    公式：(市场价格 - 净值) / 净值 × 100%

    @param {float} market_price - 场内最新交易价格
    @param {float} nav - 基金参考净值（IOPV 或 T-1 单位净值）
    @returns {float|null} 溢价率（保留两位小数），数据无效返回 None
    """
    if market_price is None or nav is None:
        return None
    if nav <= 0:
        return None
    premium = (market_price - nav) / nav * 100
    return round(premium, 2)


def get_risk_level(premium_rate):
    """
    根据溢价率判定风险等级
    阈值：>5% 高风险，2%-5% 中风险，<2% 低风险（含折价）

    @param {float|null} premium_rate - 溢价率
    @returns {str} high / medium / low / unknown
    """
    if premium_rate is None:
        return 'unknown'
    if premium_rate > 5:
        return 'high'
    elif premium_rate > 2:
        return 'medium'
    else:
        return 'low'


# ===========================================================================
# 数据采集核心逻辑
# ===========================================================================

def fetch_cross_border_funds():
    """
    获取跨境（主要投资国外）的 LOF 与 ETF 实时行情
    分别调用 LOF / ETF 实时行情接口，用关键词筛选跨境品种后合并

    @returns {list} 跨境基金实时行情列表，每项含统一字段
    @throws {Exception} 两个接口均失败时抛出异常
    """
    funds = []

    # ---------- ETF 实时行情 ----------
    etf_error = None
    try:
        print("[采集] 正在获取 ETF 实时行情...", file=sys.stderr)
        etf_df = request_with_retry(ak.fund_etf_spot_em)
        print(f"[采集] ETF 全量数据 {len(etf_df)} 条", file=sys.stderr)
        etf_cross = filter_cross_border(etf_df, fund_type='ETF')
        print(f"[采集] 跨境 ETF 筛选后 {len(etf_cross)} 条", file=sys.stderr)
        funds.extend(etf_cross)
    except Exception as e:
        etf_error = e
        print(f"[采集] ETF 接口失败: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)

    # ---------- LOF 实时行情 ----------
    lof_error = None
    try:
        print("[采集] 正在获取 LOF 实时行情...", file=sys.stderr)
        lof_df = request_with_retry(ak.fund_lof_spot_em)
        print(f"[采集] LOF 全量数据 {len(lof_df)} 条", file=sys.stderr)
        lof_cross = filter_cross_border(lof_df, fund_type='LOF')
        print(f"[采集] 跨境 LOF 筛选后 {len(lof_cross)} 条", file=sys.stderr)
        funds.extend(lof_cross)
    except Exception as e:
        lof_error = e
        print(f"[采集] LOF 接口失败: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)

    # 两个接口都失败时抛出异常（无法继续）
    if not funds and etf_error and lof_error:
        raise RuntimeError(f"ETF 与 LOF 接口均失败: ETF={etf_error}; LOF={lof_error}")

    return funds


def filter_cross_border(df, fund_type):
    """
    从全量行情 DataFrame 中筛选跨境基金，并统一字段格式

    @param {DataFrame} df - AkShare 返回的行情数据
    @param {str} fund_type - 基金类型（'ETF' 或 'LOF'）
    @returns {list} 统一格式的基金字典列表
    """
    if df is None or len(df) == 0:
        return []

    # 按名称关键词筛选跨境品种（na=False 避免 NaN 报错）
    mask = df['名称'].str.contains(CROSS_BORDER_PATTERN, na=False)
    cross_df = df[mask].copy()

    result = []
    for _, row in cross_df.iterrows():
        # 最新交易价格（元），无效则跳过该基金
        price = safe_float(row.get('最新价'))
        if price is None or price <= INVALID_PRICE:
            continue

        # IOPV 实时估值（参考净值），用于计算 T 日实时溢价率
        iopv = safe_float(row.get('IOPV实时估值'))

        # 基金折价率（东方财富提供，单位 %，= (IOPV - 价) / IOPV × 100）
        # 溢价率 = -折价率
        discount_rate = safe_float(row.get('基金折价率'))

        # 涨跌幅（%）
        change_rate = safe_float(row.get('涨跌幅'))

        # 成交量（手）、成交额（元）
        volume = safe_float(row.get('成交量'), 0)
        amount = safe_float(row.get('成交额'), 0)

        # 数据日期与更新时间
        data_date = str(row.get('数据日期', '') or '')
        update_time = str(row.get('更新时间', '') or '')

        item = {
            'fundCode': str(row.get('代码', '')).strip(),
            'fundName': str(row.get('名称', '')).strip(),
            'fundType': fund_type,
            # 市场价格（元）
            'marketPrice': price,
            'marketPriceTime': update_time,
            # IOPV 实时估值（T 日参考净值）
            'iopv': iopv,
            # 涨跌幅（%）
            'changeRate': change_rate if change_rate is not None else None,
            # 成交量（手）、成交额（元）
            'volume': volume if volume is not None else 0,
            'amount': amount if amount is not None else 0,
            # 数据日期
            'dataDate': data_date,
            # 原始折价率（来自东方财富，保留用于参考）
            'discountRate': discount_rate if discount_rate is not None else None,
        }
        result.append(item)

    return result


def fetch_t1_nav(fund_codes):
    """
    批量获取基金 T-1 单位净值
    使用开放式基金日报接口，返回 {基金代码: 单位净值} 映射
    若接口失败则返回空字典（不影响主流程，T-1 溢价率置空）

    @param {list} fund_codes - 基金代码列表
    @returns {dict} {基金代码: 单位净值(float)}
    """
    nav_map = {}
    try:
        print("[采集] 正在获取基金 T-1 净值...", file=sys.stderr)
        # 开放式基金每日净值（含单位净值、累计净值）
        daily_df = request_with_retry(ak.fund_open_fund_daily_em)
        if daily_df is None or len(daily_df) == 0:
            print("[采集] T-1 净值接口返回空数据", file=sys.stderr)
            return nav_map

        # 基金代码列名通常为 "基金代码"，单位净值列名为 "单位净值"
        # 不同 AkShare 版本列名可能略有差异，做兼容处理
        code_col = '基金代码' if '基金代码' in daily_df.columns else daily_df.columns[0]
        nav_col = None
        for col in daily_df.columns:
            if '单位净值' in str(col):
                nav_col = col
                break

        if nav_col is None:
            print(f"[采集] 未找到单位净值列，现有列: {list(daily_df.columns)}", file=sys.stderr)
            return nav_map

        # 构建净值映射
        code_set = set(fund_codes)
        for _, row in daily_df.iterrows():
            code = str(row[code_col]).strip()
            if code in code_set:
                nav = safe_float(row[nav_col])
                if nav is not None and nav > 0:
                    nav_map[code] = nav

        print(f"[采集] T-1 净值获取完成，匹配 {len(nav_map)}/{len(fund_codes)} 只基金", file=sys.stderr)
    except Exception as e:
        # T-1 净值为辅助信息，失败不影响主流程
        print(f"[采集] 获取 T-1 净值失败（不影响实时溢价率）: {e}", file=sys.stderr)

    return nav_map


def fetch_realtime_nav_estimation(fund_codes):
    """
    获取基金实时估算净值（来自天天基金估值接口）
    fund_value_estimation_em 覆盖 ETF 和 LOF，弥补 LOF 行情接口无 IOPV 的缺陷

    @param {list} fund_codes - 基金代码列表
    @returns {dict} {基金代码: 估算净值(float)}
    """
    est_map = {}
    try:
        print("[采集] 正在获取基金实时估算净值...", file=sys.stderr)
        est_df = request_with_retry(ak.fund_value_estimation_em)
        if est_df is None or len(est_df) == 0:
            print("[采集] 实时估算净值接口返回空数据", file=sys.stderr)
            return est_map

        # 列名为动态日期格式，需匹配包含"估算值"的列
        est_col = None
        for col in est_df.columns:
            if '估算值' in str(col):
                est_col = col
                break

        if est_col is None:
            print(f"[采集] 未找到估算值列，现有列: {list(est_df.columns)}", file=sys.stderr)
            return est_map

        # 基金代码列名通常为 "基金代码"
        code_col = '基金代码' if '基金代码' in est_df.columns else est_df.columns[1]

        # 构建估算净值映射
        code_set = set(fund_codes)
        for _, row in est_df.iterrows():
            code = str(row[code_col]).strip()
            if code in code_set:
                est_nav = safe_float(row[est_col])
                if est_nav is not None and est_nav > 0:
                    est_map[code] = est_nav

        print(f"[采集] 实时估算净值获取完成，匹配 {len(est_map)}/{len(fund_codes)} 只基金", file=sys.stderr)
    except Exception as e:
        # 估算净值为辅助信息，失败不影响主流程
        print(f"[采集] 获取实时估算净值失败（不影响 ETF 溢价率）: {e}", file=sys.stderr)

    return est_map


def build_final_data(funds, nav_map, est_nav_map):
    """
    组合实时行情、T-1 净值与实时估算净值，计算溢价率，输出最终数据列表

    溢价率优先级：
      ETF → 优先用 IOPV 实时估值
      LOF → IOPV 通常为空，回退到估算净值接口（fund_value_estimation_em）

    @param {list} funds - 实时行情列表
    @param {dict} nav_map - T-1 单位净值映射
    @param {dict} est_nav_map - 实时估算净值映射（来自天天基金估值）
    @returns {list} 最终基金数据列表（含溢价率、风险等级）
    """
    result = []
    for fund in funds:
        code = fund['fundCode']
        price = fund['marketPrice']
        iopv = fund['iopv']
        t1_nav = nav_map.get(code)  # T-1 单位净值（可能为空）

        # T 日实时参考净值：优先用 IOPV（ETF），其次用估算净值接口（LOF）
        # IOPV 是交易所发布的参考净值，精度最高；LOF 无 IOPV 时用估值接口兜底
        realtime_nav = iopv
        if realtime_nav is None:
            realtime_nav = est_nav_map.get(code)

        # T 日实时溢价率：基于实时参考净值（IOPV 或估算净值）
        realtime_premium = calc_premium_rate(price, realtime_nav)

        # T-1 溢价率：基于 T-1 单位净值（确定的，但有时滞）
        t1_premium = calc_premium_rate(price, t1_nav)

        # 风险等级以实时溢价率为准，缺失时回退 T-1 溢价率
        risk_premium = realtime_premium if realtime_premium is not None else t1_premium
        risk_level = get_risk_level(risk_premium)

        item = {
            'fundCode': code,
            'fundName': fund['fundName'],
            'fundType': fund['fundType'],
            # 市场价格（元）
            'marketPrice': price,
            'marketPriceTime': fund['marketPriceTime'],
            # T-1 单位净值（元，基金公司公布的上一交易日净值）
            'nav': t1_nav,
            'navTime': fund['dataDate'],
            # T 日实时估值（IOPV 或估算净值，元）
            'estimatedNav': realtime_nav,
            'estimatedNavTime': fund['marketPriceTime'],
            # 涨跌幅（%）
            'changeRate': fund['changeRate'],
            # 成交量（手）、成交额（元）
            'volume': fund['volume'],
            'amount': fund['amount'],
            # T-1 溢价率（%）
            'premiumRate': t1_premium,
            # T 日实时溢价率（%，基于 IOPV）
            'estimatedPremiumRate': realtime_premium,
            # 风险等级
            'riskLevel': risk_level,
        }
        result.append(item)

    return result


# ===========================================================================
# 主入口
# ===========================================================================

def main():
    """
    脚本主入口
    采集跨境 LOF/ETF 数据 → 计算 T-1 与实时溢价率 → 输出 JSON 文件
    """
    # 默认输出文件路径（可由命令行参数覆盖）
    output_path = sys.argv[1] if len(sys.argv) > 1 else './data/fund_data.json'

    print(f"[采集] AkShare 数据采集开始，时间: {datetime.now().isoformat()}", file=sys.stderr)

    # 第一步：获取跨境基金实时行情
    funds = fetch_cross_border_funds()
    print(f"[采集] 跨境基金合计 {len(funds)} 只", file=sys.stderr)

    if not funds:
        raise RuntimeError("未获取到任何跨境基金数据")

    # 第二步：获取 T-1 单位净值（辅助，失败不中断）
    fund_codes = [f['fundCode'] for f in funds]
    nav_map = fetch_t1_nav(fund_codes)

    # 第三步：获取实时估算净值（主要补全 LOF，ETF 有 IOPV 时不受影响）
    est_nav_map = fetch_realtime_nav_estimation(fund_codes)

    # 第四步：组合数据、计算溢价率
    final_data = build_final_data(funds, nav_map, est_nav_map)

    # 第五步：输出 JSON 文件
    output = {
        'updateTime': datetime.now().isoformat(timespec='seconds'),
        'data': final_data,
    }

    # 写入文件（ensure_ascii=False 保留中文，indent 便于调试）
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"[采集] 数据采集完成，共 {len(final_data)} 只基金，输出至 {output_path}", file=sys.stderr)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        # 致命错误：输出到 stderr 并以非零状态码退出，便于 Node 端检测失败
        print(f"[采集] 数据采集失败: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
