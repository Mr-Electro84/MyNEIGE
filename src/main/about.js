'use strict';
// The native supervisor launches a JS entry point directly, so app.getVersion()
// would describe Electron. Keep application metadata in package.json instead.
// The supervisor also copies this manifest into the protected browser directory.
const metadata = require('../../package.json');
function helpMenu(window, dialog = require('electron').dialog) {
  return { label: 'Aide', submenu: [
    { id: 'about', label: 'À propos…', click: () => {
      if (window.isDestroyed()) return;
      void dialog.showMessageBox(window, {
        type: 'info', title: 'À propos de MyNEIGE',
        message: `MyNEIGE — version ${metadata.version}`,
        detail: `Développeur : ${metadata.author}\n\nLicence : Apache License 2.0 (${metadata.license})\nLe texte intégral est fourni dans le fichier LICENSE de l’application.`,
        buttons: ['Fermer'], defaultId: 0, cancelId: 0, noLink: true
      }).catch(() => {});
    } }
  ] };
}
module.exports = { helpMenu };
