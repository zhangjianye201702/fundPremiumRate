/**
 * 前端应用主逻辑
 * 负责与后端API交互、数据渲染、筛选排序交互
 */

// 全局状态：当前筛选、排序和分页参数
let currentFilters = {
  fundType: 'ALL',
  sortBy: 'estimatedPremiumRate',
  sortOrder: 'desc',
  minPremium: '',
  maxPremium: '',
  keyword: '',
  page: 1,
  pageSize: 10
};

// 分页元信息（由后端返回）
let paginationMeta = {
  total: 0,
  totalPages: 0
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
    currentFilters.page = 1;  // 筛选变化重置到第1页
    fetchFundData();
  });

  document.getElementById('sortBy').addEventListener('change', () => {
    currentFilters.sortBy = document.getElementById('sortBy').value;
    currentFilters.page = 1;
    fetchFundData();
  });

  document.getElementById('sortOrder').addEventListener('change', () => {
    currentFilters.sortOrder = document.getElementById('sortOrder').value;
    currentFilters.page = 1;
    fetchFundData();
  });

  document.getElementById('minPremium').addEventListener('input', (e) => {
    currentFilters.minPremium = e.target.value;
    currentFilters.page = 1;
    debouncedFetch();
  });

  document.getElementById('maxPremium').addEventListener('input', (e) => {
    currentFilters.maxPremium = e.target.value;
    currentFilters.page = 1;
    debouncedFetch();
  });

  document.getElementById('keyword').addEventListener('input', (e) => {
    currentFilters.keyword = e.target.value;
    currentFilters.page = 1;
    debouncedFetch();
  });

  // 表头点击排序
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => handleSort(th.dataset.sort));
  });

  // 分页控件事件
  bindPaginationEvents();
}

/**
 * 绑定分页控件事件
 * 包括：首页/上一页/下一页/末页按钮、每页条数切换
 */
function bindPaginationEvents() {
  // 上一页
  document.getElementById('prevPageBtn').addEventListener('click', () => goToPage(currentFilters.page - 1));
  // 下一页
  document.getElementById('nextPageBtn').addEventListener('click', () => goToPage(currentFilters.page + 1));

  // 每页条数切换：重置到第1页
  document.getElementById('pageSizeSelect').addEventListener('change', (e) => {
    currentFilters.pageSize = parseInt(e.target.value);
    currentFilters.page = 1;
    fetchFundData();
  });
}

/**
 * 跳转到指定页码
 * @param {number} page - 目标页码（从1开始）
 */
function goToPage(page) {
  // 边界保护
  if (page < 1 || page > paginationMeta.totalPages) {
    return;
  }
  currentFilters.page = page;
  fetchFundData();
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

  // 排序变化时重置到第1页
  currentFilters.page = 1;
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
    // 分页参数
    params.append('page', currentFilters.page);
    params.append('pageSize', currentFilters.pageSize);

    const response = await fetch(`/api/funds?${params.toString()}`);
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || '获取数据失败');
    }

    // 保存分页元信息（后端返回）
    paginationMeta.total = result.total || 0;
    paginationMeta.totalPages = result.totalPages || 0;
    // 后端可能对越界页码做了保护，回写实际页码
    if (result.page) {
      currentFilters.page = result.page;
    }

    renderTable(result.data);
    updateStats(result.data, result.total);
    renderPagination();
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
 * @param {Array} funds - 当前页基金数据列表（用于风险等级统计）
 * @param {number} totalCount - 筛选后的基金总数（跨页）
 */
function updateStats(funds, totalCount) {
  // 总数显示筛选后的全部条数（而非当前页条数）
  document.getElementById('totalCount').textContent = totalCount !== undefined ? totalCount : funds.length;

  // 按风险等级统计（仅统计当前页，避免每次都请求全量数据）
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
 * 渲染分页控件
 * 包括：页码信息文本、页码按钮（带省略号）、首/上/下/末页按钮状态、每页条数回显
 */
function renderPagination() {
  const { page, pageSize } = currentFilters;
  const { total, totalPages } = paginationMeta;

  const pageInfo = document.getElementById('pageInfo');
  const pageNums = document.getElementById('pageNums');
  const pagination = document.getElementById('pagination');

  // 无数据时隐藏分页控件
  if (total === 0) {
    pagination.style.display = 'none';
    return;
  }
  pagination.style.display = 'flex';

  // 页码信息文本：第 X-Y 条 / 共 Z 条
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  pageInfo.textContent = `第 ${start}-${end} 条 / 共 ${total} 条`;

  // 渲染页码按钮（带省略号折叠）
  pageNums.innerHTML = generatePageNumbers(page, totalPages).map(item => {
    if (item === '...') {
      return `<span class="page-ellipsis">···</span>`;
    }
    return `<button class="btn-page${item === page ? ' active' : ''}" data-page="${item}">${item}</button>`;
  }).join('');

  // 给页码按钮绑定点击事件
  pageNums.querySelectorAll('button[data-page]').forEach(btn => {
    btn.addEventListener('click', () => goToPage(parseInt(btn.dataset.page)));
  });

  // 上/下一页按钮的禁用状态
  document.getElementById('prevPageBtn').disabled = page <= 1;
  document.getElementById('nextPageBtn').disabled = page >= totalPages;

  // 每页条数下拉框回显当前值
  document.getElementById('pageSizeSelect').value = pageSize;
}

/**
 * 生成页码数组（含省略号）
 * 例如：当前第5页，共20页 → [1, '...', 4, 5, 6, '...', 20]
 * @param {number} current - 当前页码
 * @param {number} total - 总页数
 * @returns {Array} 页码与省略号组成的数组
 */
function generatePageNumbers(current, total) {
  const result = [];
  // 页数较少（≤7页）时全部展示，无需省略号
  if (total <= 7) {
    for (let i = 1; i <= total; i++) {
      result.push(i);
    }
    return result;
  }

  // 始终显示第1页
  result.push(1);

  // 当前页左侧：距离第1页超过2页时显示省略号
  const leftStart = Math.max(2, current - 1);
  if (leftStart > 2) {
    result.push('...');
  }
  for (let i = leftStart; i < current; i++) {
    result.push(i);
  }

  // 当前页
  result.push(current);

  // 当前页右侧：距离末页超过2页时显示省略号
  const rightEnd = Math.min(total - 1, current + 1);
  for (let i = current + 1; i <= rightEnd; i++) {
    result.push(i);
  }
  if (rightEnd < total - 1) {
    result.push('...');
  }

  // 始终显示末页
  result.push(total);

  return result;
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
