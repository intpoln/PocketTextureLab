// Build: inline CSS, the agent guide and all scripts into one self-contained
// texture-lab.html. No runtime dependencies, no network access.
import { readFileSync, writeFileSync } from 'node:fs';

const r = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ORDER = [
  'vendor/pako.min.js', 'vendor/UPNG.js',
  'png.js', 'color.js', 'shaders.js', 'gpu.js', 'assets.js', 'fx.js', 'nodes.js', 'graph.js', 'anim.js', 'engine.js',
  'library.js', 'ui-browser.js', 'ui-graph.js', 'ui-params.js', 'ui-3d.js', 'ui-preview.js', 'examples.js', 'app.js', 'api.js', 'main.js',
];

const licenses = `/*!
 * Pocket Texture Lab — single-file build.
 * Third-party code embedded below:
 *
 * ---- pako 1.0.11 (zlib port) — https://github.com/nodeca/pako ----
${r('src/vendor/LICENSE-pako.txt').split('\n').map((l) => ' * ' + l).join('\n')}
 *   pako also contains code derived from zlib (C) 1995-2013 Jean-loup Gailly and Mark Adler,
 *   under the zlib license (see https://github.com/nodeca/pako/blob/1.0.11/LICENSE).
 *
 * ---- UPNG.js 2.1.0 — https://github.com/photopea/UPNG.js ----
${r('src/vendor/LICENSE-UPNG.txt').split('\n').map((l) => ' * ' + l).join('\n')}
 *   Local modification: fix of the 1-bit Adam7 de-interlacing mask (marked "PTL patch").
 */
`;

let js = licenses;
for (const f of ORDER) {
  const src = r('src/' + f);
  if (/<\/script/i.test(src)) throw new Error(f + ' contains </script');
  js += `\n// ===== ${f} =====\n` + src + '\n';
}
const guide = r('docs/AGENT_GUIDE.md');
if (/<\/script/i.test(guide)) throw new Error('guide contains </script');

let html = r('src/index.html');
html = html.replace('/*CSS*/', () => r('src/style.css'));
html = html.replace('/*AGENT_GUIDE*/', () => guide);
html = html.replace('/*SCRIPTS*/', () => js);
writeFileSync(new URL('texture-lab.html', import.meta.url), html);
console.log('texture-lab.html', (html.length / 1024).toFixed(0), 'KB');
