# -*- coding: utf-8 -*-
"""测试 AkShare 获取跨境ETF/LOF基金溢价率的核心接口"""
import akshare as ak
import sys
sys.stdout.reconfigure(encoding='utf-8')

print("=" * 60)
print("测试1: ETF实时行情 fund_etf_spot_em")
print("=" * 60)
try:
    df = ak.fund_etf_spot_em()
    print(f"返回 {len(df)} 条数据")
    print(f"列名: {list(df.columns)}")
    print(df.head(2).to_string())
    print()
    # 查找纳指相关ETF
    nasdaq = df[df['名称'].str.contains('纳指|纳斯达克', na=False)]
    print(f"纳指相关ETF: {len(nasdaq)} 只")
    if len(nasdaq) > 0:
        print(nasdaq[['代码', '名称']].head(15).to_string())
    print()
except Exception as e:
    print(f"失败: {e}")
    print()

print("=" * 60)
print("测试2: LOF实时行情 fund_lof_spot_em")
print("=" * 60)
try:
    df2 = ak.fund_lof_spot_em()
    print(f"返回 {len(df2)} 条数据")
    print(f"列名: {list(df2.columns)}")
    print(df2.head(2).to_string())
    print()
except Exception as e:
    print(f"失败: {e}")
    print()

print("=" * 60)
print("测试3: 基金净值估值 fund_value_estimation_em")
print("=" * 60)
try:
    df3 = ak.fund_value_estimation_em()
    print(f"返回 {len(df3)} 条数据")
    print(f"列名: {list(df3.columns)}")
    print(df3.head(2).to_string())
    print()
except Exception as e:
    print(f"失败: {e}")
    print()
