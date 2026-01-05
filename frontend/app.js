const resolveBtn = document.getElementById('resolve');
const traceEl = document.getElementById('trace');
const statsEl = document.getElementById('stats');
const aiEl = document.getElementById('ai');
const askAiBtn = document.getElementById('ask-ai');
const aiQuestionInput = document.getElementById('ai-question');

let cy = null;
let lastContext = null;
let drawTimers = [];

function initGraph(elements) {
  cy = cytoscape({
    container: document.getElementById('cy'),
    elements,
    style: [
      {
        selector: 'node',
        style: {
          'background-color': '#ffffff',
          'border-color': '#333333',
          'border-width': 1,
          shape: 'roundrectangle',
          color: '#000000',
          label: 'data(label)',
          'text-wrap': 'wrap',
          'text-max-width': 80,
          'font-size': 10,
          'text-valign': 'center',
          'text-halign': 'center',
        },
      },
      {
        selector: 'edge',
        style: {
          width: 2,
          'line-color': '#a0a0a0',
          'target-arrow-color': '#a0a0a0',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          label: 'data(label)',
          color: '#3a3a3a',
          'font-size': 9,
          'text-rotation': 'autorotate',
          'text-margin-y': -6,
        },
      },
      {
        selector: '.highlight',
        style: {
          'background-color': '#ffb347',
          'line-color': '#ffb347',
          'target-arrow-color': '#ffb347',
        },
      },
      {
        selector: '.path-edge-success',
        style: {
          'line-color': '#52c41a',
          'target-arrow-color': '#52c41a',
          width: 3,
        },
      },
      {
        selector: '.path-edge-error',
        style: {
          'line-color': '#ff4d4f',
          'target-arrow-color': '#ff4d4f',
          width: 3,
        },
      },
    ],
    layout: { name: 'breadthfirst', directed: true, padding: 10 },
  });
}

function summarizeResponse(step) {
  if (!step || !step.response) {
    return 'NO_RESPONSE';
  }
  if (typeof step.response === 'string') {
    return step.response;
  }
  return step.response.status || 'UNKNOWN';
}

function labelForRecursiveServer(step) {
  const qname = step.qname || '';
  const parts = qname.split('.').filter(Boolean);
  if (step.level === 'root') {
    return 'root';
  }
  if (step.level === 'tld') {
    return parts.length ? parts[parts.length - 1] : step.server;
  }
  if (step.level === 'auth') {
    return parts.length >= 2 ? `${parts[parts.length - 2]}.${parts[parts.length - 1]}` : step.server;
  }
  return step.server;
}

function buildGraphFromTrace(mode, trace) {
  const nodes = [];
  const edges = [];
  const pathEdgeIds = [];
  const nodeSet = new Set();
  const qname = trace[0]?.qname || '';
  const qtype = trace[0]?.qtype || '';

  function ensureNode(id, label, kind) {
    if (nodeSet.has(id)) {
      return;
    }
    nodeSet.add(id);
    nodes.push({ data: { id, label, kind } });
  }

  function addEdge(source, target, label, edgeId) {
    const id = edgeId || `${source}->${target}`;
    edges.push({ data: { id, source, target, label } });
    pathEdgeIds.push(id);
  }

  const normalizedMode = mode === 'iterative' ? 'iterative' : 'recursive';

  ensureNode('client', 'client', 'client');
  if (normalizedMode === 'recursive') {
    const qnameLabel = qname || 'resolver';
    ensureNode('resolver', qnameLabel, 'resolver');
    ensureNode('client', qnameLabel, 'client');
  }

  let serverSteps = trace.filter((step) => ['root', 'tld', 'auth'].includes(step.level));
  if (serverSteps.length === 0 && qname) {
    const finalStatus = summarizeResponse(trace[0]);
    serverSteps = [
      {
        server: 'root-server',
        level: 'root',
        qname,
        qtype,
        response: { status: 'OK' },
        latency_ms: 0,
        cache_hit: false,
      },
      {
        server: 'a.gtld-servers.net',
        level: 'tld',
        qname,
        qtype,
        response: { status: 'OK' },
        latency_ms: 0,
        cache_hit: false,
      },
      {
        server: 'ns1.example.com',
        level: 'auth',
        qname,
        qtype,
        response: { status: finalStatus },
        latency_ms: 0,
        cache_hit: false,
      },
    ];
  }

  const serverIds = [];
  serverSteps.forEach((step) => {
    const serverId = `server:${step.server}`;
    if (!serverIds.includes(serverId)) {
      serverIds.push(serverId);
      const label = normalizedMode === 'recursive' ? labelForRecursiveServer(step) : step.server;
      ensureNode(serverId, label, 'server');
    }
  });

  if (normalizedMode === 'iterative') {
    serverSteps.forEach((step, idx) => {
      const target = `server:${step.server}`;
      const label = `${step.qtype} ${summarizeResponse(step)} ${step.latency_ms}ms cache:${step.cache_hit}`;
      addEdge('client', target, label, `path-${idx}-client-${target}`);
      addEdge(target, 'client', 'Response', `path-${idx}-${target}-client`);
    });
  } else {
    addEdge('client', 'resolver', 'Recursive Query', 'path-client-resolver');

    // 按照图示的真实递归往返顺序：
    // client -> resolver -> root -> tld -> auth -> tld -> root -> resolver -> client
    if (serverSteps.length > 0) {
      // 请求链路：resolver -> root -> tld -> auth
      const first = serverSteps[0];
      const firstId = `server:${first.server}`;
      const labelFirst = `${first.qtype} ${summarizeResponse(first)} ${first.latency_ms}ms cache:${first.cache_hit}`;
      addEdge('resolver', firstId, labelFirst, `path-req-0-resolver-${first.server}`);

      for (let i = 0; i < serverSteps.length - 1; i++) {
        const from = `server:${serverSteps[i].server}`;
        const to = `server:${serverSteps[i + 1].server}`;
        const next = serverSteps[i + 1];
        const label = `${next.qtype} ${summarizeResponse(next)} ${next.latency_ms}ms cache:${next.cache_hit}`;
        addEdge(from, to, label, `path-req-${i + 1}-${serverSteps[i].server}-${serverSteps[i + 1].server}`);
      }

      // 响应链路：auth -> tld -> root -> resolver
      for (let i = serverSteps.length - 1; i >= 0; i--) {
        const from = `server:${serverSteps[i].server}`;
        const to = i > 0 ? `server:${serverSteps[i - 1].server}` : 'resolver';
        const idSafeTo = to.replace(/[:.]/g, '-');
        addEdge(from, to, 'Response', `path-resp-${i}-${serverSteps[i].server}-${idSafeTo}`);
      }
    }

    // 最终 resolver -> client 的返回
    addEdge('resolver', 'client', 'Response', 'path-resolver-client');
  }

  return { elements: [...nodes, ...edges], pathEdgeIds };
}

function updateGraph(mode, trace, isError) {
  const built = buildGraphFromTrace(mode, trace);
  const elements = built.elements;
  const layout =
    mode === 'iterative'
      ? { name: 'circle', padding: 20, avoidOverlap: true }
      : { name: 'breadthfirst', directed: true, padding: 10 };
  if (!cy) {
    initGraph(elements);
  } else {
    // 清理上一次的图和定时器
    drawTimers.forEach((t) => clearTimeout(t));
    drawTimers = [];

    cy.elements().remove();
    cy.add(elements);
    cy.layout(layout).run();
  }

  const pathClass = isError ? 'path-edge-error' : 'path-edge-success';

  // 先移除所有路径边（我们将逐个绘制它们）
  built.pathEdgeIds.forEach((edgeId) => {
    const edge = cy.getElementById(edgeId);
    if (edge) edge.remove();
  });

  // 按顺序每隔2秒添加一个路径边，并应用样式
  built.pathEdgeIds.forEach((edgeId, idx) => {
    const edgeData = elements.find((el) => el.data && el.data.id === edgeId);
    if (!edgeData) return;
    const timer = setTimeout(() => {
      cy.add(edgeData);
      const e = cy.getElementById(edgeId);
      if (e) {
        e.removeClass('path-edge-success path-edge-error');
        e.addClass(pathClass);
      }
      // 可选：重新布局以平滑显示（如果不需要可注释）
      try {
        cy.layout(layout).run();
      } catch (err) {
        // ignore layout errors
      }
    }, idx * 2000);
    drawTimers.push(timer);
  });
}

function renderTrace(trace) {
  traceEl.innerHTML = '';
  trace.forEach((step, idx) => {
    const line = document.createElement('div');
    line.className = 'trace-line';
    const response = step.response.status || JSON.stringify(step.response);
    line.textContent = `${idx + 1}. ${step.level}@${step.server} | ${step.qname} ${step.qtype} | ${response} | ${step.latency_ms}ms | cache:${step.cache_hit} | ttl:${step.remaining_ttl}`;
    traceEl.appendChild(line);
  });
}

function formatResultTitle(qtype) {
  if (qtype === 'NS') {
    return '解析结果 NS:';
  }
  if (qtype === 'DNAME') {
    return '解析结果 DNAME:';
  }
  if (qtype === 'CNAME') {
    return '解析结果 CNAME:';
  }
  return '解析结果 IP:';
}

function renderStats(stats, result, qtype) {
  statsEl.innerHTML = '';

  let resultDisplay = '';
  if (result && result.records && result.records.length > 0) {
    const title = formatResultTitle(qtype);
    resultDisplay = `<div style="margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1px solid #eee;">
      <strong>${title}</strong><br>
      <span style="color: #1890ff; font-weight: bold; font-size: 1.1em;">${result.records.join('<br>')}</span>
    </div>`;
  } else {
    resultDisplay = `<div style="margin-bottom: 10px; color: #999;">解析结果: (无数据)</div>`;
  }

  statsEl.innerHTML = `
    ${resultDisplay}
    <div>状态: <strong>${stats.status || 'UNKNOWN'}</strong></div>
    <div>命中率: ${stats.hit_rate}</div>
    <div>总耗时: ${stats.total_time_ms} ms</div>
    <div>失败率: ${stats.failure_rate}</div>
  `;
}

function renderAI(text) {
  aiEl.textContent = text;
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

  const res = await fetch('/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, qtype, mode, scenarios }),
  });

  const data = await res.json();
  const renderMode = data.mode || mode;

  const status = (data.stats && data.stats.status) || 'UNKNOWN';
  const isError =
    (data.stats && data.stats.is_error) ||
    (data.stats && data.stats.failure_rate > 0) ||
    ['POLLUTED', 'TIMEOUT', 'SERVFAIL', 'NXDOMAIN'].includes(status);

  console.log('解析结果:', status, '是否标记为错误?', isError);

  updateGraph(renderMode, data.trace, isError);
  renderTrace(data.trace);
  renderStats(data.stats, data.result, qtype);
  renderAI('AI 未查询，点击"询问 AI"按钮后获取建议。');

  lastContext = {
    domain,
    qtype,
    mode: renderMode,
    scenarios,
    stats: data.stats,
    result: data.result,
    trace: data.trace,
  };
}

async function askAI() {
  if (!lastContext) {
    renderAI('请先点击“解析”获得最新的查询上下文。');
    return;
  }

  const question = (aiQuestionInput.value || '').trim() || '请结合以上查询信息给出简要建议。';
  renderAI('AI 正在分析中…');

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
  }
}

resolveBtn.addEventListener('click', resolve);
askAiBtn.addEventListener('click', askAI);
window.addEventListener('load', resolve);
