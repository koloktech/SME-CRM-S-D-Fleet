(function () {
  'use strict';
  const config = window.SD_CONFIG || {};
  const rootPath = (() => {
    const script = document.currentScript || [...document.scripts].find(s => s.src.includes('/js/app.js'));
    return script ? new URL('../', script.src).pathname : '/';
  })();
  const money = value => new Intl.NumberFormat('en-MY', { style: 'currency', currency: config.CURRENCY || 'MYR' }).format(Number(value || 0));
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const api = async (action, data = {}, method = 'POST') => {
    if (!config.API_URL) throw new Error('API is not configured yet. Add your Apps Script URL in config.js.');
    const token = localStorage.getItem('sd_admin_token') || '';
    let response;
    if (method === 'GET') {
      const query = new URLSearchParams({ action, token, ...data });
      response = await fetch(`${config.API_URL}?${query}`, { redirect: 'follow' });
    } else {
      // text/plain avoids a CORS preflight, which Apps Script web apps do not handle.
      response = await fetch(config.API_URL, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token, ...data }) });
    }
    if (!response.ok) throw new Error(`API request failed (${response.status}).`);
    const result = await response.json();
    if (!result.success) {
      const error = new Error(result.message || 'Something went wrong.');
      error.code = result.code;
      if (result.code === 'UNAUTHORIZED' && location.pathname.includes('/admin/') && !location.pathname.endsWith('/admin/')) window.SDAuth?.logout();
      throw error;
    }
    return result.data;
  };
  const toast = (message, type = 'info') => {
    const root = document.getElementById('toast-root') || document.body.appendChild(Object.assign(document.createElement('div'), { id:'toast-root', className:'toast-root' }));
    const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = message; root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show')); setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 3800);
  };
  const dateOnly = value => { if (!value) return '—'; const d = new Date(`${String(value).slice(0,10)}T00:00:00`); return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-MY', { day:'2-digit', month:'short', year:'numeric' }); };
  const loading = (button, on, label = 'Please wait…') => { if (!button) return; if (on) { button.dataset.label = button.innerHTML; button.disabled = true; button.innerHTML = `<span class="spinner"></span>${label}`; } else { button.disabled = false; button.innerHTML = button.dataset.label || label; } };
  window.SD = { config, rootPath, api, money, esc, toast, dateOnly, loading };
  document.querySelector('#year')?.append(new Date().getFullYear());
  document.querySelector('.mobile-nav')?.addEventListener('click', () => document.querySelector('.public-nav nav')?.classList.toggle('open'));
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register(`${rootPath}service-worker.js`).catch(() => {});
})();
