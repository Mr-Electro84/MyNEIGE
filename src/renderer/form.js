'use strict';
const form = document.getElementById('credentials');
const username = document.getElementById('username');
const password = document.getElementById('password');
const connect = document.getElementById('connect');
const state = document.getElementById('state');
const messages = Object.freeze({
  AUTH_REQUIRED: 'Saisissez vos identifiants VPN. Ils ne seront pas enregistrés.',
  CONNECTING: 'Connexion au VPN universitaire…',
  READY: 'VPN connecté. La fenêtre APPIGS utilise le tunnel.',
  BLOCKED: 'Session arrêtée ou connexion perdue. La navigation est bloquée.',
  ERROR: 'La connexion a échoué. Le diagnostic local précise la cause.'
});
window.myneige.onState(value => {
  state.textContent = messages[value] || 'Vérification de la connexion…';
  const enabled = value === 'AUTH_REQUIRED';
  for (const field of [username, password, connect]) field.disabled = !enabled;
  if (enabled) username.focus();
  if (!enabled) { username.value = ''; password.value = ''; }
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  connect.disabled = true;
  const submitted = window.myneige.connect(username.value, password.value);
  username.value = ''; password.value = '';
  try { await submitted; } catch { state.textContent = messages.ERROR; }
});
document.getElementById('disconnect').addEventListener('click', () => {
  username.value = ''; password.value = '';
  window.myneige.disconnect();
});
