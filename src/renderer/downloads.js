'use strict';
const list = document.getElementById('downloads');
const message = document.getElementById('message');
const cancel = document.getElementById('cancel-all');
const rows = new Map();
const labels = { progressing: 'En cours', completed: 'Terminé', cancelled: 'Annulé', interrupted: 'Interrompu' };
const numbers = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const dates = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
function size(bytes) {
  const value = Math.max(0, bytes);
  const unit = value < 1024 ? 0 : Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${numbers.format(value / 1024 ** unit)} ${['o', 'Ko', 'Mo', 'Go'][unit]}`;
}
async function action(choice, id) {
  try {
    const result = await window.myneigeDownloads.action(choice, id);
    message.textContent = result.ok ? '' : result.message || 'Cette action est indisponible.';
    return result;
  } catch { message.textContent = 'Cette action est indisponible.'; return { ok: false }; }
}
function row(record) {
  const element = document.createElement('li'); element.className = 'download'; element.dataset.id = record.id;
  const heading = document.createElement('div'); heading.className = 'file-heading';
  const name = document.createElement('h2'); name.className = 'file-name';
  const status = document.createElement('span');
  heading.append(name, status);
  const details = document.createElement('p'); details.className = 'details';
  const progress = document.createElement('progress'); progress.max = 1; progress.setAttribute('aria-label', 'Progression du téléchargement');
  const actions = document.createElement('div'); actions.className = 'actions';
  const buttons = [];
  let busy = false;
  for (const [choice, label] of [['open', 'Ouvrir'], ['reveal', 'Afficher dans le dossier']]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.action = choice;
    if (choice === 'reveal') button.className = 'secondary';
    button.addEventListener('click', async () => {
      if (busy) return;
      busy = true; buttons.forEach(button => { button.disabled = true; });
      await action(choice, record.id);
      busy = false; buttons.forEach(button => { button.disabled = !current.canOpen; });
    });
    buttons.push(button); actions.append(button);
  }
  element.append(heading, details, progress, actions);
  let current = record;
  return { element, update(value) {
    current = value;
    name.textContent = value.name;
    status.textContent = labels[value.state] || 'Interrompu'; status.className = `status ${value.state}`;
    const weight = value.active ? `${size(value.received)} reçus${value.total > 0 ? ` sur ${size(value.total)}` : ' · Taille totale inconnue'}` : size(value.received);
    const time = value.endedAt || value.startedAt;
    details.textContent = `${weight} · ${value.endedAt ? (value.state === 'completed' ? 'Téléchargé' : 'Arrêté') : 'Démarré'} le ${dates.format(time)}`;
    progress.hidden = !value.active;
    if (value.total > 0) progress.value = Math.min(1, value.received / value.total);
    else progress.removeAttribute('value');
    buttons.forEach(button => { button.disabled = busy || !value.canOpen; });
  } };
}
function render(records) {
  const ids = new Set(records.map(record => record.id));
  for (const [id, entry] of rows) if (!ids.has(id)) { entry.element.remove(); rows.delete(id); }
  records.forEach((record, index) => {
    if (!rows.has(record.id)) rows.set(record.id, row(record));
    const entry = rows.get(record.id); entry.update(record);
    // Conserver les nœuds et le focus clavier pendant les mises à jour de progression.
    if (list.children[index] !== entry.element) list.insertBefore(entry.element, list.children[index] || null);
  });
  document.getElementById('empty').hidden = records.length > 0;
  const count = records.filter(record => record.active).length;
  cancel.hidden = count === 0;
  document.getElementById('summary').textContent = count ? `${count} téléchargement${count > 1 ? 's' : ''} en cours` : 'Téléchargements de cette session';
}
cancel.addEventListener('click', async () => { cancel.disabled = true; await action('cancel-all'); cancel.disabled = false; });
document.getElementById('close').addEventListener('click', () => { void action('close'); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') void action('close'); });
window.myneigeDownloads.onChanged(render);
void action('list').then(result => { if (result.ok) render(result.records); });
