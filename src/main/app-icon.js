'use strict';
const path = require('node:path');
// In development: <repo>/src/main -> <repo>/assets.
// In protected staging: browser/app/main -> browser/assets.
const APP_ICON = path.resolve(__dirname, '../../assets',
  process.platform === 'win32' ? 'myneige.ico' : 'Logo MyNEIGE@2x.png');
module.exports = { APP_ICON };
