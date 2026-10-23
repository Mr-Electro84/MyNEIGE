'use strict';
// Sandboxed, isolated preload. No contextBridge or IPC API is exposed to the site.
const { ipcRenderer } = require('electron');
(() => {
  if (!process.isMainFrame || window.top !== window) return;
  function trustedDocument() {
    try {
      const url = new URL(location.href);
      const services = url.searchParams.getAll('service');
      if (url.origin !== 'https://cas.univ-avignon.fr' || url.pathname !== '/cas/login' ||
          url.username || url.password || url.hash || services.length !== 1) return false;
      const service = new URL(services[0]);
      return service.origin === 'https://www.appigs.univ-avignon.fr' && !service.username && !service.password && !service.hash;
    } catch { return false; }
  }
  function fields() {
    try {
      if (!trustedDocument()) return null;
      const forms = document.querySelectorAll('form#fm1');
      if (forms.length !== 1) return null;
      const form = forms[0];
      const action = new URL(form.action);
      if (form.method.toLowerCase() !== 'post' || action.origin !== 'https://cas.univ-avignon.fr' ||
          action.pathname !== '/cas/login' || action.username || action.password || action.hash || form.target) return null;
      const actionServices = action.searchParams.getAll('service');
      if (actionServices.length && (actionServices.length !== 1 || actionServices[0] !== new URL(location.href).searchParams.get('service'))) return null;
      const one = selector => { const nodes = form.querySelectorAll(selector); return nodes.length === 1 && nodes[0].form === form ? nodes[0] : null; };
      const user = one('input#username[name="username"]');
      const password = one('input#password[name="password"]');
      const execution = one('input[type="hidden"][name="execution"]');
      const event = one('input[type="hidden"][name="_eventId"]');
      if (!user || !password || user.type !== 'text' || password.type !== 'password' ||
          user.disabled || password.disabled || user.readOnly || password.readOnly ||
          !execution?.value || execution.value.length > 32768 || event?.value !== 'submit') return null;
      for (const node of [user, password, execution, event]) {
        if (form.elements.namedItem(node.name) !== node) return null;
      }
      // Submitter attributes can override the form's target/action/method.
      for (const button of form.querySelectorAll('button,input[type="submit"],input[type="image"]')) {
        if (['formaction', 'formmethod', 'formtarget', 'formenctype'].some(name => button.hasAttribute(name))) return null;
      }
      return { form, user, password, execution, event };
    } catch { return null; }
  }
  async function fill() {
    if (!trustedDocument()) return;
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, '0')).join('');
    const report = status => ipcRenderer.send('myneige:cas-result', { status, nonce });
    let nodes = fields();
    if (!nodes) { report('UNSUPPORTED'); return; }
    if (nodes.user.value || nodes.password.value) { report('SKIPPED'); return; }
    const snapshot = { url: location.href, action: nodes.form.action, execution: nodes.execution.value, event: nodes.event.value };
    let credentials;
    try {
      credentials = await ipcRenderer.invoke('myneige:cas-prefill', nonce);
      const current = fields();
      if (!credentials) { report('UNAVAILABLE'); return; }
      if (!current || credentials.nonce !== nonce || location.href !== snapshot.url || current.form !== nodes.form ||
          current.user !== nodes.user || current.password !== nodes.password || current.form.action !== snapshot.action ||
          current.execution.value !== snapshot.execution || current.event.value !== snapshot.event) { report('UNSUPPORTED'); return; }
      if (current.user.value || current.password.value) { report('SKIPPED'); return; }
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setValue.call(current.user, credentials.username);
      setValue.call(current.password, credentials.password);
      // Setting .value does not dispatch input/change, click or submit. CAS keeps
      // its live hidden fields, cookie jar and normal manual submit listeners.
      current.form.addEventListener('submit', event => {
        if (!fields()) { event.preventDefault(); setValue.call(current.user, ''); setValue.call(current.password, ''); }
      }, true);
      window.addEventListener('pagehide', () => {
        setValue.call(current.user, ''); setValue.call(current.password, '');
      }, { once: true });
      report('PREFILLED');
    } catch { report('UNAVAILABLE'); }
    finally {
      if (credentials) { credentials.username = ''; credentials.password = ''; }
      credentials = undefined; nodes = undefined;
    }
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', fill, { once: true });
  else void fill();
})();
