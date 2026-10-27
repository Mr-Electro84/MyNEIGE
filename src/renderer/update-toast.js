'use strict';
const buttons = [...document.querySelectorAll('button')];
window.myneigeUpdate.onOffer(value => {
  const available = value.status === 'available';
  const messages = {
    coming: ['Fonctionnalité à venir', 'La vérification des mises à jour sera disponible prochainement. En attendant, consultez le site web de MyNEIGE pour télécharger la dernière version.'],
    current: ['MyNEIGE est à jour', 'Aucune mise à jour plus récente n’est disponible.'],
    error: ['Vérification impossible', 'Le service de mise à jour est indisponible. Réessayez plus tard depuis le menu Aide.'],
    unavailable: ['Connexion nécessaire', 'La vérification sera disponible une fois la connexion MyNEIGE établie.']
  };
  const [title, message] = available ? ['Une mise à jour est disponible',
    `La version ${value.version} est disponible sur le site de MyNEIGE.`] : (messages[value.status] || messages.error);
  document.getElementById('update-title').textContent = title;
  document.getElementById('update-version').textContent = message;
  document.getElementById('update-actions').hidden = !available;
  document.getElementById('update-close').hidden = available;
  document.getElementById('update-website').hidden = value.status !== 'coming';
  document.getElementById('update-error').textContent = '';
  buttons.forEach(button => { button.disabled = false; });
});
for (const choice of ['download', 'later', 'never', 'close', 'website']) {
  document.getElementById(`update-${choice}`).addEventListener('click', async () => {
    buttons.forEach(button => { button.disabled = true; });
    const error = document.getElementById('update-error'); error.textContent = '';
    try {
      const result = await window.myneigeUpdate.action(choice);
      if (result.ok) return;
    } catch { /* L’erreur reste dans le toast, sans alerte bloquante. */ }
    error.textContent = choice === 'website' ? 'Impossible d’ouvrir le site web. Vérifiez votre navigateur par défaut ou réessayez.' :
      'Action impossible pour le moment. Réessayez ou fermez cette notification.';
    buttons.forEach(button => { button.disabled = false; });
  });
}
