// Таймер для интервальных тренировок (табата и т.п.): подготовка → работа/отдых × раунды.
// Звуки — через WebAudio (без файлов), экран не гаснет (Wake Lock, где поддерживается).
import { h } from './util.js';

function beep(freq = 880, ms = 140) {
  try {
    const ctx = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq; g.gain.value = 0.15;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + ms / 1000);
  } catch { /* звук необязателен */ }
  try { navigator.vibrate && navigator.vibrate(ms); } catch { /* ignore */ }
}

export function openTimer({ title = 'Таймер', work = 20, rest = 10, rounds = 8, moves = [], prepare = 10 }) {
  // список фаз
  const phases = [{ kind: 'prep', sec: prepare, label: 'Приготовься' }];
  for (let r = 1; r <= rounds; r++) {
    phases.push({ kind: 'work', sec: work, label: 'Работа', round: r, move: moves.length ? moves[(r - 1) % moves.length] : '' });
    if (rest > 0 && r < rounds) phases.push({ kind: 'rest', sec: rest, label: 'Отдых', round: r, move: moves.length ? 'Дальше: ' + moves[r % moves.length] : '' });
  }
  let i = 0, left = phases[0].sec, paused = false, lock = null, timerId;
  const big = h('div', { class: 'timer-big' });
  const label = h('div', { class: 'timer-label' });
  const sub = h('div', { class: 'timer-sub' });
  const total = h('div', { class: 'timer-total' });
  const wrap = h('div', { class: 'timer prep' },
    h('div', { class: 'timer-title' }, title), label, big, sub, total,
    h('div', { class: 'row center' },
      h('button', { class: 'btn', onclick: () => { paused = !paused; pauseBtn.textContent = paused ? '▶ Продолжить' : '⏸ Пауза'; } }, ''),
      h('button', { class: 'btn', onclick: () => next() }, 'Пропустить ⏭'),
      h('button', { class: 'btn danger', onclick: close }, 'Закрыть')));
  const pauseBtn = wrap.querySelector('.btn');
  pauseBtn.textContent = '⏸ Пауза';
  document.body.append(wrap);

  const remaining = () => phases.slice(i).reduce((a, p) => a + p.sec, 0) - (phases[i].sec - left);
  function paint() {
    const p = phases[i];
    wrap.className = 'timer ' + p.kind;
    label.textContent = p.label + (p.round ? ` · раунд ${p.round}/${rounds}` : '');
    big.textContent = left;
    sub.textContent = p.move || '';
    const m = Math.floor(Math.max(0, remaining()) / 60), s = Math.max(0, remaining()) % 60;
    total.textContent = `Осталось всего ${m}:${String(s).padStart(2, '0')}`;
  }
  function next() {
    i++;
    if (i >= phases.length) { beep(660, 600); label.textContent = 'Готово!'; big.textContent = '✓'; sub.textContent = ''; clearInterval(timerId); return; }
    left = phases[i].sec; beep(phases[i].kind === 'work' ? 1000 : 600, 300); paint();
  }
  function close() { clearInterval(timerId); wrap.remove(); if (lock) lock.release().catch(() => {}); }
  timerId = setInterval(() => {
    if (paused || i >= phases.length) return;
    left--;
    if (left <= 3 && left > 0) beep(800, 80);
    if (left <= 0) next(); else paint();
  }, 1000);
  try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => {}); } catch { /* ignore */ }
  paint();
}
