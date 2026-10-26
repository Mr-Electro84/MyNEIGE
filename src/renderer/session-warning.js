'use strict';
const remaining = document.getElementById('remaining');
const extend = document.getElementById('extend');
let timer;
window.myneigeSession.onWarning(seconds => {
  clearInterval(timer);
  const until = performance.now() + seconds * 1000;
  function refresh() {
    const left = Math.max(0, Math.ceil((until - performance.now()) / 1000));
    remaining.textContent = left ? `Fin de session dans ${Math.floor(left / 60)} min ${String(left % 60).padStart(2, '0')} s.` :
      'La session arrive à son échéance.';
    if (!left) { extend.disabled = true; clearInterval(timer); }
  }
  refresh(); timer = setInterval(refresh, 1000);
});
window.myneigeSession.onPending(() => {
  extend.disabled = true;
  extend.textContent = 'Prolongation en cours…';
});
extend.addEventListener('click', () => window.myneigeSession.extend());
document.getElementById('stop').addEventListener('click', () => window.myneigeSession.stop());
