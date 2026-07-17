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
  const normalizeImageUrl = value => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
      if (url.hostname === 'drive.google.com') {
        const match = url.pathname.match(/\/file\/d\/([^/]+)/);
        const id = (match && match[1]) || url.searchParams.get('id');
        if (id) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1600`;
      }
      return url.href;
    } catch { return ''; }
  };
  const hydrateLandingFleet = async () => {
    const cards = [...document.querySelectorAll('.fleet-card[data-vehicle-id]')];
    if (!cards.length || !config.API_URL) return;
    try {
      const vehicles = await api('GET_VEHICLES', { public: '1' }, 'GET');
      cards.forEach(card => {
        const vehicle = vehicles.find(item => String(item.vehicleId || '').trim() === card.dataset.vehicleId);
        if (!vehicle) return;
        const setText = (field, value) => { const el = card.querySelector(`[data-fleet-field="${field}"]`); if (el) el.textContent = value; };
        setText('name', vehicle.vehicleName);
        setText('capacity', `${vehicle.capacity} passengers`);
        setText('rate', `${money(vehicle.dailyRate).replace('.00', '')}/day`);
        const status = card.querySelector('[data-fleet-field="status"]');
        if (status) {
          status.textContent = vehicle.status;
          status.className = `pill ${String(vehicle.status).trim().toLowerCase() === 'available' ? 'success' : 'danger'}`;
        }
        const link = card.querySelector('[data-fleet-field="booking-link"]');
        if (link) {
          link.href = `booking/?vehicle=${encodeURIComponent(vehicle.vehicleId)}`;
          link.textContent = String(vehicle.status).trim().toLowerCase() === 'available' ? 'Choose vehicle' : 'Currently unavailable';
          link.classList.toggle('disabled', String(vehicle.status).trim().toLowerCase() !== 'available');
        }
        const src = normalizeImageUrl(vehicle.imageUrl);
        const frame = card.querySelector('.fleet-image');
        const fallback = frame?.querySelector('.fleet-fallback');
        if (src && frame && fallback) {
          const img = document.createElement('img');
          img.className = 'fleet-photo';
          img.alt = vehicle.vehicleName;
          img.onload = () => { fallback.hidden = true; frame.classList.add('has-photo'); };
          img.onerror = () => { img.remove(); fallback.hidden = false; frame.classList.remove('has-photo'); };
          img.src = src;
          frame.prepend(img);
        }
      });
    } catch (error) { console.warn('Unable to refresh homepage fleet.', error); }
  };
  window.SD = { config, rootPath, api, money, esc, toast, dateOnly, loading, normalizeImageUrl };
  document.querySelector('#year')?.append(new Date().getFullYear());
  hydrateLandingFleet();
  document.querySelector('.mobile-nav')?.addEventListener('click', () => document.querySelector('.public-nav nav')?.classList.toggle('open'));
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register(`${rootPath}service-worker.js`).catch(() => {});
})();
