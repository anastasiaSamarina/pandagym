// Таймер отдыха между подходами: плашка снизу, звук и вибрация по окончании.
// Звук играет только если страница его разрешает (после нажатия на кнопку — разрешает) и экран телефона не заблокирован.
import { h } from './util.js';
import { icon } from './icons.js';
import { state, saveDevice } from './store.js';

let ctx = null;
function audio() {
  try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch { ctx = null; }
  return ctx;
}
export function beep(freq = 880, ms = 160, vol = 0.25, at = 0) {
  const c = audio(); if (!c) return;
  try {
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + at;
    o.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + ms / 1000 + 0.02);
  } catch { /* звук необязателен */ }
}
export const soundOn = () => state.device.restSound !== false;
export function setSound(v) { state.device.restSound = !!v; saveDevice(); }

// ---------- работа в фоне ----------
// Браузер усыпляет страницу, когда уходишь из приложения, и таймер встаёт. Пока идёт отдых, мы «играем» беззвучную дорожку:
// телефон считает это проигрыванием медиа и не замораживает страницу; по окончании этим же плеером играет сигнал.
function wavUrl(samples, sr) {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  samples.forEach((x, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 32767, true));
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
const SR = 22050;
let silenceUrl = null, alarmUrl = null;
function sounds() {
  if (!silenceUrl) silenceUrl = wavUrl(new Float32Array(SR), SR); // 1 секунда тишины
  if (!alarmUrl) {
    const tone = (f, d) => Array.from({ length: Math.round(SR * d) }, (_, i) => Math.sin((2 * Math.PI * f * i) / SR) * 0.5 * Math.min(1, (SR * d - i) / 800, i / 200 + 0.01));
    const gap = (d) => new Array(Math.round(SR * d)).fill(0);
    alarmUrl = wavUrl(Float32Array.from([...tone(988, 0.2), ...gap(0.1), ...tone(988, 0.2), ...gap(0.1), ...tone(1318, 0.45)]), SR);
  }
}
let keep = null;
export const keepAliveOn = () => !!state.device.restKeepAlive;
export function setKeepAlive(v) { state.device.restKeepAlive = !!v; saveDevice(); }
function keepAlive(label) {
  // По умолчанию выключено: беззвучная дорожка заставляет телефон «перехватывать» звук у музыки и приглушать её.
  if (!soundOn() || !keepAliveOn()) return;
  try {
    sounds();
    keep = new Audio(silenceUrl); keep.loop = true; keep.volume = 0.05; keep.play().catch(() => { keep = null; });
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: label, artist: 'Отдых между подходами' });
      navigator.mediaSession.setActionHandler('pause', () => stopRest());
      navigator.mediaSession.setActionHandler('stop', () => stopRest());
    }
  } catch { keep = null; }
}
function setMediaTitle(t) { try { if ('mediaSession' in navigator && keep) navigator.mediaSession.metadata = new MediaMetadata({ title: t, artist: 'Отдых между подходами' }); } catch { /* ignore */ } }
async function ring() {
  let played = false;
  if (keep && soundOn()) { try { keep.loop = false; keep.src = alarmUrl; keep.volume = 1; await keep.play(); played = true; } catch { /* попробуем WebAudio */ } }
  if (!played && soundOn()) { beep(988, 200, 0.3); beep(988, 200, 0.3, 0.28); beep(1318, 380, 0.3, 0.56); }
  try { navigator.vibrate && navigator.vibrate([250, 120, 250, 120, 400]); } catch { /* ignore */ }
  if (!keep) setTimeout(releaseAudio, 1500);
  // уведомление, если ушли из приложения (разрешение спрашиваем при первом запуске)
  try {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker.ready; reg.showNotification('Отдых закончился', { body: 'Пора на следующий подход', tag: 'rest', vibrate: [250, 120, 250] });
    }
  } catch { /* ignore */ }
}
function askNotify() {
  try { if ('Notification' in window && Notification.permission === 'default' && !state.device.askedNotify) { state.device.askedNotify = true; saveDevice(); Notification.requestPermission(); } } catch { /* ignore */ }
}

/** Освободить звук: музыка у телефона возвращается к обычной громкости */
function releaseAudio() { try { if (ctx && ctx.state === 'running') ctx.suspend(); } catch { /* ignore */ } }
let bar = null, tick = null, endAt = 0, done = false, lock = null;
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function stopRest() {
  clearInterval(tick); tick = null;
  if (bar) { bar.remove(); bar = null; }
  try { lock && lock.release(); } catch { /* ignore */ } lock = null;
  if (keep) { try { keep.pause(); keep.removeAttribute('src'); keep.load(); } catch { /* ignore */ } keep = null; }
  try { if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; ['pause', 'stop'].forEach((a) => navigator.mediaSession.setActionHandler(a, null)); } } catch { /* ignore */ }
  releaseAudio();
}
export function startRest(sec) {
  stopRest();
  audio(); // «разбудить» звук прямо в обработчике нажатия — иначе браузер его не разрешит
  keepAlive('Отдых'); askNotify();
  endAt = Date.now() + sec * 1000; done = false;
  const time = h('b', { class: 'rest-time' }), label = h('span', { class: 'rest-label' }, 'Отдых');
  bar = h('div', { class: 'rest-bar', role: 'timer' }, label, time,
    h('button', { class: 'btn rest-x', 'aria-label': 'Остановить отдых', onclick: stopRest }, icon('x')));
  document.body.append(bar);
  try { navigator.wakeLock && navigator.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => {}); } catch { /* ignore */ }
  const paint = () => {
    const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    time.textContent = fmt(left); if (left > 0 && time.dataset.s !== String(left)) setMediaTitle(`Отдых ${fmt(left)}`);
    if (left <= 3 && left > 0 && soundOn() && time.dataset.s !== String(left)) beep(660, 90, 0.15);
    time.dataset.s = String(left);
    if (left === 0 && !done) {
      done = true; bar.classList.add('done'); label.textContent = 'Пора!';
      setMediaTitle('Пора на подход!'); ring();
      setTimeout(() => { if (bar && done) stopRest(); }, 15000);
    }
  };
  paint(); tick = setInterval(paint, 250);
}

// вернулись в приложение — сразу обновить время, не дожидаясь следующего «тика»
document.addEventListener('visibilitychange', () => { if (bar && !document.hidden) { try { audio(); } catch { /* ignore */ } } });
