// Мелкие утилиты: создание DOM, даты, форматирование чисел, окна.

/** h('div', {class:'x', onclick: fn}, 'текст', child, [child2, ...]) → DOM-элемент */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  let late; // value ставим после добавления детей (нужно для <select>)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') late = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  if (late !== undefined) el.value = late;
  return el;
}

/** Как el.append, но пропускает null/false (обычный append печатает "null") */
export function put(el, ...kids) {
  for (const k of kids.flat(Infinity)) { if (k === null || k === undefined || k === false) continue; el.append(k.nodeType ? k : document.createTextNode(String(k))); }
  return el;
}

export const svg = (tag, attrs, ...kids) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kids.flat(Infinity)) if (k) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
};

// ---------- даты (всегда строки 'YYYY-MM-DD', без часовых поясов) ----------
export const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => isoDate(new Date());
export const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseISO(s));
export const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return isoDate(d); };
export const weekdayIdx = (s) => (parseISO(s).getDay() + 6) % 7; // Пн=0 … Вс=6
export const weekStart = (s) => addDays(s, -weekdayIdx(s));
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
export const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export function fmtDate(s, withWeekday = true) {
  if (!isISO(s)) return s || 'без даты';
  const d = parseISO(s);
  return `${withWeekday ? WD[weekdayIdx(s)] + ', ' : ''}${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`;
}
export const fmtShort = (s) => (isISO(s) ? `${pad(parseISO(s).getDate())}.${pad(parseISO(s).getMonth() + 1)}` : s);
/** Перерисовать текущий экран (после импорта, смены настроек и т.п.) */
export const refresh = () => window.dispatchEvent(new Event('app:refresh'));
export const nowISO = () => new Date().toISOString();

// ---------- числа ----------
/** Число для экрана: 13.75 → "13,75"; строки ("14-16") как есть */
export function fmtNum(x) {
  if (x === null || x === undefined || x === '') return '';
  if (typeof x === 'number') return String(Math.round(x * 100) / 100).replace('.', ',');
  return String(x);
}
/** Из поля ввода: "12,5" → 12.5, "14-16" → "14-16", "" → null */
export function parseInput(s) {
  s = String(s ?? '').trim();
  if (s === '') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : s;
}
export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- окна и сообщения ----------
export function toast(msg, ms = 2600, action = null) {
  const t = document.getElementById('toast');
  t.replaceChildren(msg);
  if (action) t.append(h('button', { class: 'toast-act', onclick: () => { t.classList.remove('show'); action.fn(); } }, action.label));
  t.classList.toggle('act', !!action);
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
/** plural(2, ['круг','круга','кругов']) → 'круга' */
export const plural = (n, f) => { n = Math.abs(n) % 100; const d = n % 10; return n > 10 && n < 20 ? f[2] : d > 1 && d < 5 ? f[1] : d === 1 ? f[0] : f[2]; };

/** Стек шторок: системная кнопка «назад» сначала закрывает верхнюю шторку. */
const mstack = [];
let mseq = 0, skipPop = 0;
let afterBack = null; // переход, который ждёт завершения «назад» после закрытия шторки
addEventListener('popstate', () => {
  if (skipPop > 0) { skipPop--; if (!skipPop && afterBack) { const f = afterBack; afterBack = null; f(); } return; }
  const top = mstack[mstack.length - 1];
  if (top) top.fromPop();
});

/** Перейти на другой экран; если только что закрыли шторку — дождаться, пока браузер закончит «назад» (иначе он откатит переход). */
export function goto(hash) {
  if (skipPop > 0) afterBack = () => { location.hash = hash; };
  else location.hash = hash;
}

/** modal(close => элемент, onClose?) → close() */
export function modal(build, onClose) {
  const back = h('div', { class: 'modal-back' });
  const box = h('div', { class: 'modal' });
  const id = ++mseq;
  let closed = false;
  const esc = (e) => { if (e.key === 'Escape') close(); };
  function cleanup() {
    if (closed) return false;
    closed = true;
    const i = mstack.findIndex((m) => m.id === id); if (i >= 0) mstack.splice(i, 1);
    back.remove(); document.removeEventListener('keydown', esc);
    if (!mstack.length) document.documentElement.classList.remove('modal-open');
    onClose && onClose();
    return true;
  }
  function close() {
    if (!cleanup()) return;
    // убрать нашу запись из истории, если мы всё ещё на ней
    if (history.state && history.state.modal === id) { skipPop++; history.back(); setTimeout(() => { if (skipPop && afterBack) { const f = afterBack; afterBack = null; skipPop = 0; f(); } }, 600); }
  }
  mstack.push({ id, fromPop: cleanup });
  document.documentElement.classList.add('modal-open'); // страница под шторкой не прокручивается
  try { history.pushState({ modal: id }, ''); } catch { /* ignore */ }
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', esc);
  box.append(build(close));
  back.append(box);
  document.body.append(back);
  return close;
}

export function confirmBox(text, okLabel = 'Да', danger = true) {
  return new Promise((res) => {
    let answered = false;
    const done = (v) => { answered = true; res(v); };
    modal((close) => h('div', {},
      h('p', {}, text),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => { done(false); close(); } }, 'Отмена'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { done(true); close(); } }, okLabel))),
    () => { if (!answered) res(false); });
  });
}

export function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
