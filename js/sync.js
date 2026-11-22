// Синхронизация с GitHub через обычное API (api.github.com), без своего сервера.
// Что происходит: скачиваем workouts.xlsx из ПРИВАТНОГО репозитория с данными → сливаем с локальными
// данными (mergeDb) → если есть что отправить, коммитим обновлённый xlsx обратно.
// Токен хранится только в этом браузере (localStorage) и никогда не попадает в Excel и в код.

import { state, hooks, notify, persistNow, saveDevice, getMedia, putMedia, pendingMedia, markUploaded, normalizeDb } from './store.js';
import { dbToXlsx, parseAppFormat, readXlsx } from './excel-io.js';
import { mergeDb } from './model.js';
import { debounce, nowISO } from './util.js';

// ---------- журнал синхронизации (хранится только на этом устройстве) ----------
const LOG_KEY = 'gym.synclog';
export function getSyncLog() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; } }
export function clearSyncLog() { try { localStorage.removeItem(LOG_KEY); } catch { /* ignore */ } }
export function logSync(level, msg) {
  try { const l = getSyncLog(); l.push({ t: nowISO(), level, msg: String(msg).slice(0, 400) }); localStorage.setItem(LOG_KEY, JSON.stringify(l.slice(-120))); } catch { /* ignore */ }
}

const API = 'https://api.github.com';
export const isConfigured = () => !!(state.device.token && state.device.gh.owner && state.device.gh.repo);

function setSync(s, msg = '') { state.sync = { state: s, msg }; notify('sync'); }

function toB64(bytes) {
  let s = ''; const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64) {
  const bin = atob(b64.replace(/\s/g, '')); const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

class SyncError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

async function api(path, init = {}) {
  let r;
  try {
    r = await fetch(API + path, { ...init, cache: 'no-store', headers: { Authorization: 'Bearer ' + state.device.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers || {}) } });
  } catch (e) { logSync('error', `${init.method || 'GET'} ${path}: запрос не дошёл — ${e && e.name}: ${e && e.message}`); throw new SyncError(`Нет связи с GitHub (${(e && e.message) || 'запрос не прошёл'})`, 0); }
  return r;
}
/** Что именно ответил GitHub (его текст ошибки сильно помогает искать причину) */
async function why(r) { try { const j = await r.clone().json(); return j.message || ''; } catch { return ''; } }
function explain(r) {
  if (r.status === 401) return 'GitHub не принял токен (неверный или истёк). Создай новый токен в Настройках.';
  if (r.status === 403) return 'Нет прав: у токена должно быть право Contents → Read and write на репозиторий с данными.';
  if (r.status === 404) return 'Репозиторий или файл не найден. Проверь владельца, имя репозитория и доступ токена.';
  return `GitHub вернул ошибку ${r.status}`;
}
const gh = () => state.device.gh;
const fileUrl = (p) => `/repos/${gh().owner}/${gh().repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}`;
const ref = () => `?ref=${encodeURIComponent(gh().branch || 'main')}`;

async function getFile(path) {
  const r = await api(fileUrl(path) + ref());
  logSync('info', `GET ${path} → ${r.status}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new SyncError(`${explain(r)} (${await why(r)})`, r.status);
  const j = await r.json();
  let bytes;
  if (j.content) bytes = fromB64(j.content);
  else { // файлы больше 1 МБ отдаются отдельным запросом
    const rr = await api(fileUrl(path) + ref(), { headers: { Accept: 'application/vnd.github.raw+json' } });
    if (!rr.ok) throw new SyncError(explain(rr), rr.status);
    bytes = new Uint8Array(await rr.arrayBuffer());
  }
  return { sha: j.sha, bytes };
}

async function putFile(path, bytes, sha, message) {
  const body = { message, content: toB64(bytes), branch: gh().branch || 'main' };
  if (sha) body.sha = sha;
  const r = await api(fileUrl(path), { method: 'PUT', body: JSON.stringify(body) });
  const msg = r.ok ? '' : await why(r);
  logSync(r.ok ? 'info' : 'warn', `PUT ${path} (sha ${sha ? sha.slice(0, 7) : 'нет'}) → ${r.status} ${msg}`);
  // 409 — файл успели изменить; 422 с упоминанием sha — мы не знали, что файл уже есть. Оба случая лечатся повторным чтением.
  if (r.status === 409 || (r.status === 422 && /sha/i.test(msg))) throw new SyncError('conflict', r.status);
  if (!r.ok) throw new SyncError(`${explain(r)} (${msg})`, r.status);
  return (await r.json()).content.sha;
}

/** Проверка настроек: репозиторий виден, токен подходит */
export async function testConnection() {
  const r = await api(`/repos/${gh().owner}/${gh().repo}`);
  if (!r.ok) throw new SyncError(explain(r), r.status);
  const j = await r.json();
  return { private: j.private, canPush: !!(j.permissions && j.permissions.push) };
}

// Формат файла выбирается по расширению: .json — всё содержимое приложения (рекомендуется), .xlsx — таблица Excel
const isJson = () => /\.json$/i.test(gh().path || '');
async function decodeRemote(bytes) {
  if (isJson()) return { db: normalizeDb(JSON.parse(new TextDecoder().decode(bytes))) };
  return parseAppFormat(await readXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
}
async function encodeLocal() {
  if (isJson()) return new TextEncoder().encode(JSON.stringify({ ...state.db, importLog: [] }));
  return new Uint8Array(await (await dbToXlsx(state.db)).arrayBuffer());
}

let running = null, again = false;
export function syncNow() {
  if (running) { again = true; return running; }
  running = doSync().finally(() => { running = null; if (again) { again = false; setTimeout(() => syncNow().catch(() => {}), 500); } });
  return running;
}

async function doSync() {
  if (!isConfigured()) { setSync('off'); return; }
  // navigator.onLine на телефонах бывает ложно «false» (VPN, экономия трафика) — поэтому просто пробуем, а о связи судим по ответу
  if (navigator.onLine === false) logSync('warn', 'Браузер считает, что связи нет (navigator.onLine=false), но всё равно пробуем');
  setSync('syncing');
  try {
    logSync('info', `Синхронизация: ${isJson() ? 'JSON' : 'Excel'}, локально тренировок ${state.db.workouts.length}`);
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 700 * attempt));
      const remote = await getFile(gh().path);
      let changedFromRemote = false;
      if (remote) {
        let parsed = null;
        try { parsed = await decodeRemote(remote.bytes); } catch (e) { logSync('error', `Файл в репозитории не читается: ${e.message}`); throw new SyncError('Файл в репозитории не читается — это точно файл приложения? Проверь путь в настройках.', 0); }
        if (parsed) {
          const before = JSON.stringify([state.db.workouts, state.db.measures, state.db.exercises]);
          const merged = mergeDb(state.db, parsed.db);
          Object.assign(state.db, merged); // на месте, чтобы открытые экраны не потеряли ссылку на db
          changedFromRemote = before !== JSON.stringify([state.db.workouts, state.db.measures, state.db.exercises]);
        }
      }
      const dirty = state.db.rev !== state.device.syncedRev;
      if (!remote || dirty) {
        const revAtStart = state.db.rev;
        const bytes = await encodeLocal();
        try {
          state.device.sha = await putFile(gh().path, bytes, remote && remote.sha, `Тренировки: синхронизация ${nowISO().slice(0, 16).replace('T', ' ')}`);
        } catch (e) { if (e.message === 'conflict') { logSync('warn', `Конфликт, попытка ${attempt + 1} из 5`); continue; } throw e; } // файл изменился, пока мы работали — читаем заново и сливаем
        state.device.syncedRev = revAtStart;
      } else { state.device.sha = remote.sha; state.device.syncedRev = state.db.rev; }
      await uploadMedia();
      state.device.lastSync = nowISO();
      saveDevice(); await persistNow();
      setSync('idle');
      logSync('ok', 'Готово' + (changedFromRemote ? ' (подтянуты изменения с другого устройства)' : ''));
      if (changedFromRemote) notify('data');
      return;
    }
    throw new SyncError('Не удалось отправить изменения: файл в репозитории постоянно меняется. Подробности — в журнале синхронизации.', 409);
  } catch (e) {
    logSync('error', e.message);
    setSync(e.status === 0 ? 'offline' : 'error', e.message);
    throw e;
  }
}

async function uploadMedia() {
  for (const id of await pendingMedia()) {
    const m = await getMedia(id);
    if (!m) continue;
    try { await putFile('media/' + id, new Uint8Array(await m.blob.arrayBuffer()), null, `Медиа ${id}`); await markUploaded(id); }
    catch (e) { if (e.message === 'conflict') await markUploaded(id); else { logSync('error', `Медиа ${id}: ${e.message}`); throw e; } } // файл уже есть
  }
}

/** Картинка по id: сначала локально, иначе скачиваем из репозитория и запоминаем */
export async function mediaUrl(id) {
  let m = await getMedia(id);
  if (!m && isConfigured()) {
    try { const f = await getFile('media/' + id); if (f) { await putMedia(id, new Blob([f.bytes], { type: mimeOf(id) }), true); m = await getMedia(id); } } catch { /* покажем заглушку */ }
  }
  return m ? URL.createObjectURL(m.blob) : null;
}
const mimeOf = (id) => (/\.gif$/i.test(id) ? 'image/gif' : /\.png$/i.test(id) ? 'image/png' : 'image/jpeg');

// ---------- автозапуск ----------
export function startAutoSync() {
  const soon = debounce(() => { if (isConfigured()) syncNow().catch(() => {}); }, 4000);
  hooks.requestSync = () => { if (isConfigured()) { if (state.sync.state !== 'syncing') setSync('pending'); soon(); } };
  addEventListener('online', () => isConfigured() && syncNow().catch(() => {}));
  addEventListener('offline', () => { if (isConfigured()) logSync('warn', 'Браузер сообщил: связь пропала'); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && isConfigured()) syncNow().catch(() => {}); });
  if (isConfigured()) { setSync('idle'); syncNow().catch(() => {}); }
}
