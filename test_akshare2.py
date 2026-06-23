# -*- coding: utf-8 -*-
"""单独测试LOF和估值接口"""
import akshare as ak
import sys
sys.stdout.reconfigure(encoding='utf-8')

print("测试: LOF实时行情 fund_lof_spot_em")
try:
    df = ak.fund_lof_spot_em()
    print(f"返回 {len(df)} 条数据")
    print(f"列名: {list(df.columns)}")
    print(df.head(2).to_string())
    print()
    # 查找跨境LOF
    cross_border = df[df['名称'].str.contains('纳指|纳斯达克|标普|恒生|日经|德国|法国|中概|互联|全球|海外|亚洲|美国|原油|黄金|油气|商品', na=False)]
    print(f"跨境/海外LOF: {len(cross_border)} 只")
    if len(cross_border) > 0:
        print(cross_border[['代码', '名称']].head(20).to_string())
except Exception as e:
    print(f"失败: {e}")

print()
print("=" * 60)
print("测试: 基金净值估值 fund_value_estimation_em")
try:
    df2 = ak.fund_value_estimation_em()
    print(f"返回 {len(df2)} 条数据")
    print(f"列名: {list(df2.columns)}")
    print(df2.head(2).to_string())
except Exception as e:
    print(f"失败: {e}")
