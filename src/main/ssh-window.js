'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { APP_ICON } = require('./app-icon');
const { validateCredentials } = require('./policy');
const { SSH_HOST, createSshConnection, createHostVerifier } = require('./ssh');
const { createTerminalTools } = require('./terminal-tools');

// L'authentification Hello refusée reste une annulation. La saisie manuelle est un choix explicite.
async function acquireSshCredentials({ vault, handle, fingerprint, prompt, current, manual = false }) {
  let credentials;
  try {
    if (!current()) return null;
    if (!manual) {
      let status;
      try { status = await vault.status(); } catch { /* Dialogue local si le coffre est indisponible. */ }
      if (!current()) return null;
      if (status?.saved && status.hello) {
        try {
          credentials = await vault.unlock(handle, fingerprint);
          if (!credentials) return null;
        } catch { /* Hello devenu indisponible : proposer la saisie, sans lecture silencieuse. */ }
      }
    }
    if (!current()) return null;
    credentials ??= await prompt();
    if (current() && validateCredentials(credentials)) {
      const result = credentials; credentials = undefined; return result;
    }
    return null;
  } finally { if (credentials) credentials.username = credentials.password = ''; }
}

function createSshWindow({ BrowserWindow, ipcMain, dialog, localSession, vault, fingerprint, ready,
  proxy, knownHostFile, show = true, connectionFactory = createSshConnection,
  clipboard = require('electron').clipboard, Menu = require('electron').Menu, saveText }) {
  const terminalFile = path.join(__dirname, '../renderer/ssh-terminal.html');
  const credentialsFile = path.join(__dirname, '../renderer/ssh-credentials.html');
  const terminalURL = pathToFileURL(terminalFile).href, credentialsURL = pathToFileURL(credentialsFile).href;
  let window, loaded, promptWindow, resolvePrompt, connection, epoch = 0, busy = false, disposed = false;
  let sshConnected = false;
  const tools = createTerminalTools({ clipboard, dialog, save: saveText });
  const alive = () => !disposed && ready() && window && !window.isDestroyed();
  const trusted = (event, owner, url) => owner && !owner.isDestroyed() && event.sender === owner.webContents &&
    event.senderFrame === owner.webContents.mainFrame && event.senderFrame.url === url;
  const state = value => { if (alive()) window.webContents.send('myneige:ssh-state', value, epoch); };
  function secureWindow(options, preload) {
    const created = new BrowserWindow({ icon: APP_ICON, show: false, ...options,
      webPreferences: { session: localSession, preload: path.join(__dirname, '../preload', preload),
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, navigateOnDragDrop: false } });
    created.setMenu(null);
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    created.webContents.on('will-navigate', event => event.preventDefault());
    created.webContents.on('will-attach-webview', event => event.preventDefault());
    created.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r' &&
          (preload !== 'ssh-terminal.js' || input.shift))) event.preventDefault();
    });
    return created;
  }
  function finishPrompt(credentials = null) {
    const resolve = resolvePrompt; resolvePrompt = undefined;
    const current = promptWindow; promptWindow = undefined;
    if (current && !current.isDestroyed()) current.destroy();
    resolve?.(credentials);
  }
  async function prompt() {
    if (!alive()) return null;
    return new Promise(resolve => {
      resolvePrompt = resolve;
      const current = promptWindow = secureWindow({ parent: window, modal: true, resizable: false,
        title: 'MyNEIGE · Connexion au serveur pédagogique', width: 510, height: 490 }, 'ssh-credentials.js');
      current.once('closed', () => { if (promptWindow === current) finishPrompt(); });
      current.loadFile(credentialsFile).then(() => {
        if (promptWindow === current && alive() && show) current.show();
      }).catch(() => { if (promptWindow === current) finishPrompt(); });
    });
  }
  function invalidate() {
    ++epoch; busy = false; sshConnected = false; finishPrompt(); vault.cancelActive();
    connection?.stop(); connection = undefined; state('closed');
  }
  function close() {
    invalidate();
    const current = window; window = undefined;
    if (current && !current.isDestroyed()) current.destroy();
  }
  async function authenticate(manual = false) {
    if (!alive() || busy) return;
    busy = true; const attempt = ++epoch, owner = window;
    sshConnected = false;
    connection?.stop(); connection = undefined;
    const current = () => alive() && window === owner && epoch === attempt;
    let credentials;
    state('authenticating');
    try {
      const bytes = owner.getNativeWindowHandle();
      const handle = bytes.length === 8 ? bytes.readBigUInt64LE() : BigInt(bytes.readUInt32LE());
      credentials = await acquireSshCredentials({ vault, handle, fingerprint: fingerprint(), prompt, current, manual });
      if (!current()) return;
      if (!credentials) { state('cancelled'); return; }
      const verifyHost = createHostVerifier({ file: knownHostFile, ready: current, confirm: async key => {
        if (!current()) return false;
        const result = await dialog.showMessageBox(owner, { type: 'question', title: 'MyNEIGE · Identité du serveur SSH',
          message: `Première connexion à ${SSH_HOST}`,
          detail: `Empreinte de la clé du serveur :\n${key}\n\nVérifiez cette empreinte auprès de l’université avant de l’accepter. Elle sera mémorisée pour les prochaines connexions.`,
          buttons: ['Annuler', 'Accepter cette clé'], defaultId: 0, cancelId: 0, noLink: true });
        return current() && result.response === 1;
      } });
      const transport = proxy();
      connection = connectionFactory({ ...transport, ready: current, verifyHost,
        onData: chunk => { if (current()) owner.webContents.send('myneige:ssh-data', { epoch: attempt, bytes: chunk }); },
        onState: value => { if (current()) { sshConnected = value === 'connected'; state(value); } } });
      await connection.start(credentials);
    } catch { if (current()) state('error'); }
    finally { if (credentials) credentials.username = credentials.password = ''; if (epoch === attempt) busy = false; }
  }
  ipcMain.handle('myneige:ssh-credentials', (event, value) => {
    if (!alive() || !trusted(event, promptWindow, credentialsURL) || !resolvePrompt) return false;
    if (value !== null && !validateCredentials(value)) return false;
    finishPrompt(value); return true;
  });
  ipcMain.on('myneige:ssh-action', (event, action, value) => {
    if (!alive() || !trusted(event, window, terminalURL)) return;
    if (action === 'input') {
      if (connection?.input(value) === false) window.webContents.send('myneige:ssh-notice', 'input-rejected');
    }
    else if (action === 'resize') connection?.resize(value);
    else if (action === 'ack' && value?.epoch === epoch) connection?.acknowledge(value.bytes);
    else if (action === 'connect' || action === 'manual') void authenticate(action === 'manual');
    else if (action === 'disconnect') invalidate();
  });
  ipcMain.handle('myneige:ssh-tools', (event, action, value) => {
    if (!alive() || !trusted(event, window, terminalURL)) return { ok: false, reason: 'unavailable' };
    const owner = window, generation = epoch;
    const current = () => alive() && window === owner && epoch === generation;
    if (action === 'context-menu') {
      const command = name => { if (current()) owner.webContents.send('myneige:ssh-command', name); };
      Menu.buildFromTemplate([
        { label: 'Copier', enabled: value === true, click: () => command('copy') },
        { label: 'Coller', enabled: sshConnected, click: () => command('paste') },
        { label: 'Tout sélectionner', click: () => command('select-all') },
        { type: 'separator' },
        { label: 'Rechercher…', click: () => command('find') },
        { label: 'Enregistrer la sortie…', click: () => command('export') },
        { type: 'separator' },
        { label: 'Effacer l’écran', click: () => command('clear-screen') },
        { label: 'Effacer l’historique', click: () => command('clear-history') },
        { type: 'separator' },
        { label: 'Agrandir le texte', click: () => command('zoom-in') },
        { label: 'Réduire le texte', click: () => command('zoom-out') },
        { label: 'Taille par défaut', click: () => command('zoom-reset') },
        { label: 'Aller en bas', click: () => command('bottom') }
      ]).popup({ window: owner });
      return { ok: true };
    }
    return tools(action, value, { owner, current, canPaste: () => current() && sshConnected });
  });
  return {
    async open(parent) {
      if (disposed || !ready()) return;
      let created = false;
      if (!window) {
        created = true;
        const owner = window = secureWindow({ parent: parent && !parent.isDestroyed() ? parent : undefined,
          title: 'MyNEIGE · Serveur pédagogique', width: 1060, height: 700, minWidth: 640, minHeight: 500 }, 'ssh-terminal.js');
        owner.once('closed', () => { if (window === owner) close(); });
        owner.webContents.once('render-process-gone', () => { if (window === owner) close(); });
        loaded = owner.loadFile(terminalFile);
      }
      const owner = window;
      try { await loaded; } catch { if (window === owner) close(); return; }
      if (!alive() || window !== owner) return;
      if (show) { if (owner.isMinimized()) owner.restore(); owner.show(); owner.focus(); }
      if (created) void authenticate();
    },
    invalidate,
    close,
    dispose() {
      if (disposed) return;
      close(); disposed = true; vault.stop();
      ipcMain.removeHandler('myneige:ssh-credentials'); ipcMain.removeAllListeners('myneige:ssh-action');
      ipcMain.removeHandler('myneige:ssh-tools');
    }
  };
}
module.exports = { acquireSshCredentials, createSshWindow };
