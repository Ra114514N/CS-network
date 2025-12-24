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

function updateGraph(graph, trace) {
  const elements = [...graph.nodes, ...graph.edges];
  if (!cy) {
    initGraph(elements);
  } else {
    cy.elements().remove();
    cy.add(elements);
    cy.layout({ name: 'breadthfirst', directed: true, padding: 10 }).run();
  }

  graph.path.forEach((nodeId) => {
    const node = cy.getElementById(nodeId);
    if (node) {
      node.addClass('highlight');
    }
  });

  // Map trace steps to edges with labels (root -> tld -> auth).
  const stepLabels = trace
    .filter((step) => ['root', 'tld', 'auth'].includes(step.level))
    .map((step) => `${step.response.status} ${step.latency_ms}ms`);

  for (let i = 0; i < graph.path.length - 1; i += 1) {
    const edgeId = `${graph.path[i]}->${graph.path[i + 1]}`;
    const edge = cy.getElementById(edgeId);
    if (edge) {
      edge.addClass('path-edge');
      const label = stepLabels[i] ? stepLabels[i] : '';
      edge.data('label', label);
    }
  }
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
  updateGraph(data.graph, data.trace);
  renderTrace(data.trace);
  renderStats(data.stats);
  renderAI(data.ai_advice);
}

resolveBtn.addEventListener('click', resolve);
window.addEventListener('load', resolve);
