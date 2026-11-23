// Точка входа: загрузка данных, навигация между экранами, статус синхронизации, офлайн-режим.
import { h, toast } from './util.js';
import { icon } from './icons.js';
import { state, load, subscribe, persistNow } from './store.js';
import { startAutoSync, syncNow, isConfigured } from './sync.js';
import { journalView, analyticsView, bodyView } from './view-main.js';
import { workoutView, dropIfEmpty } from './view-workout.js';
import { settingsView, exercisesView, checkView, syncLogView, applyTheme } from './view-settings.js';

const routes = [
  [/^#\/?$/, journalView],
  [/^#\/w\/([^/]+)$/, workoutView],
  [/^#\/calendar$/, journalView],
  [/^#\/analytics(?:\/(.+))?$/, analyticsView],
  [/^#\/body$/, bodyView],
  [/^#\/settings$/, settingsView],
  [/^#\/exercises$/, exercisesView],
  [/^#\/check$/, checkView],
  [/^#\/synclog$/, syncLogView],
];
const NAV = [['#/', 'book', 'Журнал'], ['#/analytics', 'chart', 'Аналитика'], ['#/body', 'ruler', 'Замеры'], ['#/settings', 'gear', 'Настройки']];

const view = document.getElementById('view');
const nav = document.getElementById('nav');
let current = '';
const trail = []; // экраны, по которым прошла пользовательница в этой сессии: «назад» ведёт строго по ним
const scrollAt = new Map(); // запомненная прокрутка по экранам

function render() {
  const hash = location.hash || '#/';
  // уходим с экрана тренировки — пустую тренировку не оставляем
  const left = /^#\/w\/([^/]+)$/.exec(current);
  if (left && current !== hash) dropIfEmpty(left[1]);
  const same = hash === current;
  if (!same) { if (trail.length > 1 && trail[trail.length - 2] === hash) trail.pop(); else trail.push(hash); }
  else if (!trail.length) trail.push(hash);
  if (current) scrollAt.set(current, window.scrollY);
  current = hash;
  const route = routes.find(([re]) => re.test(hash)) || routes[0];
  const args = (route[0].exec(hash) || []).slice(1).map((x) => (x ? decodeURIComponent(x) : x));
  try { view.replaceChildren(route[1](...args)); }
  catch (e) { console.error(e); view.replaceChildren(h('div', { class: 'page' }, h('h2', {}, 'Что-то пошло не так'), h('pre', { class: 'err' }, String(e.stack || e)), h('a', { class: 'btn', href: '#/' }, 'В журнал'))); }
  // тот же экран (обновление данных) — не двигаем; другой — возвращаем туда, где были, иначе вверх
  if (!same) { const y = scrollAt.get(hash) || 0; requestAnimationFrame(() => window.scrollTo(0, y)); }
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', hash === a.getAttribute('href') || (a.getAttribute('href') !== '#/' && hash.startsWith(a.getAttribute('href')))
    || (a.getAttribute('href') === '#/' && (hash === '#/' || hash.startsWith('#/w/'))) || (a.getAttribute('href') === '#/settings' && /#\/(exercises|check|synclog)/.test(hash))));
}

// ---------- статус синхронизации ----------
const badge = h('button', { class: 'sync-badge', onclick: () => { if (!isConfigured()) { location.hash = '#/settings'; return; } if (state.sync.state === 'error') { toast(state.sync.msg || 'Ошибка синхронизации', 6000, { label: 'Журнал', fn: () => { location.hash = '#/synclog'; } }); return; } syncNow().then(() => toast('Синхронизировано')).catch((e) => toast(e.message, 6000, { label: 'Журнал', fn: () => { location.hash = '#/synclog'; } })); } });
function paintBadge() {
  const s = state.sync.state;
  const map = { off: ['', 'не подключена'], idle: ['ok', 'синхронизировано'], pending: ['wait', 'ждёт отправки'], syncing: ['wait', 'синхронизация…'], offline: ['off', 'нет связи'], error: ['err', 'ошибка'] };
  const [cls, text] = map[s] || map.off;
  badge.className = 'sync-badge ' + cls; badge.textContent = '● ' + text; badge.title = state.sync.msg || '';
  badge.hidden = s === 'off' || s === 'idle'; // «синхронизировано» не показываем — важно только когда что-то отправляется или не получилось
}

// ---------- потянуть вниз для обновления ----------
function pullToRefresh() {
  let y0 = null, ready = false;
  const bar = h('div', { class: 'ptr' }, 'Потяни, чтобы обновить');
  document.body.append(bar);
  addEventListener('touchstart', (e) => { y0 = window.scrollY === 0 && !/^#\/w\//.test(location.hash) ? e.touches[0].clientY : null; ready = false; }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    const d = e.touches[0].clientY - y0;
    if (d > 10) { bar.style.transform = `translateY(${Math.min(d, 90) - 50}px)`; ready = d > 80; bar.textContent = ready ? 'Отпусти для обновления' : 'Потяни, чтобы обновить'; }
  }, { passive: true });
  addEventListener('touchend', async () => {
    if (y0 === null) return;
    bar.style.transform = ''; y0 = null;
    if (!ready) return;
    if (!isConfigured()) { toast('Синхронизация не подключена (Настройки)'); return; }
    try { await syncNow(); toast('Обновлено'); } catch (e) { toast(e.message, 5000); }
  });
}

async function boot() {
  nav.append(...NAV.map(([href, ico, label]) => h('a', { href }, h('span', { class: 'ico-n' }, icon(ico)), h('span', {}, label))), badge);
  await load();
  applyTheme();
  subscribe((kind) => { if (kind === 'sync') paintBadge(); else if (kind === 'data' && !/^#\/w\//.test(location.hash)) render(); });
  addEventListener('app:refresh', render);
  addEventListener('hashchange', render);
  // стрелка «назад» на экранах: возвращает на предыдущий экран, а не на «родительский»; если истории нет — ведёт по ссылке
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a.back');
    if (a && trail.length > 1 && !e.defaultPrevented && !e.metaKey && !e.ctrlKey) { e.preventDefault(); history.back(); }
  });
  startAutoSync();
  paintBadge();
  render();
  pullToRefresh();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  window.__gym = { state, persistNow }; // удобно для отладки в консоли
}
boot();
