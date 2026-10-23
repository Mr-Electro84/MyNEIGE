'use strict';
// Credential-free Electron integration fixtures. Called only by TEST_CAS_PREFILL
// after the native BOOT test mode; never register protocols on the live session.
const { START_URL } = require('./policy');
const LOGIN = 'https://cas.univ-avignon.fr/cas/login?service=' + encodeURIComponent(START_URL);
const USER = 'myneige-local-test';
const PASSWORD = 'fictif-"\\é</script> & < >';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture({ action = 'login', username = '', token = 'fresh-fixture-token', duplicate = false, iframe = false } = {}) {
  const form = `<form id="fm1" method="post" action="${action}">
    <input id="username" name="username" type="text" value="${username}">
    <input id="password" name="password" type="password" autocomplete="off">
    <input type="hidden" name="execution" value="${token}">
    <input type="hidden" name="_eventId" value="submit">
    ${duplicate ? '<input name="username" value="second">' : ''}
    <button type="submit" name="submitBtn">SE CONNECTER</button></form>`;
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src https://cas.univ-avignon.fr; form-action https:; script-src 'none'">${form}${iframe ? `<iframe src="${LOGIN}"></iframe>` : ''}`;
}
async function snapshot(window) {
  // Only fictitious fixture data is inspected. Live credentials are never read back.
  return window.webContents.executeJavaScript(`(() => {
    const form = document.getElementById('fm1');
    return { user: form.querySelector('#username').value, password: form.querySelector('#password').value,
      execution: form.querySelector('[name=execution]').value, event: form.querySelector('[name=_eventId]').value,
      sandbox: typeof require === 'undefined' && typeof process === 'undefined' && typeof window.myneige === 'undefined' };
  })()`);
}
async function run({ session, protectedWindow, CasPrefill }) {
  let totalPosts = 0;
  const cases = [
    { name: 'fill-and-reload', filled: true },
    { name: 'other-origin', url: LOGIN.replace('cas.univ-avignon.fr', 'services.univ-avignon.fr') },
    { name: 'other-service', url: LOGIN.replace(encodeURIComponent(START_URL), encodeURIComponent('https://services.univ-avignon.fr/')) },
    { name: 'other-action', action: 'https://services.univ-avignon.fr/cas/login' },
    { name: 'existing-input', username: 'manual-user' },
    { name: 'missing-flow', token: '' },
    { name: 'duplicate-field', duplicate: true },
    { name: 'cancelled', cancel: true },
    { name: 'subframe', iframe: true, url: 'https://www.appigs.univ-avignon.fr/fixture' }
  ];
  for (const [index, example] of cases.entries()) {
    const isolatedSession = session.fromPartition(`cas-fixture-${Date.now()}-${index}`, { cache: false });
    let posts = 0;
    isolatedSession.protocol.handle('https', request => {
      if (request.method !== 'GET') { ++posts; return new Response('Unexpected fixture submit', { status: 400 }); }
      const nested = new URL(request.url).hostname === 'cas.univ-avignon.fr' && example.iframe;
      return new Response(fixture(nested ? {} : example), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
    await isolatedSession.cookies.set({ url: 'https://cas.univ-avignon.fr', name: 'cas-fixture', value: 'unchanged', secure: true });
    const controller = new CasPrefill({ ready: () => true });
    controller.capture({ username: USER, password: PASSWORD });
    if (example.cancel) controller.clear();
    const window = protectedWindow(isolatedSession, controller);
    try {
      await window.loadURL(example.url || LOGIN);
      const until = Date.now() + 4000;
      while (!controller.completed && example.filled && Date.now() < until) await pause(25);
      await pause(100);
      const state = await snapshot(window);
      if (!state.sandbox || state.execution !== (example.token ?? 'fresh-fixture-token') || state.event !== 'submit' || posts !== 0) throw new Error('CAS fixture invariant failed');
      if (example.filled) {
        if (state.user !== USER || state.password !== PASSWORD || controller.user || controller.password) throw new Error('CAS fixture prefill failed');
        // A fresh page/flow cannot retrieve the consumed credentials a second time.
        await window.loadURL(LOGIN);
        await pause(100);
        const reloaded = await snapshot(window);
        if (reloaded.user || reloaded.password || posts) throw new Error('CAS fixture reused credentials');
      } else {
        if (state.user !== (example.username || '') || state.password) throw new Error('CAS fixture disclosed credentials');
        if (example.iframe) {
          const frame = window.webContents.mainFrame.frames.find(frame => frame.url.startsWith('https://cas.univ-avignon.fr/'));
          if (!frame || !await frame.executeJavaScript(`document.querySelector('#username').value === '' && document.querySelector('#password').value === ''`)) throw new Error('CAS subframe received credentials');
        }
      }
      const cookies = await isolatedSession.cookies.get({ url: 'https://cas.univ-avignon.fr', name: 'cas-fixture' });
      if (cookies.length !== 1 || cookies[0].value !== 'unchanged') throw new Error('CAS fixture cookie modified');
      totalPosts += posts;
    } finally {
      controller.clear(); window.destroy();
      isolatedSession.protocol.unhandle('https');
      await isolatedSession.clearStorageData();
    }
  }
  if (totalPosts) throw new Error('Unexpected CAS fixture submissions');
}
module.exports = { run };
