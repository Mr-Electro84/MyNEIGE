'use strict';
const api = window.pedagoTerminal;
const terminal = new Terminal({ cursorBlink: true, scrollback: 3000, fontSize: 14,
  fontFamily: 'Consolas, "Cascadia Mono", monospace', theme: { background: '#101923', foreground: '#e4edf5', cursor: '#78d6c2' },
  // L'extension officielle de recherche utilise les décorations xterm ; versions épinglées ensemble.
  allowProposedApi: true, allowTransparency: false });
const fit = new FitAddon.FitAddon();
terminal.loadAddon(fit); terminal.open(document.getElementById('terminal'));
const search = new SearchAddon.SearchAddon({ highlightLimit: 1000 });
terminal.loadAddon(search);
const element = id => document.getElementById(id);
const labels = {
  authenticating: 'Vérification des identifiants…', connecting: 'Connexion SSH via le VPN…',
  connected: 'Connecté au serveur pédagogique · SSH via VPN', closed: 'Connexion SSH terminée.',
  cancelled: 'Connexion annulée. Vous pouvez réessayer ou saisir les identifiants.',
  'authentication-failed': 'Identifiants refusés par le serveur. Vérifiez votre compte et ses droits d’accès.',
  'host-changed': 'La clé du serveur a changé. Connexion bloquée : contactez l’université avant toute nouvelle tentative.',
  error: 'Connexion impossible ou interrompue. Vérifiez le VPN et l’accès au serveur, puis réessayez.'
};
let connected = false, generation = 0, newOutput = false, toolPending = false, searchTimer;
const notice = text => { element('terminal-notice').textContent = text; };
const behind = () => terminal.buffer.active.viewportY < terminal.buffer.active.baseY;
function updateBottom() {
  const above = behind();
  if (!above) newOutput = false;
  element('bottom').hidden = !above;
  element('bottom').textContent = newOutput ? 'Nouvelle sortie · Aller en bas ↓' : 'Aller en bas ↓';
}
api.onData(({ epoch, bytes }) => {
  if (epoch !== generation) return;
  const chunk = new Uint8Array(bytes);
  const wasBehind = behind();
  terminal.write(chunk, () => {
    api.acknowledge(epoch, chunk.byteLength);
    if (epoch !== generation) return;
    if (wasBehind && behind()) newOutput = true;
    updateBottom();
  });
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
  element('paste').disabled = !connected || toolPending;
  terminal.options.disableStdin = !connected;
  if (value === 'connecting') { terminal.reset(); search.clearDecorations(); newOutput = false; notice(''); }
  if (connected) { fit.fit(); api.resize({ cols: terminal.cols, rows: terminal.rows }); terminal.focus(); }
});
terminal.options.disableStdin = true;
terminal.onData(value => { if (connected) api.input(value); });
terminal.onResize(({ cols, rows }) => api.resize({ cols, rows }));
const observer = new ResizeObserver(() => fit.fit()); observer.observe(document.getElementById('terminal'));
terminal.onScroll(updateBottom);
terminal.onSelectionChange(() => { element('copy').disabled = !terminal.hasSelection(); });
terminal.onWriteParsed(updateBottom);
document.getElementById('connect').addEventListener('click', () => api.connect());
document.getElementById('manual').addEventListener('click', () => api.manual());
document.getElementById('disconnect').addEventListener('click', () => api.disconnect());
const reasons = {
  unavailable: 'Action indisponible. Réessayez lorsque le dialogue en cours est fermé.',
  disconnected: 'Le collage nécessite une connexion SSH active.', empty: 'Aucun texte à copier ou à coller.',
  'too-large': 'Le contenu dépasse la taille maximale de 8 Mio.',
  'paste-too-large': 'Collage refusé : le texte dépasse 60 Kio. Collez-le en plusieurs parties.',
  controls: 'Collage refusé : le texte contient des caractères de contrôle.',
  extension: 'Choisissez un fichier avec l’extension .txt.', error: 'L’opération a échoué. Vérifiez l’accès au presse-papiers ou au fichier.'
};
async function runCommand(command) {
  if (command === 'find') {
    element('search-bar').hidden = false; fit.fit(); element('search-input').focus(); element('search-input').select(); return;
  }
  if (command === 'select-all') { terminal.selectAll(); return; }
  if (command === 'bottom') { terminal.scrollToBottom(); updateBottom(); terminal.focus(); return; }
  if (command.startsWith('zoom-')) {
    terminal.options.fontSize = command === 'zoom-reset' ? 14 : Math.max(10, Math.min(28, terminal.options.fontSize + (command === 'zoom-in' ? 1 : -1)));
    element('zoom-reset').textContent = terminal.options.fontSize + ' px'; fit.fit(); return;
  }
  if (command === 'clear-screen' || command === 'clear-history') {
    search.clearDecorations();
    terminal.write(command === 'clear-screen' ? '\x1b[2J' : '\x1b[3J', () => {
      updateBottom(); findMatch(false, true);
    });
    notice(command === 'clear-screen' ? 'Écran effacé localement.' : 'Historique effacé ; l’écran courant est conservé.');
    terminal.focus(); return;
  }
  if (!['copy', 'paste', 'export'].includes(command) || toolPending) return;
  if (command === 'paste' && !connected) { notice(reasons.disconnected); return; }
  toolPending = true; element('paste').disabled = true; element('export').disabled = true;
  const epoch = generation;
  try {
    let value;
    if (command === 'copy') value = terminal.getSelection();
    if (command === 'export') {
      // Attendre les sorties déjà reçues avant de figer le contenu exporté.
      await new Promise(resolve => terminal.write('', resolve));
      value = TerminalBuffer.snapshot(terminal.buffer.active);
    }
    const result = await api.tools(command, value);
    if (epoch !== generation) return;
    if (result.ok) {
      if (command === 'paste' && connected) { terminal.paste(result.text); terminal.focus(); }
      notice(command === 'copy' ? 'Sélection copiée.' : command === 'export' ? 'Contenu conservé enregistré en texte UTF-8.' : 'Texte collé.');
    } else if (result.reason !== 'cancelled') notice(reasons[result.reason] || reasons.error);
  } catch { notice(reasons.error); }
  finally { toolPending = false; element('paste').disabled = !connected; element('export').disabled = false; }
}
function findMatch(previous = false, incremental = false) {
  clearTimeout(searchTimer);
  const term = element('search-input').value;
  if (!term || element('search-bar').hidden) { search.clearDecorations(); element('search-results').textContent = ''; return; }
  const wholeWord = element('search-word').checked;
  // En 0.16, wholeWord peut arrêter le comptage au premier mot partiel d'une ligne.
  // Un motif littéral borné conserve toutes les occurrences, y compris les mots accentués.
  const query = TerminalBuffer.searchTerm(term, wholeWord);
  const options = { caseSensitive: element('search-case').checked, regex: wholeWord,
    incremental, decorations: { matchBackground: '#67541c', matchBorder: '#c8a94d', matchOverviewRuler: '#c8a94d',
      activeMatchBackground: '#246857', activeMatchBorder: '#78d6c2', activeMatchColorOverviewRuler: '#78d6c2' } };
  const found = previous ? search.findPrevious(query, options) : search.findNext(query, options);
  if (!found) element('search-results').textContent = 'Aucune occurrence';
}
search.onDidChangeResults(({ resultIndex, resultCount }) => {
  element('search-results').textContent = resultCount === 0 ? 'Aucune occurrence' : resultIndex < 0 ? 'Plus de 1 000 occurrences' : `${resultIndex + 1} / ${resultCount}`;
});
function closeSearch() {
  clearTimeout(searchTimer); element('search-bar').hidden = true; search.clearDecorations(); fit.fit(); terminal.focus();
}
for (const command of ['copy', 'paste', 'find', 'export', 'zoom-in', 'zoom-out', 'zoom-reset', 'bottom'])
  element(command).addEventListener('click', () => { void runCommand(command); });
element('more').addEventListener('click', () => { void api.tools('context-menu', terminal.hasSelection()); });
element('terminal').addEventListener('contextmenu', event => { event.preventDefault(); void api.tools('context-menu', terminal.hasSelection()); });
// Intercepter aussi Ctrl+V et Maj+Inser : aucun chemin de collage ne contourne la confirmation.
element('terminal').addEventListener('paste', event => { event.preventDefault(); event.stopImmediatePropagation(); void runCommand('paste'); }, true);
element('search-input').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => findMatch(false, true), 120); });
for (const id of ['search-case', 'search-word']) element(id).addEventListener('change', () => {
  // Invalider aussi le cache des décorations lorsque le texte recherché reste identique.
  search.clearDecorations(); findMatch(false, true);
});
element('search-next').addEventListener('click', () => findMatch());
element('search-previous').addEventListener('click', () => findMatch(true));
element('search-close').addEventListener('click', closeSearch);
element('search-bar').addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearch(); }
  else if (event.key === 'Enter') { event.preventDefault(); findMatch(event.shiftKey); }
});
api.onCommand(command => { void runCommand(command); });
api.onNotice(value => { if (value === 'input-rejected') notice('Entrée refusée : le texte ou le débit d’envoi est trop important. La connexion reste ouverte.'); });
window.addEventListener('keydown', event => {
  if (!event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.code === 'KeyR' && !event.shiftKey) {
    // Réserver Ctrl+R au shell, sans recharger la page locale du terminal.
    event.preventDefault(); event.stopPropagation();
    if (event.target === terminal.textarea && connected) api.input('\x12');
    return;
  }
  const shifted = { KeyC: 'copy', KeyV: 'paste', KeyF: 'find', KeyA: 'select-all', KeyS: 'export' };
  let command = event.shiftKey ? shifted[event.code] : undefined;
  if (event.code === 'Equal' || event.code === 'NumpadAdd' || event.key === '+') command = 'zoom-in';
  else if (event.code === 'Minus' || event.code === 'NumpadSubtract') command = 'zoom-out';
  else if (event.code === 'Digit0' || event.code === 'Numpad0') command = 'zoom-reset';
  if (!command) return;
  event.preventDefault(); event.stopPropagation();
  if (!event.repeat || command.startsWith('zoom-')) void runCommand(command);
}, true);
