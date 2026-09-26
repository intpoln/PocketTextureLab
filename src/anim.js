// ---------------------------------------------------------------------------
// Animation: a global time t in [0, 1) over a loop of N frames. Any float/int
// parameter can be animated from its value (start) to `to` (end) with a curve.
// Frame k of N has t = k / N, so a linear 0 → 1 of a periodic parameter
// (noise evolution, wave phase, offset) loops seamlessly.
// Sprite sheets are cols × rows frames of a power-of-two size, so the sheet is
// always power-of-two as well.
// ---------------------------------------------------------------------------
const Anim = (() => {
  const LAYOUTS = { 4: [2, 2], 8: [4, 2], 16: [4, 4], 32: [8, 4], 64: [8, 8] };
  const CURVES = {
    linear: (t) => t,
    smooth: (t) => t * t * (3 - 2 * t),
    pingpong: (t) => 0.5 - 0.5 * Math.cos(2 * Math.PI * t),   // start → end → start, loops smoothly
    easeIn: (t) => t * t,
    easeOut: (t) => 1 - (1 - t) * (1 - t),
  };
  const CURVE_OPTS = [['linear', 'Линейно (для зацикленных 0→1)'], ['pingpong', 'Туда-обратно (петля)'], ['smooth', 'Плавно'], ['easeIn', 'Разгон'], ['easeOut', 'Торможение']];
  const st = { t: 0 };

  function settings() {
    const a = Graph.state.animation;
    return { frames: a.frames, frameSize: a.frameSize, fps: a.fps, layout: LAYOUTS[a.frames] };
  }
  function isAnimated(node) { return !!((node.anim && Object.keys(node.anim).length) || (NODES[node.type] && NODES[node.type].timeDependent)); }
  function any() { for (const n of Graph.nodes.values()) if (isAnimated(n)) return true; return false; }

  // Parameters of `node` at time t (the node's own params are the start values).
  function params(node, t = st.t) {
    if (!isAnimated(node)) return node.params;
    const p = { ...node.params };
    const defs = NODES[node.type].params;
    for (const key of Object.keys(node.anim || {})) {
      const a = node.anim[key], d = defs.find((q) => q.key === key);
      if (!d) continue;
      const f = (CURVES[a.curve] || CURVES.linear)(t);
      let v = node.params[key] + (a.to - node.params[key]) * f;
      if (d.type === 'int' || (d.intWhen && d.intWhen(node.params))) v = Math.round(v);
      p[key] = v;
    }
    return p;
  }

  function frameTime(k) { return (k % settings().frames) / settings().frames; }

  return {
    LAYOUTS, CURVES, CURVE_OPTS, settings, isAnimated, any, params, frameTime,
    get t() { return st.t; }, set t(v) { st.t = ((v % 1) + 1) % 1; },
  };
})();
