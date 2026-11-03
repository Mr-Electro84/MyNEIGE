'use strict';
const api = window.pedagoTerminal;
const terminal = new Terminal({ cursorBlink: true, scrollback: 3000, fontSize: 14,
  fontFamily: 'Consolas, "Cascadia Mono", monospace', theme: { background: '#101923', foreground: '#e4edf5', cursor: '#78d6c2' },
  allowProposedApi: false, allowTransparency: false });
const fit = new FitAddon.FitAddon();
terminal.loadAddon(fit); terminal.open(document.getElementById('terminal'));
const labels = {
  authenticating: 'Vérification des identifiants…', connecting: 'Connexion SSH via le VPN…',
  connected: 'Connecté au serveur pédagogique · SSH via VPN', closed: 'Connexion SSH terminée.',
  cancelled: 'Connexion annulée. Vous pouvez réessayer ou saisir les identifiants.',
  'authentication-failed': 'Identifiants refusés par le serveur. Vérifiez votre compte et ses droits d’accès.',
  'host-changed': 'La clé du serveur a changé. Connexion bloquée : contactez l’université avant toute nouvelle tentative.',
  'input-overflow': 'Envoi interrompu : le texte collé est trop volumineux. Reconnectez-vous et réduisez sa taille.',
  error: 'Connexion impossible ou interrompue. Vérifiez le VPN et l’accès au serveur, puis réessayez.'
};
let connected = false, generation = 0;
api.onData(({ epoch, bytes }) => {
  if (epoch !== generation) return;
  const chunk = new Uint8Array(bytes);
  terminal.write(chunk, () => api.acknowledge(epoch, chunk.byteLength));
});
api.onState((value, epoch) => {
  if (!Object.hasOwn(labels, value)) return;
  generation = epoch;
  connected = value === 'connected';
  const busy = ['authenticating', 'connecting'].includes(value);
  document.getElementById('status').textContent = labels[value];
  document.getElementById('connect').disabled = busy || connected;
  document.getElementById('manual').disabled = busy || connected;
  document.getElementById('disconnect').disabled = !busy && !connected;
  terminal.options.disableStdin = !connected;
  if (value === 'connecting') terminal.reset();
  if (connected) { fit.fit(); api.resize({ cols: terminal.cols, rows: terminal.rows }); terminal.focus(); }
});
terminal.options.disableStdin = true;
terminal.onData(value => { if (connected) api.input(value); });
terminal.onResize(({ cols, rows }) => api.resize({ cols, rows }));
const observer = new ResizeObserver(() => fit.fit()); observer.observe(document.getElementById('terminal'));
document.getElementById('connect').addEventListener('click', () => api.connect());
document.getElementById('manual').addEventListener('click', () => api.manual());
document.getElementById('disconnect').addEventListener('click', () => api.disconnect());
window.addEventListener('keydown', event => {
  if (event.ctrlKey && event.shiftKey && event.code === 'KeyC') { event.preventDefault(); if (terminal.hasSelection()) navigator.clipboard.writeText(terminal.getSelection()).catch(() => {}); }
});
