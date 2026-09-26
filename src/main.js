// Entry point.
const PTL_VERSION = '__PTL_VERSION__';
(() => {
  const start = () => {
    try {
      if (App.init()) console.info('Pocket Texture Lab v' + PTL_VERSION + ' ready. Automation/agents: window.PTL — call PTL.help() for the manual.');
    } catch (e) {
      console.error(e);
      const box = document.getElementById('fatal-box');
      box.innerHTML = '<h2 style="margin-top:0;color:var(--err)">Ошибка запуска</h2><pre style="white-space:pre-wrap"></pre>';
      box.querySelector('pre').textContent = String(e && e.stack || e);
      document.getElementById('fatal').classList.add('show');
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
