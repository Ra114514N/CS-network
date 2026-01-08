const resolveBtn = document.getElementById('resolve');
const traceEl = document.getElementById('trace');
const statsEl = document.getElementById('stats');
const aiEl = document.getElementById('ai');
const askAiBtn = document.getElementById('ask-ai');
const aiQuestionInput = document.getElementById('ai-question');
const loadingMask = document.getElementById('loading-mask');
const tooltipEl = document.getElementById('graph-tooltip');
const packetEl = document.getElementById('packet');
const riskSummaryEl = document.getElementById('risk-summary');
const riskTrendEl = document.getElementById('risk-trend');
const refreshRiskBtn = document.getElementById('refresh-risk');

let cy = null;
let lastContext = null;
let isAnimating = false;
let animationController = new AbortController();
let packetHideTimer = null;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function initGraph(elements) {
  cy = cytoscape({
    container: document.getElementById('cy'),
    elements,
    wheelSensitivity: 0.2,
    style: [
      // --- 节点通用样式 ---
      {
        selector: 'node',
        style: {
          'background-color': '#ffffff',
          'border-color': '#999999',
          'border-width': 1,
          shape: 'roundrectangle',
          color: '#333333',
          label: 'data(label)',
          'text-wrap': 'wrap',
          'text-max-width': 100,
          'font-size': 12,
          'font-weight': 'bold',
          'text-valign': 'center',
          'text-halign': 'center',
          width: 120,
          height: 40,
          'transition-property': 'background-color, border-color, border-width, width, height',
          'transition-duration': '0.3s',
          'shadow-blur': 4,
          'shadow-color': 'rgba(0,0,0,0.1)',
          'shadow-offset-x': 1,
          'shadow-offset-y': 1
        },
      },
      // --- 角色特定样式 ---
      {
        selector: 'node[type="client"]',
        style: { 'background-color': '#e7f3fe', 'border-color': '#b0c4de' }
      },
      {
        selector: 'node[type="resolver"]',
        style: { 'background-color': '#fffacd', 'border-color': '#e0d8a0' }
      },
      {
        selector: 'node[id="local-server"]',
        style: { 'background-color': '#ffebcd', 'border-color': '#d8c7a9', 'border-width': 2 }
      },
      {
        selector: 'node[level="root"]',
        style: { 'background-color': '#f0e68c', 'border-color': '#d0c66c' }
      },
      {
        selector: 'node[level="tld"]',
        style: { 'background-color': '#d2fbd2', 'border-color': '#a0d8a0' }
      },
      {
        selector: 'node[level="auth"]',
        style: { 'background-color': '#add8e6', 'border-color': '#80b8c6' }
      },
      {
        selector: 'node[level="policy"]',
        style: { 'background-color': '#f0e5ff', 'border-color': '#b37feb', 'border-width': 2 }
      },
      // --- 连线样式 ---
      {
        selector: 'edge',
        style: {
          width: 1,
          'line-color': '#f0f0f0',
          'target-arrow-color': '#f0f0f0',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          label: 'data(label)',
          color: '#ccc',
          'font-size': 9,
          'text-rotation': 'autorotate',
          'text-margin-y': -8,
          'opacity': 0.3,
          'transition-property': 'line-color, target-arrow-color, width, opacity, color',
          'transition-duration': '0.3s'
        },
      },
      {
        selector: 'edge.hovered',
        style: {
          width: 3, 'line-color': '#1890ff', 'target-arrow-color': '#1890ff',
          color: '#1890ff', 'font-weight': 'bold', 'z-index': 1000, 'opacity': 1
        }
      },
      {
        selector: '.highlight-success',
        style: {
          'line-color': '#52c41a', 'target-arrow-color': '#52c41a', 'opacity': 1, width: 2, color: '#333'
        },
      },
      {
        selector: '.highlight-error',
        style: {
          'line-color': '#ff4d4f', 'target-arrow-color': '#ff4d4f', 'opacity': 1, width: 2, color: '#ff4d4f'
        },
      },
      {
        selector: '.node-visited',
        style: { 'border-width': 2, 'border-style': 'solid' }
      }
    ],
    layout: { name: 'breadthfirst', directed: true, padding: 20 },
  });

  cy.on('mouseover', 'edge', function(evt) {
    const edge = evt.target;
    const detail = edge.data('detail');
    if (detail) {
      edge.addClass('hovered');
      showTooltip(evt.renderedPosition, detail);
    }
  });

  cy.on('mouseout', 'edge', function(evt) {
    evt.target.removeClass('hovered');
    hideTooltip();
  });
  
  cy.on('resize', () => {
    if(!isAnimating) packetEl.classList.add('hidden');
    // 在非动画状态下，图表尺寸变化时重新适配视野
    if(!isAnimating) cy.fit(30);
  });
}

function showTooltip(pos, text) {
  tooltipEl.textContent = text;
  // 简单的边界检查，防止 Tooltip 超出顶部
  let top = pos.y - 10;
  if (top < 50) top = pos.y + 40;
  
  tooltipEl.style.left = `${pos.x}px`;
  tooltipEl.style.top = `${top}px`;
  tooltipEl.classList.remove('hidden');
}

function hideTooltip() {
  tooltipEl.classList.add('hidden');
}

function summarizeResponse(step) {
  if (!step || !step.response) return 'NO_RESPONSE';
  if (typeof step.response === 'string') return step.response;
  return step.response.status || 'UNKNOWN';
}

function normalizeServerName(server) {
  if (!server) return '';
  return server.startsWith('local->') ? server.slice(7) : server;
}

function roleFromStep(step, mode) {
  const server = normalizeServerName(step.server || '');
  if (step.level === 'policy' || server.includes('rpz')) return 'RPZ 策略';
  if (step.level === 'root' || server.includes('root')) return '根DNS';
  if (step.level === 'tld' || server.includes('gtld') || server.includes('tld')) return '顶级域DNS';
  if (step.level === 'auth') return '权威DNS';
  if (step.server === 'recursive-resolver') return '递归DNS';
  if (step.server === 'local-server' || step.level === 'local') return '本地DNS';
  return mode === 'recursive' ? '递归DNS' : '本地DNS';
}

function formatRecords(step) {
  const records = step?.response?.records || [];
  if (!records.length) return '无';
  return records.join(', ');
}

function formatTraceMessage(step, idx, mode) {
  const status = summarizeResponse(step);
  const serverName = normalizeServerName(step.server || '');
  const role = roleFromStep(step, mode);
  const roleWithServer = serverName ? `${role} (${serverName})` : role;
  const records = formatRecords(step);
  const rpzReason = step?.response?.rpz_reason;

  // RPZ 命中：无论在 policy 节点还是后续返回，都优先展示命中原因
  if (rpzReason || step.level === 'policy' || (step.server || '').includes('rpz')) {
    const actionText = status === 'RPZ_CNAME' ? `重写为 ${records || '拦截页'}` : '阻断';
    const reasonText = rpzReason ? `，原因：${rpzReason}` : '';
    return `步骤 ${idx + 1}: 命中 RPZ 规则（${step.qname} ${step.qtype}），动作：${actionText}${reasonText}`;
  }

  if (step.server && step.server.includes('cache')) {
    return `步骤 ${idx + 1}: 检查本地缓存（${step.cache_hit ? '命中' : '未命中'}），记录: ${records}`;
  }

  if (step.level === 'client') {
    if (status === 'CACHE_MISS') {
      return `步骤 ${idx + 1}: ${role}检查缓存未命中，查询 "${step.qname}"`;
    }
    if (step.cache_hit) {
      return `步骤 ${idx + 1}: ${role}缓存命中，返回记录: ${records}`;
    }
    if (['TIMEOUT', 'SERVFAIL', 'POLLUTED', 'NXDOMAIN', 'RPZ_BLOCK'].includes(status)) {
      return `步骤 ${idx + 1}: ${role}返回错误 ${status}`;
    }
    return `步骤 ${idx + 1}: ${role}返回结果: ${records}`;
  }

  if (['TIMEOUT', 'SERVFAIL', 'POLLUTED', 'NXDOMAIN', 'RPZ_BLOCK'].includes(status)) {
    return `步骤 ${idx + 1}: ${roleWithServer}响应异常：${status}`;
  }

  return `步骤 ${idx + 1}: ${roleWithServer}收到查询 "${step.qname}"，返回: ${records}`;
}

function formatDetail(step, type) {
  const server = step.server;
  const status = summarizeResponse(step);
  const latency = step.latency_ms;
  const cache = step.cache_hit ? 'Yes' : 'No';
  const records = step.response.records ? step.response.records.join(', ') : 'None';
  const reason = step.response.rpz_reason;
  
  if (type === 'req') {
    return `📡 Request\nTarget: ${server}\nQuery: ${step.qname} (${step.qtype})`;
  } else {
    const reasonLine = reason ? `\nReason: ${reason}` : '';
    return `📨 Response\nFrom: ${server}\nStatus: ${status}\nLatency: ${latency}ms\nCache Hit: ${cache}\nRecords: ${records}${reasonLine}`;
  }
}

function buildGraphFromTrace(mode, trace) {
  const nodes = [];
  const edges = [];
  const pathEdgeIds = [];
  const nodeSet = new Set();

  function ensureNode(id, label, type, level) {
    if (nodeSet.has(id)) return;
    nodeSet.add(id);
    nodes.push({ data: { id, label, type, level } });
  }

  function addEdge(source, target, label, detail, edgeId) {
    const id = edgeId || `${source}->${target}`;
    edges.push({ data: { id, source, target, label, detail } });
    pathEdgeIds.push(id);
  }

  const normalizedMode = mode === 'iterative' ? 'iterative' : 'recursive';

  // 1. 初始化客户端
  ensureNode('client', '客户端', 'client', 'client');
  
  // 2. 初始化中间节点
  if (normalizedMode === 'recursive') {
    ensureNode('resolver', '本地服务器', 'resolver', 'resolver');
  }
  if (normalizedMode === 'iterative') {
    ensureNode('local-server', '本地服务器', 'resolver', 'local');
  }

  // 3. 构建路径
  const hasCacheHit = trace.some(step => 
    step.cache_hit || (step.server && step.server.includes('cache')) || (step.response && step.response.cache_hit)
  );
  
  const hasFullResolution = trace.some(step => 
    step.server && (step.server.includes('root') || step.server.includes('tld') || step.server.includes('auth'))
  );

  if (normalizedMode === 'iterative') {
    if (hasCacheHit && !hasFullResolution) {
      addEdge('client', 'local-server', 'Query', '客户端请求本地服务器', 'path-client-local');
      addEdge('local-server', 'client', 'Result', '缓存命中返回', 'path-local-client');
    } else {
      addEdge('client', 'local-server', 'Query', '客户端请求本地服务器', 'path-client-local');
      
      let serverSteps = trace.filter((step) => 
        ['root', 'tld', 'auth', 'local', 'policy'].includes(step.level) && !step.server.includes('cache')
      );
      
      let actualServerSteps = [];
      for (const step of serverSteps) {
        if (step.level === 'local' && step.server.startsWith('local->')) {
          const actualServer = step.server.substring(7);
          actualServerSteps.push({
            ...step,
            server: actualServer,
            level: step.server.includes('root') ? 'root' : step.server.includes('tld') ? 'tld' : 'auth'
          });
        } else {
          actualServerSteps.push(step);
        }
      }

      actualServerSteps.forEach((step) => {
        const serverId = `server:${step.server}`;
        if (!nodeSet.has(serverId)) {
          ensureNode(serverId, step.server, 'server', step.level);
        }
      });
      
      actualServerSteps.forEach((step, idx) => {
        const target = `server:${step.server}`;
        addEdge('local-server', target, `Q: ${step.qtype}`, formatDetail(step, 'req'), `path-${idx}-req`);
        addEdge(target, 'local-server', `R: ${summarizeResponse(step)}`, formatDetail(step, 'resp'), `path-${idx}-resp`);
      });
      
      addEdge('local-server', 'client', 'Result', '返回最终结果', 'path-local-client');
    }
  } else {
    // 递归模式
    let serverSteps = trace.filter((step) => ['root', 'tld', 'auth', 'local', 'policy'].includes(step.level));
    let actualServerSteps = [];
    for (const step of serverSteps) {
      if (step.level === 'local' && step.server.startsWith('local->')) {
        const actualServer = step.server.substring(7);
        actualServerSteps.push({
          ...step,
          server: actualServer,
          level: step.server.includes('root') ? 'root' : step.server.includes('tld') ? 'tld' : 'auth'
        });
      } else {
        actualServerSteps.push(step);
      }
    }

    actualServerSteps.forEach((step) => {
      const serverId = `server:${step.server}`;
      if (!nodeSet.has(serverId)) {
        ensureNode(serverId, step.server, 'server', step.level);
      }
    });

    addEdge('client', 'resolver', 'Query', 'Initial Query', 'path-client-resolver');

    if (actualServerSteps.length > 0) {
      const first = actualServerSteps[0];
      const firstId = `server:${first.server}`;
      addEdge('resolver', firstId, `Q: ${first.qtype}`, formatDetail(first, 'req'), `path-req-0`);

      for (let i = 0; i < actualServerSteps.length - 1; i++) {
        const from = `server:${actualServerSteps[i].server}`;
        const to = `server:${actualServerSteps[i + 1].server}`;
        const nextStep = actualServerSteps[i+1];
        addEdge(from, to, `Q: ${nextStep.qtype}`, formatDetail(nextStep, 'req'), `path-req-${i+1}`);
      }

      for (let i = actualServerSteps.length - 1; i >= 0; i--) {
        const from = `server:${actualServerSteps[i].server}`;
        const to = i > 0 ? `server:${actualServerSteps[i - 1].server}` : 'resolver';
        addEdge(from, to, summarizeResponse(actualServerSteps[i]), formatDetail(actualServerSteps[i], 'resp'), `path-resp-${i}`);
      }
    }
    addEdge('resolver', 'client', 'Result', 'Resolution Complete', 'path-resolver-client');
  }

  return { elements: [...nodes, ...edges], pathEdgeIds };
}

async function movePacket(sourceNodeId, targetNodeId, label, isError) {
  const sourceNode = cy.getElementById(sourceNodeId);
  const targetNode = cy.getElementById(targetNodeId);

  if (sourceNode.empty() || targetNode.empty()) return;

  // 必须获取 renderedPosition (屏幕坐标) 而不是 position (模型坐标)
  const p1 = sourceNode.renderedPosition();
  const p2 = targetNode.renderedPosition();

  // 获取容器相对于视口的偏移，防止 packet 错位
  const containerRect = document.getElementById('cy').getBoundingClientRect();
  
  // 计算相对于 graph-panel 的坐标
  const offsetX = containerRect.left;
  const offsetY = containerRect.top;

  // packet 是 fixed/absolute 定位于 graph-panel 内或 body 内
  // 如果 packet 是 absolute 于 .graph-panel (position: relative)，则直接使用 p1.x, p1.y
  // 这里假设 packet 是 absolute 于 .graph-panel
  
  const packetW = packetEl.offsetWidth || 60;
  const packetH = packetEl.offsetHeight || 28;

  packetEl.textContent = label;
  packetEl.className = ''; 
  
  if (label.includes('Q:') || label.includes('Query')) {
    packetEl.classList.add('packet-query');
  } else {
    packetEl.classList.add('packet-response');
  }
  if (isError) packetEl.classList.add('packet-error');

  packetEl.style.transition = 'none';
  packetEl.style.left = `${p1.x - packetW/2}px`;
  packetEl.style.top = `${p1.y - packetH/2}px`;
  packetEl.style.opacity = '1';
  packetEl.classList.remove('hidden');

  // 强制重绘
  void packetEl.offsetWidth;

  const duration = 600; 
  packetEl.style.transition = `top ${duration}ms ease-in-out, left ${duration}ms ease-in-out, opacity 0.2s`;
  
  packetEl.style.left = `${p2.x - packetW/2}px`;
  packetEl.style.top = `${p2.y - packetH/2}px`;

  await delay(duration);
}

async function animateResolution(mode, trace, isError) {
  if (packetHideTimer) clearTimeout(packetHideTimer);

  const built = buildGraphFromTrace(mode, trace);
  
  if (!cy) {
    initGraph(built.elements);
  } else {
    cy.elements().remove();
    cy.add(built.elements);
  }
  
  // 等待 DOM 渲染
  await delay(50);
  
  // --- 关键修改：动态响应式布局 ---
  if (mode === 'iterative') {
    const w = cy.width();
    const h = cy.height();
    const xLeft = w * 0.15;
    const xMid = w * 0.5;
    const xRight = w * 0.85;
    const yCenter = h / 2;

    const positions = {
      'client': { x: xLeft, y: yCenter },
      'local-server': { x: xMid, y: yCenter }
    };
    
    cy.nodes().forEach(node => {
      if (positions[node.id()]) node.position(positions[node.id()]);
    });
    
    const otherNodes = cy.nodes().filter(n => n.id() !== 'client' && n.id() !== 'local-server');
    const totalHeight = otherNodes.length * 100;
    const startY = Math.max(60, yCenter - totalHeight / 2); // 保证不顶格

    otherNodes.forEach((node, idx) => {
      node.position({ x: xRight, y: startY + idx * 100 });
    });
    
    cy.fit(40);
  } else {
    const layout = cy.layout({ 
      name: 'breadthfirst', directed: true, padding: 40, spacingFactor: 1.2, avoidOverlap: true 
    });
    layout.run();
  }
  
  await delay(300); // 等待布局稳定

  traceEl.innerHTML = '';
  const qname = trace[0]?.qname || '';
  if (qname) appendTraceLine(`开始: 查询域名 "${qname}"`);

  const traceItems = new Array(trace.length).fill(null);
  let lastTraceIdx = -1;

  // --- 关键修改：锁定交互 ---
  isAnimating = true;
  if(cy) {
    cy.userZoomingEnabled(false);
    cy.userPanningEnabled(false);
    cy.boxSelectionEnabled(false);
  }
  
  // 重置动画控制器，避免上一次 abort 后 signal 一直处于 aborted 状态
  animationController = new AbortController();
  const signal = animationController.signal;
  const edgeIds = built.pathEdgeIds;

  try {
    const ratio = traceItems.length > 0 ? edgeIds.length / traceItems.length : 1;

    for (let i = 0; i < edgeIds.length; i++) {
      if (signal.aborted) break;

      const edgeId = edgeIds[i];
      const edge = cy.getElementById(edgeId);
      
      if (edge && edge.length > 0) {
        const sourceId = edge.source().id();
        const targetId = edge.target().id();
        const label = edge.data('label');
        
        const isLastStep = i === edgeIds.length - 1;
        const errorOnThisStep = isError && isLastStep;

        await movePacket(sourceId, targetId, label, errorOnThisStep);

        if (errorOnThisStep) edge.addClass('highlight-error');
        else edge.addClass('highlight-success');
        
        edge.target().addClass('node-visited');

        const traceIdx = Math.min(Math.floor(i / ratio), traceItems.length - 1);
        if (traceIdx !== lastTraceIdx && trace[traceIdx]) {
          const message = formatTraceMessage(trace[traceIdx], traceIdx, mode);
          traceItems[traceIdx] = appendTraceLine(message);
          lastTraceIdx = traceIdx;
        }

        if (traceItems[traceIdx]) {
          traceItems.forEach(t => t && t.classList.remove('active'));
          traceItems[traceIdx].classList.add('active');
          if (errorOnThisStep) traceItems[traceIdx].classList.add('error');
          traceItems[traceIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        await delay(200);
      }
    }
  } catch (err) {
    console.log("Animation interrupted", err);
  } finally {
    // --- 恢复交互 ---
    isAnimating = false;
    if(cy) {
      cy.userZoomingEnabled(true);
      cy.userPanningEnabled(true);
      cy.boxSelectionEnabled(true);
    }
    packetEl.style.opacity = '0';
    packetHideTimer = setTimeout(() => packetEl.classList.add('hidden'), 300);
  }

  if (trace.length > 0) {
    const finalStep = trace[trace.length - 1];
    const finalStatus = summarizeResponse(finalStep);
    const finalRecords = formatRecords(finalStep);
    if (['TIMEOUT', 'SERVFAIL', 'POLLUTED', 'NXDOMAIN'].includes(finalStatus)) {
      appendTraceLine(`完成: 解析失败，状态 ${finalStatus}`);
    } else {
      appendTraceLine(`完成: 客户端收到结果 ${finalRecords}`);
    }
  }
}

function renderStats(stats, result, qtype) {
  statsEl.innerHTML = '';

  let resultDisplay = '';
  if (result && result.records && result.records.length > 0) {
    resultDisplay = `<div style="grid-column: span 2; background: #e6f7ff; color: #0050b3; border-color: #91d5ff;">
      📝 解析结果: ${result.records.join(', ')}
    </div>`;
  } else {
    resultDisplay = `<div style="grid-column: span 2; color: #999;">无解析记录</div>`;
  }

  const statusClass = stats.is_error ? 'color: #ff4d4f' : 'color: #52c41a';

  statsEl.innerHTML = `
    ${resultDisplay}
    <div>状态 <br><strong style="${statusClass}">${stats.status || 'UNKNOWN'}</strong></div>
    <div>总耗时 <br><strong>${stats.total_time_ms} ms</strong></div>
    <div>命中率 <br><strong>${(stats.hit_rate * 100).toFixed(0)}%</strong></div>
    <div>失败率 <br><strong>${(stats.failure_rate * 100).toFixed(0)}%</strong></div>
  `;
}

function renderAI(text) {
  if (window.marked && typeof window.marked.parse === 'function') {
    aiEl.innerHTML = window.marked.parse(text || '');
  } else {
    aiEl.textContent = text;
  }
}

function renderRiskTrend(trend, recent = []) {
  if (!trend || !Array.isArray(trend.failure_rates) || trend.failure_rates.length === 0) {
    riskTrendEl.textContent = '尚无趋势数据';
    return;
  }

  const bars = trend.failure_rates.map((val, idx) => {
    const pct = Math.min(100, Math.round(val * 100));
    const status = (trend.statuses && trend.statuses[idx]) || (recent[idx]?.stats?.status) || '';
    let cls = 'ok';
    if (status === 'POLLUTED') cls = 'polluted';
    else if (status && status !== 'OK') cls = 'error';
    const height = 12 + pct * 0.6;
    return `<div class="risk-bar ${cls}" style="height:${height}px" title="Step ${idx + 1}: fail ${pct}%, status ${status}"></div>`;
  }).join('');

  riskTrendEl.innerHTML = `<div class="risk-trend-bars">${bars}</div>`;
}

function renderRiskPrediction(payload) {
  if (!payload || !payload.prediction) {
    riskSummaryEl.textContent = '等待数据...';
    riskTrendEl.textContent = '';
    return;
  }
  const { prediction, recent } = payload;
  const failurePct = ((prediction.predicted_failure_rate || 0) * 100).toFixed(0);
  const pollutionPct = ((prediction.predicted_pollution_rate || 0) * 100).toFixed(0);
  const basis = prediction.basis || 'N/A';

  riskSummaryEl.innerHTML = `
    <div class="risk-grid">
      <div>
        <div class="risk-label">预测失败率</div>
        <div class="risk-value danger">${failurePct}%</div>
      </div>
      <div>
        <div class="risk-label">预测污染概率</div>
        <div class="risk-value warn">${pollutionPct}%</div>
      </div>
      <div class="risk-basis">依据：${basis}</div>
    </div>
  `;

  renderRiskTrend(prediction.trend, recent);
}

async function fetchRiskPrediction(n = 12) {
  if (!riskSummaryEl || !riskTrendEl) return;
  try {
    const res = await fetch(`/ai/predict?n=${n}`);
    const data = await res.json();
    renderRiskPrediction(data);
  } catch (err) {
    riskSummaryEl.textContent = `风险预测失败: ${err.message}`;
  }
}

function appendTraceLine(text) {
  const p = document.createElement('div');
  p.className = 'trace-line';
  p.textContent = text;
  traceEl.appendChild(p);
  return p;
}

function setLoading(isLoading) {
  if (isLoading) {
    if (packetHideTimer) clearTimeout(packetHideTimer);
    resolveBtn.disabled = true;
    resolveBtn.innerHTML = '<span class="btn-text">解析中...</span>';
    loadingMask.classList.remove('hidden');
    if (isAnimating) {
      animationController.abort();
      packetEl.classList.add('hidden');
    }
  } else {
    resolveBtn.disabled = false;
    resolveBtn.innerHTML = '<span class="btn-text">开始解析</span>';
    loadingMask.classList.add('hidden');
  }
}

async function resolve() {
  const domain = document.getElementById('domain').value.trim();
  const qtype = document.getElementById('qtype').value;
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const scenarios = {
    pollution: document.getElementById('pollution').checked,
    failure: document.getElementById('failure').checked,
    lb: document.getElementById('lb').checked,
  };

  if(!domain) {
    alert("请输入域名");
    return;
  }

  setLoading(true);

  try {
    const [res] = await Promise.all([
      fetch('/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, qtype, mode, scenarios }),
      }),
      delay(600) // 最小 Loading 时间，防止闪烁
    ]);

    const data = await res.json();
    const renderMode = data.mode || mode;

    const status = (data.stats && data.stats.status) || 'UNKNOWN';
    const isError = (data.stats && data.stats.is_error) || ['POLLUTED', 'TIMEOUT', 'SERVFAIL', 'NXDOMAIN', 'RPZ_BLOCK'].includes(status);

    setLoading(false);

    renderStats(data.stats, data.result, qtype);
    renderAI('等待查询...');

    await animateResolution(renderMode, data.trace, isError);
    
    lastContext = {
      domain, qtype, mode: renderMode, scenarios, stats: data.stats, result: data.result, trace: data.trace,
    };

    fetchRiskPrediction();

  } catch (err) {
    console.error(err);
    setLoading(false);
    // --- 关键修改：优雅错误展示 ---
    statsEl.innerHTML = `
      <div style="grid-column: span 2; background: #fff1f0; border: 1px solid #ffa39e; padding: 10px; border-radius: 6px; color: #cf1322;">
        <strong>请求失败</strong>: 无法连接到服务器。<br>
        <small style="opacity:0.8">${err.message}</small>
      </div>
    `;
  }
}

async function askAI() {
  if (!lastContext) {
    renderAI('请先点击“开始解析”获得查询数据。');
    return;
  }

  const question = (aiQuestionInput.value || '').trim() || '请结合以上查询信息给出简要建议。';
  renderAI('AI 正在分析网络链路...');
  askAiBtn.disabled = true;

  try {
    const res = await fetch('/ai/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...lastContext, question }),
    });
    const data = await res.json();
    renderAI(data.text || data.ai_advice || 'AI 暂无回应。');
  } catch (err) {
    renderAI(`AI 请求失败: ${err.message}`);
  } finally {
    askAiBtn.disabled = false;
  }
}

resolveBtn.addEventListener('click', resolve);
askAiBtn.addEventListener('click', askAI);
refreshRiskBtn.addEventListener('click', () => fetchRiskPrediction());
// 支持回车查询
document.getElementById('domain').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') resolve();
});

// 页面初始化时尝试拉取一次预测基线
fetchRiskPrediction();
