// Картинка тренировки для "Поделиться": рисуем таблицу на canvas и кладём PNG в буфер обмена.
import { compareItem, exMeta, num, wName } from './model.js';
import { state } from './store.js';
import { fmtDate, fmtNum, toast, download, plural } from './util.js';

const FONT = '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const C = { bg: '#ffffff', text: '#1b1d22', muted: '#6b7280', line: '#e5e7eb', head: '#f3f4f6', good: '#1b8a4b', bad: '#d33a3a', accent: '#5b52e6' };

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/** Рисует тренировку. withColors — подсвечивать выросшее/упавшее зелёным/красным. */
export function renderWorkoutCanvas(w, { withColors = true } = {}) {
  const db = state.db;
  const W = 1080, pad = 40, scale = 2;
  const cols = { name: pad, rounds: 470, weight: 560, reps: 810 };
  const colW = { name: 410, rounds: 90, weight: 240, reps: 230 };
  const rows = [];
  const m = document.createElement('canvas').getContext('2d');
  m.font = `600 30px ${FONT}`;
  for (const it of w.items) {
    if (it.type === 'sets') {
      const idx = [];
      it.sets.forEach((s, i) => { if (num(s.w) !== null || num(s.r) !== null) idx.push(i); }); // номера заполненных кругов
      if (!idx.length) continue;
      const cmp = withColors ? compareItem(db, w, it) : { cells: [] };
      const meta = exMeta(db, it.exercise);
      // «что и где изменилось» к прошлому разу
      const toks = [];
      if (withColors) {
        if (!cmp.prev) toks.push({ t: 'Новое упражнение — сравнить не с чем', cls: 'muted' });
        else {
          const ps = cmp.prev.it.sets, filled = (x) => x && (num(x.w) !== null || num(x.r) !== null), us = meta.unit === 'sec' ? 'сек' : 'повт';
          toks.push({ t: `К прошлому разу (${fmtDate(cmp.prev.w.date, false)}):`, cls: 'muted' });
          idx.forEach((i) => {
            const s = it.sets[i], p = ps[i], c = cmp.cells[i] || {};
            if (!filled(p)) return;
            const dw = num(s.w) !== null && num(p.w) !== null ? num(s.w) - num(p.w) : 0;
            const dr = num(s.r) !== null && num(p.r) !== null ? num(s.r) - num(p.r) : 0;
            if (dw) toks.push({ t: `круг ${i + 1}: вес ${dw > 0 ? '+' : '−'}${fmtNum(Math.abs(dw))}`, cls: c.w });
            if (dr) toks.push({ t: `круг ${i + 1}: ${us} ${dr > 0 ? '+' : '−'}${fmtNum(Math.abs(dr))}`, cls: c.r });
          });
          const added = idx.filter((i) => !filled(ps[i])).length, lost = ps.filter(filled).length - idx.length;
          if (added > 0) toks.push({ t: `+${added} ${plural(added, ['круг', 'круга', 'кругов'])}`, cls: 'better' });
          if (lost > 0) toks.push({ t: `−${lost} ${plural(lost, ['круг', 'круга', 'кругов'])}`, cls: 'worse' });
          if (toks.length === 1) toks.push({ t: 'без изменений', cls: 'muted' });
        }
      }
      rows.push({ kind: 'sets', toks, name: it.exercise, lines: wrap(m, it.exercise, colW.name), sets: idx.map((i) => it.sets[i]), idx, cells: cmp.cells, bodyweight: it.mode === 'bodyweight', unit: meta.unit, note: it.note });
    } else if (it.type === 'free' || it.type === 'interval') {
      const parts = [];
      if (it.type === 'interval') {
        const spec = [it.format, it.work && it.rest ? `${it.work}/${it.rest} с` : '', it.rounds ? `${it.rounds} раунд.` : ''].filter(Boolean).join(' · ');
        if (spec) parts.push(spec);
        if (it.moves) parts.push(...it.moves.split('\n').filter(Boolean));
      }
      if (it.text) parts.push(...it.text.split('\n').filter(Boolean));
      if (it.result) parts.push('Итог: ' + it.result);
      rows.push({ kind: 'text', name: it.title || (it.type === 'interval' ? 'Интервальный блок' : 'Блок'), parts });
    }
  }
  m.font = `26px ${FONT}`;
  m.font = `22px ${FONT}`;
  const sepW = m.measureText('  ·  ').width;
  rows.forEach((r) => { // раскладываем подписи изменений по строкам
    r.dl = [];
    if (r.toks && r.toks.length) {
      let line = [], w = 0;
      r.toks.forEach((tk, i) => {
        const tw = m.measureText(tk.t).width + (line.length ? sepW : 0);
        if (line.length && w + tw > W - pad * 2) { r.dl.push(line); line = []; w = 0; }
        line.push(tk); w += m.measureText(tk.t).width + (line.length > 1 ? sepW : 0);
      });
      if (line.length) r.dl.push(line);
    }
  });
  m.font = `26px ${FONT}`;
  rows.forEach((r) => {
    if (r.kind === 'text') { r.body = r.parts.flatMap((p) => wrap(m, p, W - pad * 2 - 20)); r.h = 56 + r.body.length * 34 + 16; }
    else r.h = Math.max(r.lines.length * 38, 38) + 34 + (r.dl.length ? r.dl.length * 34 + 16 : 0) + (r.note ? 30 : 0);
  });
  const headH = 130, tableHead = 50, foot = 56;
  const H = headH + tableHead + rows.reduce((a, r) => a + r.h, 0) + foot;
  const cv = document.createElement('canvas');
  cv.width = W * scale; cv.height = H * scale;
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = C.accent; ctx.fillRect(0, 0, W, 8);
  ctx.fillStyle = C.text; ctx.font = `700 46px ${FONT}`;
  ctx.fillText(wName(w), pad, 76);
  ctx.fillStyle = C.muted; ctx.font = `28px ${FONT}`;
  ctx.fillText(fmtDate(w.date), pad, 114);

  let y = headH;
  ctx.fillStyle = C.head; ctx.fillRect(0, y, W, tableHead);
  ctx.fillStyle = C.muted; ctx.font = `600 26px ${FONT}`;
  ctx.fillText('🏋️', cols.name, y + 34);
  ctx.textAlign = 'center';
  ctx.fillText('🔁', cols.rounds + colW.rounds / 2, y + 33);
  ctx.fillText('⚖️', cols.weight + colW.weight / 2, y + 33);
  ctx.fillText('🔢', cols.reps + colW.reps / 2, y + 33);
  ctx.textAlign = 'left';
  y += tableHead;

  const drawSeq = (values, classes, cx, maxW) => {
    // значения через " / ", каждое своим цветом; шрифт уменьшаем, если не влезает в колонку
    let fs = 30;
    const sepTxt = ' / ';
    for (; fs > 16; fs -= 2) { ctx.font = `600 ${fs}px ${FONT}`; if (values.reduce((a, v) => a + ctx.measureText(v).width, 0) + ctx.measureText(sepTxt).width * (values.length - 1) <= maxW) break; }
    ctx.font = `600 ${fs}px ${FONT}`;
    ctx.textAlign = 'left'; // иначе наследуется «center» от соседней колонки и цифры наезжают на «/»
    const sep = ' / ';
    const sepW = ctx.measureText(sep).width;
    const widths = values.map((v) => ctx.measureText(v).width);
    const total = widths.reduce((a, b) => a + b, 0) + sepW * (values.length - 1);
    let x = cx - total / 2;
    values.forEach((v, i) => {
      ctx.fillStyle = classes[i] === 'better' ? C.good : classes[i] === 'worse' ? C.bad : C.text;
      ctx.fillText(v, x, ctxY); x += widths[i];
      if (i < values.length - 1) { ctx.fillStyle = C.muted; ctx.fillText(sep, x, ctxY); x += sepW; }
    });
  };
  let ctxY = 0;

  rows.forEach((r) => {
    ctx.strokeStyle = C.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, y + r.h); ctx.lineTo(W - pad, y + r.h); ctx.stroke();
    if (r.kind === 'text') {
      ctx.fillStyle = C.text; ctx.font = `600 30px ${FONT}`; ctx.fillText(r.name, pad, y + 40);
      ctx.fillStyle = C.muted; ctx.font = `26px ${FONT}`;
      r.body.forEach((l, i) => ctx.fillText(l, pad + 20, y + 78 + i * 34));
    } else {
      ctx.fillStyle = C.text; ctx.font = `600 30px ${FONT}`;
      r.lines.forEach((l, i) => ctx.fillText(l, cols.name, y + 40 + i * 38));
      r.dl.forEach((line, k) => {
        let x = cols.name; const by = y + 40 + (r.lines.length - 1) * 38 + 40 + k * 34;
        ctx.font = `22px ${FONT}`;
        line.forEach((tk, i) => {
          if (i) { const sp = i === 1 ? '  ' : '  ·  '; ctx.fillStyle = C.muted; ctx.fillText(sp, x, by); x += ctx.measureText(sp).width; }
          ctx.fillStyle = tk.cls === 'better' ? C.good : tk.cls === 'worse' ? C.bad : C.muted;
          ctx.fillText(tk.t, x, by); x += ctx.measureText(tk.t).width;
        });
      });
      if (r.note) { ctx.fillStyle = C.muted; ctx.font = `22px ${FONT}`; ctx.fillText(r.note.slice(0, 60), cols.name, y + r.h - 18); }
      ctxY = y + 40;
      ctx.textAlign = 'center';
      ctx.fillStyle = C.text; ctx.font = `600 30px ${FONT}`;
      ctx.fillText(String(r.sets.length), cols.rounds + colW.rounds / 2, ctxY);
      // подсветка посчитана по исходным номерам кругов, а рисуем только заполненные
      const cellOf = (k) => r.cells[r.idx[k]] || {};
      drawSeq(r.bodyweight ? ['—'] : r.sets.map((s) => (s.w === null || s.w === '' ? '–' : fmtNum(s.w))), r.bodyweight ? [] : r.sets.map((_, k) => cellOf(k).w), cols.weight + colW.weight / 2, colW.weight);
      drawSeq(r.sets.map((s) => (s.r === null || s.r === '' ? '–' : fmtNum(s.r)) + (r.unit === 'sec' ? 'с' : '')), r.sets.map((_, k) => cellOf(k).r), cols.reps + colW.reps / 2, colW.reps);
      ctx.textAlign = 'left';
    }
    y += r.h;
  });
  ctx.fillStyle = C.muted; ctx.font = `20px ${FONT}`;
  ctx.fillText(withColors ? 'Зелёный — стало больше, красный — меньше, чем в прошлый раз' : '', pad, H - 20);
  return cv;
}
export async function shareWorkout(w, opts = {}) {
  return sendCanvas(renderWorkoutCanvas(w, opts), `trenirovka-${w.date}.png`, 'Картинка скопирована — вставь в чат');
}
/** Canvas → буфер обмена (или меню «Поделиться» телефона, или скачивание) */
export async function sendCanvas(cv, name, okMsg) {
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast(okMsg);
      return;
    }
  } catch (e) { console.warn('clipboard', e); }
  try {
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  download(blob, name);
  toast('Буфер недоступен — картинка скачана');
}
