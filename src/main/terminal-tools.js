'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const MAX_TEXT = 8 * 1024 * 1024;
const MAX_PASTE = 60 * 1024;

async function saveTerminalText(file, text, current) {
  const temporary = path.join(path.dirname(file), '.myneige-terminal-' + randomBytes(12).toString('hex') + '.tmp');
  try {
    await fs.writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    if (!current()) return false;
    await fs.rename(temporary, file);
    return true;
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

// Les appelants contrôlent la fenêtre, son document principal et la génération de connexion.
function createTerminalTools({ clipboard, dialog, save = saveTerminalText }) {
  let busy = false;
  return async function action(name, value, { owner, current, canPaste }) {
    if (!current() || busy) return { ok: false, reason: 'unavailable' };
    if (!['copy', 'paste', 'export'].includes(name)) return { ok: false, reason: 'invalid' };
    if (name !== 'paste' && (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_TEXT))
      return { ok: false, reason: 'too-large' };
    busy = true;
    try {
      if (name === 'copy') {
        if (!value) return { ok: false, reason: 'empty' };
        await clipboard.writeText(value);
        return { ok: current() };
      }
      if (name === 'paste') {
        if (!canPaste()) return { ok: false, reason: 'disconnected' };
        const text = await clipboard.readText();
        if (!current() || !canPaste()) return { ok: false, reason: 'disconnected' };
        if (!text) return { ok: false, reason: 'empty' };
        if (Buffer.byteLength(text, 'utf8') > MAX_PASTE) return { ok: false, reason: 'paste-too-large' };
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) return { ok: false, reason: 'controls' };
        if (/[\r\n]/u.test(text)) {
          const result = await dialog.showMessageBox(owner, { type: 'question', title: 'MyNEIGE · Collage multiligne',
            message: 'Ce collage contient des retours à la ligne et peut exécuter des commandes.',
            detail: text.slice(0, 800) + (text.length > 800 ? '\n…' : ''),
            buttons: ['Annuler', 'Coller'], defaultId: 0, cancelId: 0, noLink: true });
          if (result.response !== 1) return { ok: false, reason: 'cancelled' };
        }
        return current() && canPaste() ? { ok: true, text } : { ok: false, reason: 'disconnected' };
      }
      const result = await dialog.showSaveDialog(owner, { title: 'Enregistrer le contenu conservé du terminal',
        defaultPath: 'terminal-pedagogique.txt', filters: [{ name: 'Texte UTF-8', extensions: ['txt'] }],
        properties: ['showOverwriteConfirmation', 'createDirectory', 'dontAddToRecent'] });
      if (result.canceled || !result.filePath) return { ok: false, reason: 'cancelled' };
      if (!current()) return { ok: false, reason: 'unavailable' };
      if (path.extname(result.filePath).toLowerCase() !== '.txt') return { ok: false, reason: 'extension' };
      return { ok: await save(result.filePath, value, current) };
    } catch { return { ok: false, reason: 'error' }; }
    finally { busy = false; }
  };
}
module.exports = { MAX_TEXT, MAX_PASTE, saveTerminalText, createTerminalTools };
