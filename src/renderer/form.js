'use strict';
const form = document.getElementById('credentials');
const username = document.getElementById('username');
const password = document.getElementById('password');
const connect = document.getElementById('connect');
const state = document.getElementById('state');
const remember = document.getElementById('remember'), savedConnect = document.getElementById('saved-connect');
const forget = document.getElementById('forget'), vaultText = document.getElementById('vault-state');
let authReady = false, busy = false, vault = { available: false, saved: false, hello: false };
function refreshVault() {
  savedConnect.disabled = !authReady || busy || !vault.available || !vault.saved || !vault.hello;
  forget.disabled = !vault.available || !vault.saved;
  remember.disabled = !authReady || busy || !vault.available || !vault.hello;
  if (remember.disabled) remember.checked = false;
}
const vaultMessages = {
  SAVED: 'Identifiants enregistrés et protégés par Windows.',
  DELETED: 'Identifiants enregistrés supprimés. Une session déjà ouverte reste connectée.',
  SAVE_FAILED: 'Enregistrement impossible. La connexion continue sans nouvel enregistrement.',
  DELETE_FAILED: 'Suppression impossible. Les identifiants ne sont pas annoncés comme supprimés.',
  DENIED: 'Vérification Windows Hello annulée ou refusée. Vous pouvez saisir vos identifiants.',
  UNAVAILABLE: 'Coffre ou Windows Hello indisponible. La saisie manuelle reste possible.'
};
function updateVault(value) {
  vault = { ...vault, ...value };
  vaultText.textContent = vaultMessages[value.message] || (!vault.available ? vaultMessages.UNAVAILABLE :
    !vault.hello ? 'Windows Hello est indisponible. Saisissez vos identifiants ; vous pouvez supprimer un enregistrement existant.' :
    vault.saved ? 'Un enregistrement est disponible pour ce compte Windows.' : 'Aucun identifiant enregistré. L’enregistrement est facultatif.');
  refreshVault();
}
window.myneige.onVaultState(updateVault);
window.myneige.vaultStatus().then(updateVault).catch(() => updateVault({ available: false }));
const messages = Object.freeze({
  AUTH_REQUIRED: 'Saisissez vos identifiants VPN ou utilisez votre enregistrement avec Windows Hello.',
  CONNECTING: 'Connexion au VPN universitaire…',
  READY: 'VPN connecté. La fenêtre APPIGS utilise le tunnel.',
  CAS_PREFILLED: 'Identifiants CAS préremplis. Cliquez sur « SE CONNECTER » dans la fenêtre universitaire.',
  CAS_MANUAL: 'VPN connecté. Préremplissage CAS indisponible : saisissez vos identifiants directement sur le site.',
  BLOCKED: 'Session arrêtée ou connexion perdue. La navigation est bloquée.',
  ERROR: 'La connexion a échoué. Le diagnostic local précise la cause.'
});
window.myneige.onState(value => {
  state.textContent = messages[value] || 'Vérification de la connexion…';
  const enabled = value === 'AUTH_REQUIRED';
  authReady = enabled;
  for (const field of [username, password, connect]) field.disabled = !enabled;
  if (enabled) username.focus();
  if (!enabled) { username.value = ''; password.value = ''; }
  refreshVault();
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  connect.disabled = true;
  const submitted = window.myneige.connect(username.value, password.value, remember.checked);
  username.value = ''; password.value = '';
  try { await submitted; } catch { state.textContent = messages.ERROR; }
});
savedConnect.addEventListener('click', async () => {
  busy = true; refreshVault();
  for (const field of [username, password, connect]) field.disabled = true;
  vaultText.textContent = 'Validez la demande Windows Hello…';
  try { const result = await window.myneige.unlock(); if (!result.connected) updateVault({ message: result.message }); }
  catch { updateVault({ message: 'UNAVAILABLE' }); }
  finally {
    busy = false; refreshVault();
    for (const field of [username, password, connect]) field.disabled = !authReady;
  }
});
forget.addEventListener('click', async () => {
  forget.disabled = true; remember.checked = false;
  try { updateVault(await window.myneige.forget()); }
  catch { updateVault({ message: 'DELETE_FAILED' }); }
});
document.getElementById('disconnect').addEventListener('click', () => {
  username.value = ''; password.value = '';
  window.myneige.disconnect();
});
