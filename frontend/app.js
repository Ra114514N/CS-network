const resolveBtn = document.getElementById('resolve');
const traceEl = document.getElementById('trace');
const statsEl = document.getElementById('stats');
const aiEl = document.getElementById('ai');
const askAiBtn = document.getElementById('ask-ai');
const aiQuestionInput = document.getElementById('ai-question');
const loadingMask = document.getElementById('loading-mask');
const tooltipEl = document.getElementById('graph-tooltip');
const packetEl = document.getElementById('packet');

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
          width: 120,  // 加宽节点，模仿 demo.html
          height: 40,
          'transition-property': 'background-color, border-color, border-width, width, height',
          'transition-duration': '0.3s',
          'shadow-blur': 4,
          'shadow-color': 'rgba(0,0,0,0.1)',
          'shadow-offset-x': 1,
          'shadow-offset-y': 1
        },
      },
      // --- 角色特定样式 (仿 demo.html) ---
      {
        selector: 'node[type="client"]',
        style: {
          'background-color': '#e7f3fe', // 浅蓝
          'border-color': '#b0c4de'
        }
      },
      {
        selector: 'node[type="resolver"]',
        style: {
          'background-color': '#fffacd', // 柠檬黄 (递归 DNS)
          'border-color': '#e0d8a0'
        }
      },
      {
        selector: 'node[id="local-server"]',
        style: {
          'background-color': '#ffebcd', // 米色 (本地服务器)
          'border-color': '#d8c7a9',
          'border-width': 2,
          'font-size': 13
        }
      },
      {
        selector: 'node[level="root"]',
        style: {
          'background-color': '#f0e68c', // 卡其色 (根 DNS)
          'border-color': '#d0c66c'
        }
      },
      {
        selector: 'node[level="tld"]',
        style: {
          'background-color': '#d2fbd2', // 浅绿 (TLD DNS)
          'border-color': '#a0d8a0'
        }
      },
      {
        selector: 'node[level="auth"]',
        style: {
          'background-color': '#add8e6', // 蓝色 (权威 DNS)
          'border-color': '#80b8c6'
        }
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
      // --- 交互与动画高亮 ---
      {
        selector: 'edge.hovered',
        style: {
          width: 3,
          'line-color': '#1890ff',
          'target-arrow-color': '#1890ff',
          color: '#1890ff',
          'font-weight': 'bold',
          'z-index': 1000,
          'opacity': 1
        }
      },
      {
        selector: '.highlight-success',
        style: {
          'line-color': '#52c41a',
          'target-arrow-color': '#52c41a',
          'opacity': 1,
          width: 2,
          color: '#333'
        },
      },
      {
        selector: '.highlight-error',
        style: {
          'line-color': '#ff4d4f',
          'target-arrow-color': '#ff4d4f',
          'opacity': 1,
          width: 2,
          color: '#ff4d4f'
        },
      },
      {
        selector: '.node-visited',
        style: {
          'border-width': 2,
          'border-style': 'solid', // 确保边框实线
        }
      }
    ],
    // 使用 dagre 布局或者 breadthfirst，breadthfirst 对层级展示较好
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
    const edge = evt.target;
    edge.removeClass('hovered');
    hideTooltip();
  });
  
  cy.on('resize', () => {
    if(!isAnimating) packetEl.classList.add('hidden');
  });
}

function showTooltip(pos, text) {
  tooltipEl.textContent = text;
  tooltipEl.style.left = `${pos.x}px`;
  tooltipEl.style.top = `${pos.y - 10}px`;
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

function formatDetail(step, type) {
  const server = step.server;
  const status = summarizeResponse(step);
  const latency = step.latency_ms;
  const cache = step.cache_hit ? 'Yes' : 'No';
  const records = step.response.records ? step.response.records.join(', ') : 'None';
  
  if (type === 'req') {
    return `📡 Request\nTarget: ${server}\nQuery: ${step.qname} (${step.qtype})`;
  } else {
    return `📨 Response\nFrom: ${server}\nStatus: ${status}\nLatency: ${latency}ms\nCache Hit: ${cache}\nRecords: ${records}`;
  }
}

function labelForRecursiveServer(step) {
  // 直接返回实际的服务器名称，不添加额外的标识
  return step.server;
}

function buildGraphFromTrace(mode, trace) {
  const nodes = [];
  const edges = [];
  const pathEdgeIds = [];
  const nodeSet = new Set();
  const qname = trace[0]?.qname || '';
  const qtype = trace[0]?.qtype || '';

  // 增加 level 参数，用于样式匹配
  function ensureNode(id, label, type, level) {
    if (nodeSet.has(id)) return;
    nodeSet.add(id);
    // data 里的 type 用于区分 client/resolver/server/local
    // data 里的 level 用于区分 root/tld/auth/local
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
  
  // 2. 初始化本地服务器 (仅递归模式)
  if (normalizedMode === 'recursive') {
    ensureNode('resolver', '本地服务器', 'resolver', 'resolver');
  }
  
  // 3. 初始化本地服务器 (仅迭代模式)
  if (normalizedMode === 'iterative') {
    ensureNode('local-server', '本地服务器', 'resolver', 'local');
  }

  // 4. 检查是否有缓存命中
  const hasCacheHit = trace.some(step => 
    step.cache_hit || 
    (step.server && step.server.includes('cache')) ||
    (step.response && step.response.cache_hit)
  );
  
  // 5. 检查是否有完整的解析步骤（Root/TLD/Auth）
  const hasFullResolution = trace.some(step => 
    step.server && (step.server.includes('root') || step.server.includes('tld') || step.server.includes('auth'))
  );

  if (normalizedMode === 'iterative') {
    if (hasCacheHit && !hasFullResolution) {
      // 缓存命中：只显示客户端和本地服务器之间的通信
      // 客户端 -> 本地服务器
      addEdge('client', 'local-server', 'Query', '客户端请求本地服务器', 'path-client-local');
      
      // 本地服务器 -> 客户端
      addEdge('local-server', 'client', 'Result', '本地服务器返回结果（缓存命中）', 'path-local-client');
    } else {
      // 缓存未命中：显示完整的解析路径
      // 客户端 -> 本地服务器
      addEdge('client', 'local-server', 'Query', '客户端请求本地服务器', 'path-client-local');
      
      // 过滤服务器步骤，包括 root/tld/auth/local，并排除cache相关步骤
      let serverSteps = trace.filter((step) => 
        ['root', 'tld', 'auth', 'local'].includes(step.level) && 
        !step.server.includes('cache')
      );
      
      // 处理本地服务器的子步骤
      let actualServerSteps = [];
      for (const step of serverSteps) {
        if (step.level === 'local' && step.server.startsWith('local->')) {
          // 提取实际服务器信息
          const actualServer = step.server.substring(7);
          actualServerSteps.push({
            ...step,
            server: actualServer,
            level: step.server.includes('root') ? 'root' : 
                   step.server.includes('tld') ? 'tld' : 'auth'
          });
        } else {
          actualServerSteps.push(step);
        }
      }

      // 初始化各级服务器节点
      actualServerSteps.forEach((step) => {
        const serverId = `server:${step.server}`;
        if (!nodeSet.has(serverId)) {
          const label = normalizedMode === 'recursive' ? labelForRecursiveServer(step) : step.server;
          // 传入 step.level ('root', 'tld', 'auth') 以应用不同颜色
          ensureNode(serverId, label, 'server', step.level);
        }
      });
      
      // 本地服务器 -> 各级服务器 -> 本地服务器
      actualServerSteps.forEach((step, idx) => {
        const target = `server:${step.server}`;
        const labelReq = `Q: ${step.qtype}`;
        const labelResp = `R: ${summarizeResponse(step)}`;
        
        const detailReq = formatDetail(step, 'req');
        const detailResp = formatDetail(step, 'resp');

        // 本地服务器 -> 目标服务器
        addEdge('local-server', target, labelReq, detailReq, `path-${idx}-req`);
        // 目标服务器 -> 本地服务器
        addEdge(target, 'local-server', labelResp, detailResp, `path-${idx}-resp`);
      });
      
      // 本地服务器 -> 客户端
      addEdge('local-server', 'client', 'Result', '本地服务器返回结果', 'path-local-client');
    }
  } else {
    // 递归模式：保持原有逻辑
    // 过滤服务器步骤，包括 root/tld/auth/local
    let serverSteps = trace.filter((step) => ['root', 'tld', 'auth', 'local'].includes(step.level));
    
    // 处理本地服务器的子步骤
    let actualServerSteps = [];
    for (const step of serverSteps) {
      if (step.level === 'local' && step.server.startsWith('local->')) {
        // 提取实际服务器信息
        const actualServer = step.server.substring(7);
        actualServerSteps.push({
          ...step,
          server: actualServer,
          level: step.server.includes('root') ? 'root' : 
                 step.server.includes('tld') ? 'tld' : 'auth'
        });
      } else {
        actualServerSteps.push(step);
      }
    }

    // 初始化各级服务器节点
    actualServerSteps.forEach((step) => {
      const serverId = `server:${step.server}`;
      if (!nodeSet.has(serverId)) {
        const label = normalizedMode === 'recursive' ? labelForRecursiveServer(step) : step.server;
        // 传入 step.level ('root', 'tld', 'auth') 以应用不同颜色
        ensureNode(serverId, label, 'server', step.level);
      }
    });

    // Recursive Mode (保持不变)
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
        const status = summarizeResponse(actualServerSteps[i]);
        addEdge(from, to, status, formatDetail(actualServerSteps[i], 'resp'), `path-resp-${i}`);
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

  const p1 = sourceNode.renderedPosition();
  const p2 = targetNode.renderedPosition();

  const offsetX = packetEl.offsetWidth / 2;
  const offsetY = packetEl.offsetHeight / 2;

  packetEl.textContent = label;
  packetEl.className = ''; 
  
  if (label.includes('Q:') || label.includes('Query')) {
    packetEl.classList.add('packet-query');
  } else {
    packetEl.classList.add('packet-response');
  }
  if (isError) packetEl.classList.add('packet-error');

  packetEl.style.transition = 'none';
  packetEl.style.left = `${p1.x - offsetX}px`;
  packetEl.style.top = `${p1.y - offsetY}px`;
  packetEl.style.opacity = '1';
  packetEl.classList.remove('hidden');

  void packetEl.offsetWidth;

  const duration = 800; 
  packetEl.style.transition = `top ${duration}ms ease-in-out, left ${duration}ms ease-in-out, opacity 0.2s`;
  
  packetEl.style.left = `${p2.x - offsetX}px`;
  packetEl.style.top = `${p2.y - offsetY}px`;

  await delay(duration);
}

async function animateResolution(mode, trace, isError) {
  if (packetHideTimer) {
    clearTimeout(packetHideTimer);
    packetHideTimer = null;
  }

  const built = buildGraphFromTrace(mode, trace);
  const elements = built.elements;
  
  if (!cy) {
    initGraph(elements);
  } else {
    cy.elements().remove();
    cy.add(elements);
  }
  
  // 等待图形初始化完成
  await delay(100);
  
  if (mode === 'iterative') {
    // 迭代模式：自定义布局，分成左中右三部分
    
    // 固定位置坐标
    const positions = {
      'client': { x: 100, y: 250 },       // 左侧：客户端
      'local-server': { x: 300, y: 250 }  // 中间：本地服务器
    };
    
    // 设置客户端和本地服务器的位置
    cy.nodes().forEach(node => {
      const id = node.id();
      if (positions[id]) {
        node.position(positions[id]);
      }
    });
    
    // 处理其他服务器节点（右部分）
    const otherNodes = cy.nodes().filter(node => 
      node.id() !== 'client' && node.id() !== 'local-server'
    );
    
    // 按查询顺序排列右侧服务器节点
    const serverOrder = ['root-server', 'a.gtld-servers.net', 'ns1.example.com'];
    
    otherNodes.forEach((node, idx) => {
      // 找到节点在查询顺序中的位置
      const serverName = node.data('label').replace(/\n.*$/, '');
      let orderIdx = serverOrder.indexOf(serverName);
      if (orderIdx === -1) orderIdx = idx;
      
      // 设置右侧位置，从上往下排列
      node.position({
        x: 600,  // 右侧固定X坐标
        y: 100 + orderIdx * 120  // 从上往下排列，间距120px
      });
    });
    
    // 调整视图以适应所有节点
    cy.fit(50);
  } else {
    // 递归模式：保持原有布局
    const layout = { 
      name: 'breadthfirst', 
      directed: true, 
      padding: 40, 
      spacingFactor: 1.3, 
      avoidOverlap: true 
    };
    
    const layoutInstance = cy.layout(layout);
    const layoutDone = new Promise(resolve => layoutInstance.one('layoutstop', resolve));
    layoutInstance.run();
    await layoutDone;
  }
  
  await delay(200);

  traceEl.innerHTML = '';
  const traceItems = trace.map((step, idx) => {
    const div = document.createElement('div');
    div.className = 'trace-line';
    const response = step.response.status || JSON.stringify(step.response);
    div.textContent = `${idx + 1}. ${step.level}@${step.server} | ${step.qname} -> ${response} (${step.latency_ms}ms)`;
    traceEl.appendChild(div);
    return div;
  });

  isAnimating = true;
  animationController = new AbortController();
  const signal = animationController.signal;
  const edgeIds = built.pathEdgeIds;

  packetEl.classList.add('hidden');
  packetEl.style.opacity = '0';

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

        if (errorOnThisStep) {
            edge.addClass('highlight-error');
        } else {
            edge.addClass('highlight-success');
        }
        
        edge.target().addClass('node-visited');

        const traceIdx = Math.min(Math.floor(i / ratio), traceItems.length - 1);
        if (traceItems[traceIdx]) {
          traceItems.forEach(t => t.classList.remove('active'));
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
    isAnimating = false;
    packetEl.style.opacity = '0';
    packetHideTimer = setTimeout(() => packetEl.classList.add('hidden'), 300);
  }
}

function renderStats(stats, result, qtype) {
  statsEl.innerHTML = '';

  let resultDisplay = '';
  if (result && result.records && result.records.length > 0) {
    resultDisplay = `<div style="margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1px solid #eee;">
      <strong>解析结果 (${qtype}):</strong><br>
      <span style="color: #1890ff; font-weight: bold; font-size: 1.1em;">${result.records.join('<br>')}</span>
    </div>`;
  } else {
    resultDisplay = `<div style="margin-bottom: 10px; color: #999;">解析结果: (无数据)</div>`;
  }

  const statusClass = stats.is_error ? 'color: #ff4d4f' : 'color: #52c41a';

  statsEl.innerHTML = `
    ${resultDisplay}
    <div>状态: <strong style="${statusClass}">${stats.status || 'UNKNOWN'}</strong></div>
    <div>命中率: ${(stats.hit_rate * 100).toFixed(0)}%</div>
    <div>总耗时: ${stats.total_time_ms} ms</div>
    <div>失败率: ${(stats.failure_rate * 100).toFixed(0)}%</div>
  `;
}

function renderAI(text) {
  aiEl.textContent = text;
}

function setLoading(isLoading) {
  if (isLoading) {
    if (packetHideTimer) {
      clearTimeout(packetHideTimer);
      packetHideTimer = null;
    }
    
    resolveBtn.disabled = true;
    resolveBtn.innerHTML = '<span class="btn-text">解析中...</span>';
    loadingMask.classList.remove('hidden');
    
    if (isAnimating) {
      animationController.abort();
      packetEl.classList.add('hidden');
    }
  } else {
    resolveBtn.disabled = false;
    resolveBtn.innerHTML = '<span class="btn-text">解析</span>';
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

  setLoading(true);

  try {
    const [res] = await Promise.all([
      fetch('/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, qtype, mode, scenarios }),
      }),
      delay(800)
    ]);

    const data = await res.json();
    const renderMode = data.mode || mode;

    const status = (data.stats && data.stats.status) || 'UNKNOWN';
    const isError =
      (data.stats && data.stats.is_error) ||
      (data.stats && data.stats.failure_rate > 0) ||
      ['POLLUTED', 'TIMEOUT', 'SERVFAIL', 'NXDOMAIN'].includes(status);

    setLoading(false);

    renderStats(data.stats, data.result, qtype);
    renderAI('AI 未查询，点击"询问 AI"按钮后获取建议。');

    await animateResolution(renderMode, data.trace, isError);
    
    lastContext = {
      domain,
      qtype,
      mode: renderMode,
      scenarios,
      stats: data.stats,
      result: data.result,
      trace: data.trace,
    };

  } catch (err) {
    console.error(err);
    setLoading(false);
    alert('请求失败，请检查后端服务是否启动');
  }
}

async function askAI() {
  if (!lastContext) {
    renderAI('请先点击“解析”获得最新的查询上下文。');
    return;
  }

  const question = (aiQuestionInput.value || '').trim() || '请结合以上查询信息给出简要建议。';
  renderAI('AI 正在分析中…');
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