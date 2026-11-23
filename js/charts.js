import { icon } from './icons.js';
// Простые SVG-графики без библиотек. Цвета берутся из CSS-переменных (см. css/app.css).
import { svg, h, parseISO, fmtShort, fmtNum, toast } from './util.js';
import { sendCanvas } from './share.js';

const W = 640, H = 280, PAD = { l: 58, r: 16, t: 16, b: 40 };

function niceTicks(min, max, n = 4) {
  if (min === max) { min -= 1; max += 1; }
  const step0 = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = []; for (let v = lo; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/**
 * Линейный график по датам.
 * series: [{ name, cls:'s1'|'s2', points:[{x:'YYYY-MM-DD', y:number, tip?:string}] }]
 */
export function lineChart(series, { unit = '' } = {}) {
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return h('div', { class: 'empty small' }, 'Нет данных');
  const xs = pts.map((p) => parseISO(p.x).getTime()), ys = pts.map((p) => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x0 === x1) { x0 -= 86400000 * 3; x1 += 86400000 * 3; }
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const sx = (t) => PAD.l + ((t - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (v) => H - PAD.b - ((v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', preserveAspectRatio: 'xMidYMid meet' });
  ticks.forEach((t) => {
    root.append(svg('line', { x1: PAD.l, x2: W - PAD.r, y1: sy(t), y2: sy(t), class: 'grid' }));
    root.append(svg('text', { x: PAD.l - 8, y: sy(t) + 6, class: 'axis', 'text-anchor': 'end' }, fmtNum(t)));
  });
  const nx = Math.min(5, new Set(xs).size);
  for (let i = 0; i < nx; i++) {
    const t = nx === 1 ? xs[0] : x0 + ((x1 - x0) * i) / (nx - 1);
    const d = new Date(t);
    root.append(svg('text', { x: sx(t), y: H - 10, class: 'axis', 'text-anchor': i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle' },
      fmtShort(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)));
  }
  series.forEach((s) => {
    const p = s.points.map((q) => [sx(parseISO(q.x).getTime()), sy(q.y)]);
    if (p.length > 1) root.append(svg('polyline', { points: p.map((a) => a.join(',')).join(' '), class: `line ${s.cls || 's1'}` }));
    s.points.forEach((q, i) => root.append(svg('circle', { cx: p[i][0], cy: p[i][1], r: 4, class: `dot ${s.cls || 's1'}` },
      svg('title', {}, `${q.x}: ${fmtNum(q.y)}${unit ? ' ' + unit : ''}${q.tip ? ' — ' + q.tip : ''}`))));
  });
  return root;
}

/** Столбики: items [{label, value, tip}] */
export function barChart(items, { goal = null, maxLabels = 5 } = {}) {
  if (!items.length) return h('div', { class: 'empty small' }, 'Нет данных');
  const max = Math.max(...items.map((i) => i.value), goal || 0, 1);
  const ticks = niceTicks(0, max, 4), top = ticks[ticks.length - 1];
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  const sy = (v) => H - PAD.b - (v / top) * (H - PAD.t - PAD.b);
  ticks.forEach((t) => {
    root.append(svg('line', { x1: PAD.l, x2: W - PAD.r, y1: sy(t), y2: sy(t), class: 'grid' }));
    root.append(svg('text', { x: PAD.l - 8, y: sy(t) + 6, class: 'axis', 'text-anchor': 'end' }, fmtNum(t)));
  });
  const bw = (W - PAD.l - PAD.r) / items.length;
  const every = Math.ceil(items.length / maxLabels);
  items.forEach((it, i) => {
    const x = PAD.l + i * bw + bw * 0.15, w = bw * 0.7;
    const met = goal !== null && it.value >= goal;
    root.append(svg('rect', { x, y: sy(it.value), width: w, height: H - PAD.b - sy(it.value), rx: 3, class: 'bar' + (met ? ' met' : '') }, svg('title', {}, it.tip || `${it.label}: ${fmtNum(it.value)}`)));
    if (i % every === 0) root.append(svg('text', { x: x + w / 2, y: H - 10, class: 'axis', 'text-anchor': 'middle' }, it.label));
  });
  if (goal !== null) root.append(svg('line', { x1: PAD.l, x2: W - PAD.r, y1: sy(goal), y2: sy(goal), class: 'goal' }));
  return root;
}

/** Кольцо прогресса недели */
export function ring(done, goal, size = 72) {
  const r = size / 2 - 7, c = 2 * Math.PI * r, p = Math.min(1, done / Math.max(goal, 1));
  return svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'ring' },
    svg('circle', { cx: size / 2, cy: size / 2, r, class: 'ring-bg' }),
    svg('circle', { cx: size / 2, cy: size / 2, r, class: 'ring-fg' + (done >= goal ? ' met' : ''), 'stroke-dasharray': `${c * p} ${c}`, transform: `rotate(-90 ${size / 2} ${size / 2})` }),
    svg('text', { x: size / 2, y: size / 2 + 5, 'text-anchor': 'middle', class: 'ring-t' }, `${done}/${goal}`));
}

/** Крошечный график тренда для карточки избранного */
export function sparkline(values, w = 110, hgt = 38) {
  const root = svg('svg', { viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, class: 'spark' });
  if (values.length < 2) return root;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => [3 + (i / (values.length - 1)) * (w - 6), hgt - 4 - ((v - min) / span) * (hgt - 8)]);
  root.append(svg('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 'spark-line' }));
  root.append(svg('circle', { cx: pts.at(-1)[0], cy: pts.at(-1)[1], r: 3, class: 'spark-dot' }));
  return root;
}

// ---------- график → картинка в буфер обмена ----------
const IMG = { text: '#1b1d22', muted: '#6b7280', line: '#e5e7eb', accent: '#5b52e6', orange: '#e08a1e', good: '#1b8a4b' };
const FONT = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Кнопка «📋» рядом с графиком. container — элемент, внутри которого лежит график (ищется в момент нажатия). */
export function copyBtn(container, opts) {
  return h('button', { class: 'btn small icon-only', title: 'Поделиться графиком картинкой', 'aria-label': 'Поделиться графиком', onclick: () => copyChart(typeof container === 'function' ? container() : container, typeof opts === 'function' ? opts() : opts) }, icon('share'));
}

/** Рисуем график на белом фоне со светлыми цветами (не зависит от тёмной темы приложения) */
export async function copyChart(container, { title = '', legend = [] } = {}) {
  const src = container && container.querySelector('svg.chart');
  if (!src) { toast('Здесь пока нет графика'); return; }
  const el = src.cloneNode(true);
  el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  el.setAttribute('width', W); el.setAttribute('height', H);
  el.setAttribute('font-family', FONT);
  el.querySelectorAll('title').forEach((t) => t.remove());
  const set = (n, o) => Object.entries(o).forEach(([k, v]) => n.setAttribute(k, v));
  el.querySelectorAll('*').forEach((n) => {
    const cl = n.getAttribute('class') || '';
    if (cl.includes('grid')) set(n, { stroke: IMG.line, 'stroke-width': 1 });
    else if (cl.includes('axis')) set(n, { fill: IMG.muted, 'font-size': 21 });
    else if (cl.includes('goal')) set(n, { stroke: IMG.muted, 'stroke-dasharray': '4 4', 'stroke-width': 1 });
    else if (cl.includes('bar')) set(n, { fill: cl.includes('met') ? IMG.good : IMG.accent, 'fill-opacity': 0.85 });
    else if (cl.includes('line')) set(n, { fill: 'none', stroke: cl.includes('s2') ? IMG.orange : IMG.accent, 'stroke-width': 2.5, 'stroke-linejoin': 'round' });
    else if (cl.includes('dot')) set(n, { fill: cl.includes('s2') ? IMG.orange : IMG.accent });
  });
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(el)], { type: 'image/svg+xml' }));
  const img = new Image();
  try { await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; }); } catch { toast('Не получилось нарисовать график'); return; } finally { URL.revokeObjectURL(url); }
  const pad = 20, head = title ? 44 : 12, leg = legend.length ? 28 : 0, foot = 28, scale = 2;
  const cw = W + pad * 2, ch = head + H + leg + foot;
  const cv = document.createElement('canvas');
  cv.width = cw * scale; cv.height = ch * scale;
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
  ctx.fillStyle = IMG.accent; ctx.fillRect(0, 0, cw, 5);
  if (title) { ctx.fillStyle = IMG.text; ctx.font = `700 20px ${FONT}`; ctx.fillText(title, pad, 36); }
  ctx.drawImage(img, pad, head, W, H);
  let x = pad;
  legend.forEach((l) => {
    ctx.fillStyle = l.cls === 's2' ? IMG.orange : IMG.accent; ctx.fillRect(x, head + H + 8, 12, 12); x += 18;
    ctx.fillStyle = IMG.muted; ctx.font = `14px ${FONT}`; ctx.fillText(l.label, x, head + H + 19); x += ctx.measureText(l.label).width + 18;
  });
  const d = new Date();
  ctx.fillStyle = IMG.muted; ctx.font = `12px ${FONT}`;
  ctx.fillText(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, pad, ch - 10);
  await sendCanvas(cv, `grafik-${(title || 'chart').replace(/[^\wа-яё]+/gi, '-').slice(0, 40)}.png`, 'График скопирован — вставь в чат');
}

/** Таблица картинкой: columns — заголовки, rows — массивы строк (текст). Белый фон, не зависит от темы приложения. */
export async function copyTable({ title = '', columns, rows, note = '' }) {
  if (!rows.length) { toast('Нет данных для картинки'); return; }
  const scale = 2, pad = 24, rowH = 44, headH = 52, top = title ? 64 : 24;
  const first = 150, other = 120, cw = pad * 2 + first + other * (columns.length - 1);
  const ch = top + headH + rows.length * rowH + (note ? 40 : 28) + 12;
  const cv = document.createElement('canvas'); cv.width = cw * scale; cv.height = ch * scale;
  const c = cv.getContext('2d'); c.scale(scale, scale);
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, cw, ch); c.fillStyle = IMG.accent; c.fillRect(0, 0, cw, 5);
  if (title) { c.fillStyle = IMG.text; c.font = `700 22px ${FONT}`; c.textAlign = 'left'; c.fillText(title, pad, 42); }
  c.fillStyle = '#f3f4f6'; c.fillRect(pad, top, cw - pad * 2, headH);
  const xAt = (i) => (i === 0 ? pad + 8 : pad + first + other * (i - 1) + other / 2);
  columns.forEach((t, i) => {
    c.fillStyle = IMG.muted; c.font = `600 16px ${FONT}`; c.textAlign = i === 0 ? 'left' : 'center';
    const [a, b] = String(t).split('\n'); c.fillText(a, xAt(i), top + (b ? 22 : 31)); if (b) { c.font = `14px ${FONT}`; c.fillText(b, xAt(i), top + 42); }
  });
  rows.forEach((r, k) => {
    const y = top + headH + k * rowH;
    if (k) { c.fillStyle = IMG.line; c.fillRect(pad, y, cw - pad * 2, 1); }
    r.forEach((v, i) => {
      const [main, delta] = String(v).split('\n');
      c.textAlign = i === 0 ? 'left' : 'center'; c.fillStyle = IMG.text; c.font = `${i === 0 ? 600 : 500} 20px ${FONT}`;
      c.fillText(main, xAt(i), y + (delta ? 26 : 29));
      if (delta) { c.fillStyle = IMG.muted; c.font = `13px ${FONT}`; c.fillText(delta, xAt(i), y + 40); }
    });
  });
  c.textAlign = 'left'; c.fillStyle = IMG.muted; c.font = `13px ${FONT}`;
  c.fillText(note || new Date().toISOString().slice(0, 10), pad, ch - 14);
  await sendCanvas(cv, `${(title || 'table').replace(/[^\wа-яё]+/gi, '-').slice(0, 40)}.png`, 'Таблица скопирована — вставь в чат');
}
