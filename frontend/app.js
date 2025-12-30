const resolveBtn = document.getElementById('resolve');
const traceEl = document.getElementById('trace');
const statsEl = document.getElementById('stats');
const aiEl = document.getElementById('ai');

let cy = null;

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
        selector: '.path-edge',
        style: {
          'line-color': '#ff6f3c',
          'target-arrow-color': '#ff6f3c',
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

    let prev = 'resolver';
    serverSteps.forEach((step, idx) => {
      const target = `server:${step.server}`;
      const label = `${step.qtype} ${summarizeResponse(step)} ${step.latency_ms}ms cache:${step.cache_hit}`;
      addEdge(prev, target, label, `path-${idx}-${prev}-${target}`);
      addEdge(target, prev, 'Response', `path-${idx}-${target}-${prev}`);
      prev = target;
    });
  }

  return { elements: [...nodes, ...edges], pathEdgeIds };
}

function updateGraph(mode, trace) {
  const built = buildGraphFromTrace(mode, trace);
  const elements = built.elements;
  const layout =
    mode === 'iterative'
      ? { name: 'circle', padding: 20, avoidOverlap: true }
      : { name: 'breadthfirst', directed: true, padding: 10 };
  if (!cy) {
    initGraph(elements);
  } else {
    cy.elements().remove();
    cy.add(elements);
    cy.layout(layout).run();
  }

  built.pathEdgeIds.forEach((edgeId) => {
    const edge = cy.getElementById(edgeId);
    if (edge) {
      edge.addClass('path-edge');
    }
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

function renderStats(stats) {
  statsEl.innerHTML = '';
  statsEl.innerHTML = `
    <div>Hit rate: ${stats.hit_rate}</div>
    <div>Total time: ${stats.total_time_ms} ms</div>
    <div>Failure rate: ${stats.failure_rate}</div>
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
  updateGraph(renderMode, data.trace);
  renderTrace(data.trace);
  renderStats(data.stats);
  renderAI(data.ai_advice);
}

resolveBtn.addEventListener('click', resolve);
window.addEventListener('load', resolve);
