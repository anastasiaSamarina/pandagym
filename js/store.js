// Хранилище на устройстве: все данные лежат в IndexedDB браузера и сразу доступны без сети.
// Excel-файл в GitHub — это "облачная копия" (см. sync.js). Приложение работает и без неё.

import { emptyDb, latestCycle } from './model.js';
import { debounce, nowISO } from './util.js';

export const state = {
  db: emptyDb(),
  // настройки ЭТОГО устройства (не попадают в Excel): доступ к GitHub, тема
  device: { gh: { owner: '', repo: '', branch: 'main', path: 'data/gym.json' }, token: '', sha: '', syncedRev: -1, lastSync: '', theme: 'auto' },
  sync: { state: 'off', msg: '' }, // off | idle | pending | syncing | offline | error
};
export const hooks = { requestSync: () => {} }; // подставляется из sync.js

const subs = new Set();
/** kind: 'sync' — изменился статус синхронизации, 'data' — данные заменены извне (после синка/импорта) */
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const notify = (kind = 'data') => subs.forEach((f) => f(kind));

// ---------- IndexedDB ----------
let dbPromise;
function openIdb() {
  if (!dbPromise) dbPromise = new Promise((res, rej) => {
    const rq = indexedDB.open('gym', 1);
    rq.onupgradeneeded = () => { rq.result.createObjectStore('kv'); rq.result.createObjectStore('media'); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return dbPromise;
}
async function idbOp(store, mode, fn) {
  const db = await openIdb();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, mode);
    const out = fn(tx.objectStore(store));
    tx.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    tx.onerror = () => rej(tx.error);
  });
}

export function normalizeDb(d) { return normalize(d); }
function normalize(d) {
  const base = emptyDb();
  const db = { ...base, ...d, settings: { ...base.settings, ...(d.settings || {}) } };
  for (const k of ['exercises', 'workouts', 'measures', 'deleted', 'importLog']) if (!Array.isArray(db[k])) db[k] = [];
  // пока цикл не выбран вручную, «текущий» = цикл самой свежей тренировки
  if (!db.settings.cycleSet) { const c = latestCycle(db); if (c) db.settings.currentCycle = c; }
  return db;
}

export async function load() {
  try { const d = await idbOp('kv', 'readonly', (s) => s.get('data')); if (d) state.db = normalize(d); } catch (e) { console.warn('IndexedDB недоступна', e); }
  try { const dev = JSON.parse(localStorage.getItem('gym.device') || 'null'); if (dev) state.device = { ...state.device, ...dev, gh: { ...state.device.gh, ...(dev.gh || {}) } }; } catch { /* нет доступа к localStorage */ }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* не критично */ }
}
export function saveDevice() { try { localStorage.setItem('gym.device', JSON.stringify(state.device)); } catch { /* ignore */ } }

export const persistNow = () => idbOp('kv', 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(state.db)), 'data')).catch((e) => console.warn('save failed', e));
const persistSoon = debounce(persistNow, 300);
addEventListener('pagehide', persistNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistNow(); });

// ---------- изменения ----------
/** Любая правка данных: помечаем, сохраняем на устройстве, просим синк */
export function markChanged() { state.db.rev++; persistSoon(); hooks.requestSync(); }
/** Тренировка изменена: обновить метку времени (по ней синк решает, чья версия новее) */
export function touch(w) { if (w) w.updated = nowISO(); markChanged(); }
export function change(fn) { fn(state.db); markChanged(); }
/** Заменить всю базу (импорт / после синка) */
export function replaceDb(db) { state.db = normalize(db); state.db.rev = (state.db.rev || 0) + 1; persistNow(); notify('data'); hooks.requestSync(); }

export function deleteWorkout(id) {
  const db = state.db;
  db.workouts = db.workouts.filter((w) => w.id !== id);
  db.deleted.push({ id, at: nowISO() });
  markChanged();
}

// ---------- медиа (картинки, гифки) ----------
export const putMedia = (id, blob, uploaded = false) => idbOp('media', 'readwrite', (s) => s.put({ blob, uploaded }, id));
export const getMedia = (id) => idbOp('media', 'readonly', (s) => s.get(id)).catch(() => undefined);
export async function pendingMedia() {
  const all = [];
  await idbOp('media', 'readonly', (s) => { const rq = s.openCursor(); rq.onsuccess = () => { const c = rq.result; if (c) { if (!c.value.uploaded) all.push(c.key); c.continue(); } }; return rq; });
  return all;
}
export async function markUploaded(id) { const m = await getMedia(id); if (m) await putMedia(id, m.blob, true); }
