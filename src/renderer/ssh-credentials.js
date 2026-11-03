'use strict';
const username = document.getElementById('username'), password = document.getElementById('password');
const clear = () => { username.value = ''; password.value = ''; };
document.getElementById('credentials').addEventListener('submit', async event => {
  event.preventDefault();
  const credentials = { username: username.value, password: password.value }; clear();
  document.getElementById('submit').disabled = true;
  try {
    if (!await window.pedagoCredentials.submit(credentials)) {
      document.getElementById('message').textContent = 'Saisie refusée. Vérifiez les identifiants.';
      document.getElementById('submit').disabled = false;
    }
  } finally { credentials.username = credentials.password = ''; }
});
document.getElementById('cancel').addEventListener('click', () => { clear(); void window.pedagoCredentials.cancel(); });
window.addEventListener('pagehide', clear);
window.addEventListener('keydown', event => { if (event.key === 'Escape') { clear(); void window.pedagoCredentials.cancel(); } });
