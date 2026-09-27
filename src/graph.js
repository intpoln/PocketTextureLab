// ---------------------------------------------------------------------------
// Graph model: nodes, links (one link per input port, fan-out allowed),
// cycle prevention, (de)serialisation and snapshot-based undo/redo.
// ---------------------------------------------------------------------------
const Graph = (() => {
  const g = { nodes: new Map(), links: [], resolution: 512, activeOutput: null, nextId: 1, exposed: [], animation: { frames: 16, frameSize: 256, fps: 24 } };
  let stampCounter = 1;

  function newStamp() { return ++stampCounter; }

  function addNode(type, x, y, params, id) {
    if (!NODES[type]) throw new Error('Неизвестный тип ноды: ' + type);
    const p = { ...defaultParams(type), ...(params ? JSON.parse(JSON.stringify(params)) : {}) };
    id = id || 'n' + g.nextId++;
    const node = { id, type, x: Math.round(x), y: Math.round(y), params: p, anim: {}, stamp: newStamp() };
    g.nodes.set(id, node);
    if (type === 'output' && !g.activeOutput) g.activeOutput = id;
    return node;
  }

  function removeNode(id) {
    g.nodes.delete(id);
    g.links = g.links.filter((l) => l.from !== id && l.to !== id);
    g.exposed = g.exposed.filter((x) => x.node !== id);
    if (g.activeOutput === id) {
      const o = [...g.nodes.values()].find((n) => n.type === 'output');
      g.activeOutput = o ? o.id : null;
    }
  }

  function inputLink(to, toPort) { return g.links.find((l) => l.to === to && l.toPort === toPort) || null; }
  function outputsOf(from) { return g.links.filter((l) => l.from === from); }

  // Is `target` reachable downstream from `start`?
  function reaches(start, target) {
    const seen = new Set(), stack = [start];
    while (stack.length) {
      const n = stack.pop();
      if (n === target) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const l of g.links) if (l.from === n) stack.push(l.to);
    }
    return false;
  }

  // Returns null on success or an error message.
  function connect(from, fromPort, to, toPort) {
    const a = g.nodes.get(from), b = g.nodes.get(to);
    if (!a || !b) return 'Нода не найдена.';
    if (from === to) return 'Нельзя соединить ноду саму с собой.';
    if (fromPort >= NODES[a.type].outputs.length || toPort >= NODES[b.type].inputs.length) return 'Неверный порт.';
    if (reaches(to, from)) return 'Соединение создало бы цикл: результат ноды зависел бы сам от себя. Циклы в графе запрещены.';
    g.links = g.links.filter((l) => !(l.to === to && l.toPort === toPort));
    g.links.push({ from, fromPort, to, toPort });
    return null;
  }

  function disconnect(to, toPort) {
    const n = g.links.length;
    g.links = g.links.filter((l) => !(l.to === to && l.toPort === toPort));
    return g.links.length !== n;
  }

  function upstream(id, acc = new Set()) {
    if (acc.has(id)) return acc;
    acc.add(id);
    for (const l of g.links) if (l.to === id) upstream(l.from, acc);
    return acc;
  }

  function toJSON() {
    return {
      engine: ENGINE,
      resolution: g.resolution,
      activeOutput: g.activeOutput,
      nextId: g.nextId,
      nodes: [...g.nodes.values()].map((n) => ({ id: n.id, type: n.type, x: n.x, y: n.y, params: n.params, ...(n.anim && Object.keys(n.anim).length ? { anim: n.anim } : {}) })),
      animation: { ...g.animation },
      links: g.links.map((l) => ({ ...l })),
      exposed: g.exposed.map((x) => ({ ...x })),
    };
  }

  // Replace the graph with `data`. Nodes whose type+params did not change keep
  // their stamp, so their cached GPU results stay valid (cheap undo).
  function load(data) {
    validate(data);
    const old = g.nodes;
    g.nodes = new Map();
    // Graphs saved before compute engine 2 keep the old values of parameters whose default changed.
    for (const n of data.nodes) {
      const prev = old.get(n.id);
      const params = { ...defaultParams(n.type), ...legacyDefaults(n.type, data.engine | 0), ...JSON.parse(JSON.stringify(n.params || {})) };
      const anim = cleanAnim(n.type, n.anim);
      const same = prev && prev.type === n.type && JSON.stringify(prev.params) === JSON.stringify(params) &&
        JSON.stringify(prev.anim || {}) === JSON.stringify(anim);
      g.nodes.set(n.id, { id: n.id, type: n.type, x: +n.x || 0, y: +n.y || 0, params, anim, stamp: same ? prev.stamp : newStamp() });
    }
    g.links = [];
    for (const l of data.links) {
      if (connect(l.from, l.fromPort | 0, l.to, l.toPort | 0)) console.warn('Пропущена связь', l);
    }
    g.resolution = [256, 512, 1024, 2048].includes(data.resolution) ? data.resolution : 512;
    const an = data.animation || {};
    g.animation = {
      frames: [4, 8, 16, 32, 64].includes(an.frames) ? an.frames : 16,
      frameSize: [64, 128, 256, 512].includes(an.frameSize) ? an.frameSize : 256,
      fps: Math.min(60, Math.max(1, +an.fps || 24)),
    };
    g.exposed = (Array.isArray(data.exposed) ? data.exposed : []).filter((x) => x && g.nodes.has(x.node) &&
      NODES[g.nodes.get(x.node).type].params.some((d) => d.key === x.key)).map((x) => ({ node: x.node, key: x.key, label: String(x.label || x.key) }));
    g.activeOutput = data.activeOutput && g.nodes.has(data.activeOutput) ? data.activeOutput : null;
    if (!g.activeOutput) {
      const o = [...g.nodes.values()].find((n) => n.type === 'output');
      g.activeOutput = o ? o.id : null;
    }
    let maxId = 0;
    for (const id of g.nodes.keys()) { const m = /^n(\d+)$/.exec(id); if (m) maxId = Math.max(maxId, +m[1]); }
    g.nextId = Math.max(data.nextId | 0, maxId + 1);
  }

  function cleanAnim(type, anim) {
    const out = {};
    if (!anim || typeof anim !== 'object') return out;
    for (const key of Object.keys(anim)) {
      const d = NODES[type].params.find((q) => q.key === key);
      if (d && (d.type === 'float' || d.type === 'int') && isFinite(+anim[key].to)) out[key] = { to: +anim[key].to, curve: String(anim[key].curve || 'linear') };
    }
    return out;
  }

  function validate(data) {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.links)) throw new Error('Неверная структура проекта: нет списка нод или связей.');
    const ids = new Set();
    for (const n of data.nodes) {
      if (!n || typeof n.id !== 'string' || !NODES[n.type]) throw new Error('Неверная нода в проекте: ' + JSON.stringify(n && n.type));
      if (ids.has(n.id)) throw new Error('Повторяющийся id ноды: ' + n.id);
      ids.add(n.id);
    }
  }

  function touch(node) { node.stamp = newStamp(); }

  // "Template parameters": selected node params shown at project level.
  function isExposed(id, key) { return g.exposed.some((x) => x.node === id && x.key === key); }
  function expose(id, key, label) {
    const n = g.nodes.get(id);
    const d = n && NODES[n.type].params.find((q) => q.key === key);
    if (!d) throw new Error('Нет параметра ' + key);
    if (!isExposed(id, key)) g.exposed.push({ node: id, key, label: label || d.label });
  }
  function unexpose(id, key) { g.exposed = g.exposed.filter((x) => !(x.node === id && x.key === key)); }

  return {
    state: g, addNode, removeNode, connect, disconnect, inputLink, outputsOf, reaches, upstream,
    toJSON, load, touch, isExposed, expose, unexpose,
    get nodes() { return g.nodes; }, get links() { return g.links; },
  };
})();

// Undo/redo: array of JSON snapshots (graph structure + params only; image
// pixels live in Assets and are referenced by id, never copied).
const History = (() => {
  let states = [], index = -1;
  const LIMIT = 200;
  function reset() { states = [JSON.stringify(Graph.toJSON())]; index = 0; }
  function commit() {
    const s = JSON.stringify(Graph.toJSON());
    if (states[index] === s) return false;
    states = states.slice(0, index + 1);
    states.push(s);
    if (states.length > LIMIT) states.shift();
    index = states.length - 1;
    return true;
  }
  function undo() { if (index <= 0) return false; index--; Graph.load(JSON.parse(states[index])); return true; }
  function redo() { if (index >= states.length - 1) return false; index++; Graph.load(JSON.parse(states[index])); return true; }
  return {
    reset, commit, undo, redo,
    canUndo: () => index > 0, canRedo: () => index < states.length - 1,
    get size() { return states.length; }, get index() { return index; },
  };
})();
