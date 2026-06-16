/**
 * 前端应用主逻辑
 * 负责与后端API交互、数据渲染、筛选排序交互
 */

// 全局状态：当前筛选和排序参数
let currentFilters = {
  fundType: 'ALL',
  sortBy: 'estimatedPremiumRate',
  sortOrder: 'desc',
  minPremium: '',
  maxPremium: '',
  keyword: ''
};

/**
 * 页面加载完成后初始化
 */
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  fetchFundData();
  // 每60秒轮询一次状态，检测数据是否已更新
  setInterval(updateStatus, 60000);
});

/**
 * 绑定页面事件监听
 */
function bindEvents() {
  // 刷新按钮
  document.getElementById('refreshBtn').addEventListener('click', handleManualRefresh);

  // 筛选条件变化时自动查询（使用防抖减少请求频率）
  const debouncedFetch = debounce(fetchFundData, 300);

  document.getElementById('fundTypeFilter').addEventListener('change', () => {
    currentFilters.fundType = document.getElementById('fundTypeFilter').value;
    fetchFundData();
  });

  document.getElementById('sortBy').addEventListener('change', () => {
    currentFilters.sortBy = document.getElementById('sortBy').value;
    fetchFundData();
  });

  document.getElementById('sortOrder').addEventListener('change', () => {
    currentFilters.sortOrder = document.getElementById('sortOrder').value;
    fetchFundData();
  });

  document.getElementById('minPremium').addEventListener('input', (e) => {
    currentFilters.minPremium = e.target.value;
    debouncedFetch();
  });

  document.getElementById('maxPremium').addEventListener('input', (e) => {
    currentFilters.maxPremium = e.target.value;
    debouncedFetch();
  });

  document.getElementById('keyword').addEventListener('input', (e) => {
    currentFilters.keyword = e.target.value;
    debouncedFetch();
  });

  // 表头点击排序
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => handleSort(th.dataset.sort));
  });
}

/**
 * 处理表头点击排序
 * @param {string} field - 排序字段
 */
function handleSort(field) {
  if (currentFilters.sortBy === field) {
    // 同一字段：切换排序方向
    currentFilters.sortOrder = currentFilters.sortOrder === 'asc' ? 'desc' : 'asc';
  } else {
    currentFilters.sortBy = field;
    currentFilters.sortOrder = 'desc';
  }

  // 同步更新下拉框
  document.getElementById('sortBy').value = currentFilters.sortBy;
  document.getElementById('sortOrder').value = currentFilters.sortOrder;

  fetchFundData();
}

/**
 * 从后端获取基金数据
 */
async function fetchFundData() {
  try {
    // 构建查询参数
    const params = new URLSearchParams();
    params.append('fundType', currentFilters.fundType);
    params.append('sortBy', currentFilters.sortBy);
    params.append('sortOrder', currentFilters.sortOrder);
    if (currentFilters.minPremium !== '') {
      params.append('minPremium', currentFilters.minPremium);
    }
    if (currentFilters.maxPremium !== '') {
      params.append('maxPremium', currentFilters.maxPremium);
    }
    if (currentFilters.keyword) {
      params.append('keyword', currentFilters.keyword);
    }

    const response = await fetch(`/api/funds?${params.toString()}`);
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || '获取数据失败');
    }

    renderTable(result.data);
    updateStats(result.data);
    updateSortIcons();

    // 隐藏加载遮罩
    document.getElementById('loadingOverlay').classList.add('hidden');
  } catch (error) {
    showError(`获取基金数据失败: ${error.message}`);
    document.getElementById('loadingOverlay').classList.add('hidden');
  }
}

/**
 * 渲染基金数据表格
 * @param {Array} funds - 基金数据列表
 */
function renderTable(funds) {
  const tbody = document.getElementById('fundTableBody');
  const emptyState = document.getElementById('emptyState');

  if (!funds || funds.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  tbody.innerHTML = funds.map(fund => {
    // T-1 溢价率样式：正溢价红色，负溢价（折价）绿色
    let premiumClass = 'premium-null';
    let premiumText = '--';
    if (fund.premiumRate !== null && fund.premiumRate !== undefined) {
      premiumClass = fund.premiumRate >= 0 ? 'premium-positive' : 'premium-negative';
      premiumText = (fund.premiumRate >= 0 ? '+' : '') + fund.premiumRate.toFixed(2) + '%';
    }

    // T日 估算溢价率样式
    let estPremiumClass = 'premium-null';
    let estPremiumText = '--';
    if (fund.estimatedPremiumRate !== null && fund.estimatedPremiumRate !== undefined) {
      estPremiumClass = fund.estimatedPremiumRate >= 0 ? 'premium-positive' : 'premium-negative';
      estPremiumText = (fund.estimatedPremiumRate >= 0 ? '+' : '') + fund.estimatedPremiumRate.toFixed(2) + '%';
    }

    // 涨跌幅样式
    let changeClass = '';
    let changeText = '--';
    if (fund.changeRate !== null && fund.changeRate !== undefined) {
      changeClass = fund.changeRate >= 0 ? 'change-positive' : 'change-negative';
      changeText = (fund.changeRate >= 0 ? '+' : '') + fund.changeRate.toFixed(2) + '%';
    }

    // 风险等级标签
    const riskLabels = {
      high: { text: '高风险', class: 'risk-high' },
      medium: { text: '中风险', class: 'risk-medium' },
      low: { text: '低风险', class: 'risk-low' },
      unknown: { text: '未知', class: 'risk-unknown' }
    };
    const risk = riskLabels[fund.riskLevel] || riskLabels.unknown;

    // 基金类型标签
    const typeClass = `type-${fund.fundType}`;

    // 市场价格、T-1净值、T日估值显示
    const priceText = fund.marketPrice !== null ? fund.marketPrice.toFixed(4) : '--';
    const navText = fund.nav ? fund.nav.toFixed(4) : '--';
    const estNavText = fund.estimatedNav ? fund.estimatedNav.toFixed(4) : '--';

    // 成交额显示（转换为万元）
    let volumeText = '--';
    if (fund.amount !== null && fund.amount !== undefined) {
      volumeText = (fund.amount / 10000).toFixed(0);
    }

    return `
      <tr>
        <td><span class="fund-code">${fund.fundCode}</span></td>
        <td class="fund-name">${fund.fundName}</td>
        <td><span class="type-badge ${typeClass}">${fund.fundType}</span></td>
        <td>${priceText}</td>
        <td>${navText}</td>
        <td>${estNavText}</td>
        <td class="${premiumClass}">${premiumText}</td>
        <td class="${estPremiumClass}">${estPremiumText}</td>
        <td class="${changeClass}">${changeText}</td>
        <td>${volumeText}</td>
        <td><span class="risk-badge ${risk.class}">${risk.text}</span></td>
        <td>${fund.navTime || '--'}</td>
      </tr>
    `;
  }).join('');
}

/**
 * 更新统计数据
 * @param {Array} funds - 基金数据列表
 */
function updateStats(funds) {
  document.getElementById('totalCount').textContent = funds.length;

  // 按风险等级统计
  let highCount = 0, mediumCount = 0, lowCount = 0;
  funds.forEach(f => {
    if (f.riskLevel === 'high') highCount++;
    else if (f.riskLevel === 'medium') mediumCount++;
    else if (f.riskLevel === 'low') lowCount++;
  });

  document.getElementById('highRiskCount').textContent = highCount;
  document.getElementById('mediumRiskCount').textContent = mediumCount;
  document.getElementById('lowRiskCount').textContent = lowCount;
}

/**
 * 更新表头排序图标
 */
function updateSortIcons() {
  document.querySelectorAll('th.sortable').forEach(th => {
    const icon = th.querySelector('.sort-icon');
    icon.classList.remove('asc', 'desc');
    if (th.dataset.sort === currentFilters.sortBy) {
      icon.classList.add(currentFilters.sortOrder);
    }
  });
}

/**
 * 手动刷新数据
 */
async function handleManualRefresh() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = '刷新中...';

  try {
    const response = await fetch('/api/refresh', { method: 'POST' });
    const result = await response.json();

    if (result.success) {
      await fetchFundData();
      updateStatus();
    } else {
      throw new Error(result.message || '刷新失败');
    }
  } catch (error) {
    showError(`数据刷新失败: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '刷新数据';
  }
}

/**
 * 更新数据状态（最后更新时间）
 */
async function updateStatus() {
  try {
    const response = await fetch('/api/status');
    const result = await response.json();
    if (result.success && result.updateTime) {
      const time = new Date(result.updateTime).toLocaleString('zh-CN');
      document.getElementById('updateTime').textContent = `最后更新: ${time}`;
    }
  } catch (error) {
    // 静默失败，不打扰用户
    console.warn('获取状态失败:', error);
  }
}

/**
 * 显示错误提示
 * @param {string} message - 错误信息
 */
function showError(message) {
  const banner = document.getElementById('errorBanner');
  document.getElementById('errorMessage').textContent = message;
  banner.style.display = 'flex';
  // 5秒后自动隐藏
  setTimeout(() => {
    banner.style.display = 'none';
  }, 5000);
}

/**
 * 防抖函数：延迟执行，避免频繁触发
 * @param {Function} fn - 要执行的函数
 * @param {number} delay - 延迟毫秒数
 * @returns {Function} 防抖处理后的函数
 */
function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
