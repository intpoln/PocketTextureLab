// Built-in example projects (no images, so they load instantly).
const EXAMPLES = [
  {
    title: '1. Шум → Levels → Color Ramp',
    graph: {
      resolution: 512, activeOutput: 'n4', selected: 'n4',
      nodes: [
        { id: 'n1', type: 'noise', x: 0, y: 40, params: { type: 'perlin', scale: 4, octaves: 6, persistence: 0.55, seed: 7, contrast: 1.3 } },
        { id: 'n2', type: 'levels', x: 230, y: 40, params: { inBlack: 0.25, inWhite: 0.78, gamma: 1.1 } },
        { id: 'n3', type: 'ramp', x: 460, y: 40, params: { interp: 'smooth', stops: [
          { p: 0, c: [0.05, 0.12, 0.3, 1] }, { p: 0.38, c: [0.1, 0.45, 0.55, 1] }, { p: 0.52, c: [0.86, 0.8, 0.55, 1] },
          { p: 0.7, c: [0.35, 0.55, 0.2, 1] }, { p: 1, c: [0.95, 0.96, 0.98, 1] }] } },
        { id: 'n4', type: 'output', x: 690, y: 40, params: { filename: 'terrain_color' } },
      ],
      links: [
        { from: 'n1', fromPort: 0, to: 'n2', toPort: 0 }, { from: 'n2', fromPort: 0, to: 'n3', toPort: 0 },
        { from: 'n3', fromPort: 0, to: 'n4', toPort: 0 },
      ],
    },
  },
  {
    title: '2. Шум → Gaussian Blur → Height to Normal',
    graph: {
      resolution: 512, activeOutput: 'n4', selected: 'n3',
      nodes: [
        { id: 'n1', type: 'noise', x: 0, y: 40, params: { type: 'perlin', scale: 6, octaves: 6, persistence: 0.5, seed: 11, contrast: 1.2 } },
        { id: 'n2', type: 'gaussian', x: 230, y: 40, params: { sigma: 1.5 } },
        { id: 'n3', type: 'normal', x: 460, y: 40, params: { strength: 3, source: 'R' } },
        { id: 'n4', type: 'output', x: 690, y: 40, params: { filename: 'noise_normal_gl' } },
      ],
      links: [
        { from: 'n1', fromPort: 0, to: 'n2', toPort: 0 }, { from: 'n2', fromPort: 0, to: 'n3', toPort: 0 },
        { from: 'n3', fromPort: 0, to: 'n4', toPort: 0 },
      ],
    },
  },
  {
    title: '3. Три маски → Combine RGBA (ORM) → Output',
    graph: {
      resolution: 512, activeOutput: 'n5', selected: 'n4',
      nodes: [
        { id: 'n1', type: 'voronoi', x: 0, y: 0, params: { mode: 'border', scale: 5, seed: 21 } },
        { id: 'n2', type: 'noise', x: 0, y: 150, params: { type: 'perlin', scale: 6, octaves: 4, seed: 5 } },
        { id: 'n3', type: 'shape', x: 0, y: 300, params: { shape: 'rect', sizeX: 0.6, sizeY: 0.6, softness: 0.02 } },
        { id: 'n6', type: 'levels', x: 230, y: 0, params: { inBlack: 0, inWhite: 0.35, outBlack: 0.25 } },
        { id: 'n4', type: 'combine', x: 460, y: 120, params: { preset: 'orm' } },
        { id: 'n5', type: 'output', x: 690, y: 120, params: { filename: 'tile_ORM' } },
      ],
      links: [
        { from: 'n1', fromPort: 0, to: 'n6', toPort: 0 }, { from: 'n6', fromPort: 0, to: 'n4', toPort: 0 },
        { from: 'n2', fromPort: 0, to: 'n4', toPort: 1 }, { from: 'n3', fromPort: 0, to: 'n4', toPort: 2 },
        { from: 'n4', fromPort: 0, to: 'n5', toPort: 0 },
      ],
    },
  },
];
