// Excel ⇄ данные приложения.
//
// 1) Формат приложения (workouts.xlsx): плоские таблицы, одна строка = один круг.
//    Его можно открыть и править руками в Excel. Подробно: docs/DATA_FORMAT.md
// 2) parseLegacy — разовый импорт твоей старой таблицы (блоки "День А / Круг / Вес / Количество").

import { readXlsx, writeXlsx, cellAddr } from './xlsx-lite.js';
import { emptyDb, ensureExercise, findExercise, normName, num, guessMeta, nameKey, latestCycle } from './model.js';
import { isISO, nowISO, uid } from './util.js';

const TYPE_TO_XLS = { sets: 'круги', free: 'свободный', interval: 'интервал' };
const XLS_TO_TYPE = { 'круги': 'sets', 'свободный': 'free', 'интервал': 'interval' };

export const COLS = ['ID', 'Дата', 'День', '№', 'Упражнение', 'Тип', 'Круг', 'Вес, кг', 'Повторы / сек',
  'Комментарий круга', 'Комментарий упражнения', 'Работа, с', 'Отдых, с', 'Раундов', 'Формат', 'Движения', 'Медиа', 'Изменено'];
const WIDTHS = [14, 12, 6, 5, 34, 11, 6, 9, 12, 28, 34, 10, 10, 9, 12, 30, 24, 22];
const SERVICE = new Set(['_настройки', '_упражнения', '_удалённые', '_справка', 'замеры']);

// ======================= ЗАПИСЬ (db → xlsx) =======================
export async function dbToXlsx(db) {
  const sheets = [];
  const cycles = [...new Set([...(db.settings.cycles || []), ...db.workouts.map((w) => w.cycle)])];
  for (const cycle of cycles) {
    const rows = [COLS];
    const list = db.workouts.filter((w) => w.cycle === cycle)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.created || '') < (b.created || '') ? -1 : 1));
    for (const w of list) {
      const base = (n, name, type) => [w.id, isISO(w.date) ? { d: w.date } : w.date, w.day, n, name, type];
      const upd = w.updated || '';
      if (w.plan) rows.push([...base(0, '', 'план'), '', '', '', '', w.plan, '', '', '', '', '', '', upd]);
      if (w.note) rows.push([...base(0, '', 'заметка'), '', '', '', '', w.note, '', '', '', '', '', '', upd]);
      w.items.forEach((it, i) => {
        const n = i + 1, media = (it.media || []).join(';');
        if (it.type === 'sets') {
          const sets = it.sets.length ? it.sets : [{}];
          sets.forEach((s, j) => rows.push([...base(n, it.exercise, 'круги'), it.sets.length ? j + 1 : '', s.w ?? '', s.r ?? '',
            s.note || '', j === 0 ? it.note || '' : '', '', '', '', '', '', j === 0 ? media : '', upd]));
        } else if (it.type === 'free') {
          rows.push([...base(n, it.title || '', 'свободный'), '', '', '', '', it.text || '', '', '', '', '', media, upd]);
        } else if (it.type === 'interval') {
          rows.push([...base(n, it.title || '', 'интервал'), '', '', '', it.result || '', it.text || '', it.work ?? '', it.rest ?? '', it.rounds ?? '', it.format || '', it.moves || '', media, upd]);
        }
      });
    }
    sheets.push({ name: cycle, rows, widths: WIDTHS });
  }
  sheets.push({ name: 'Замеры', widths: [12, 10, 10, 10, 10], rows: [['Дата', 'Вес, кг', 'ОТ, см', 'ОГ, см', 'ОБ, см'],
    ...db.measures.map((m) => [isISO(m.date) ? { d: m.date } : m.date, m.weight ?? '', m.waist ?? '', m.chest ?? '', m.hips ?? ''])] });
  sheets.push({ name: '_Упражнения', widths: [38, 10, 14, 30, 40, 11], rows: [['Упражнение', 'Единица', 'Облегчение', 'Мышцы', 'Синонимы', 'Избранное'],
    ...db.exercises.map((e) => [e.name, e.unit === 'sec' ? 'сек' : 'повт', e.assist ? 'да' : '', (e.muscles || []).join(', '), (e.aliases || []).join(' | '), e.fav ? 'да' : ''])] });
  sheets.push({ name: '_Настройки', widths: [22, 50], rows: [['Ключ', 'Значение'],
    ['занятий_в_неделю', db.settings.perWeek], ['текущий_цикл', db.settings.currentCycle], ['циклы', (db.settings.cycles || []).join(' | ')]] });
  sheets.push({ name: '_Удалённые', widths: [16, 26], rows: [['ID', 'Когда удалено'], ...db.deleted.map((d) => [d.id, d.at])] });
  sheets.push({ name: '_Справка', header: false, widths: [110], rows: HELP.map((t) => [t]) });
  return writeXlsx(sheets);
}

const HELP = [
  'ЭТОТ ФАЙЛ ВЕДЁТСЯ ПРИЛОЖЕНИЕМ, НО ЕГО МОЖНО ПРАВИТЬ РУКАМИ. Подробно: docs/DATA_FORMAT.md в проекте.',
  '',
  'Каждый лист, название которого не начинается с «_» и не равно «Замеры», — это ЦИКЛ. Одна строка = один круг упражнения.',
  'ID — одинаковый у всех строк одной тренировки. Не меняй его. Для новой тренировки в Excel придумай любой уникальный ID (например w_ручная1).',
  'Дата — формат ГГГГ-ММ-ДД. Если приложение показывает «без даты» — значит дата в ячейке не распознана, исправь её здесь.',
  'Тип: круги (вес × повторы), свободный (любой текст), интервал (табата и т.п.), заметка и план (на всю тренировку).',
  'Для упражнения со своим весом колонку «Вес, кг» оставь пустой. Повторы — число; диапазон вида 14-16 в расчёты не идёт (это рекомендация тренера).',
  'Комментарий круга — про конкретный круг («с резинкой»). Комментарий упражнения — на всё упражнение, пишется в строке первого круга.',
  'Если правишь файл в Excel, а потом открываешь приложение: Настройки → Импорт → «Объединить с текущими данными».',
  'Лист «_Удалённые» нужен синхронизации — чтобы удалённая на телефоне тренировка не вернулась с компьютера. Его не трогай.',
];

// ======================= ЧТЕНИЕ (xlsx → db) =======================
const asText = (c) => (c && c.t === 's' ? c.v.replace(/\s+/g, ' ').trim() : null);
const cellNum = (c) => (c ? (c.t === 'n' ? c.v : num(c.v)) : null);

function isAppSheet(sh) {
  const head = sh.rowValues(0).map((x) => (x == null ? '' : String(x)));
  return head[0] === 'ID' && head.includes('Упражнение') && head.includes('Дата');
}

/** Читает xlsx в формате приложения. Возвращает { db, report } либо null, если файл не нашего формата */
export function parseAppFormat(wb) {
  const appSheets = wb.sheets.filter(isAppSheet);
  if (!appSheets.length) return null;
  const db = emptyDb();
  const report = { warnings: [], workouts: 0 };
  for (const sh of appSheets) {
    const head = sh.rowValues(0).map((x) => String(x ?? ''));
    const ix = (n) => head.indexOf(n);
    const I = Object.fromEntries(COLS.map((c) => [c, ix(c)]));
    const val = (r, name) => { const c = I[name] >= 0 ? sh.get(r, I[name]) : null; return c ? c.v : null; };
    const wmap = new Map();
    for (let r = 1; r <= sh.maxR; r++) {
      const id = val(r, 'ID');
      if (id === null || id === '') continue;
      let w = wmap.get(String(id));
      const dateCell = sh.get(r, I['Дата']);
      if (!w) {
        const rawDate = dateCell ? dateCell.v : '';
        w = { id: String(id), cycle: sh.name, date: dateCell && dateCell.t === 'd' ? dateCell.v : normalizeDate(rawDate), day: normName(val(r, 'День') ?? ''), plan: '', note: '', created: '', updated: String(val(r, 'Изменено') || ''), items: [], _items: new Map() };
        wmap.set(String(id), w);
      }
      const type = String(val(r, 'Тип') || 'круги').toLowerCase();
      const comment = val(r, 'Комментарий упражнения');
      if (type === 'план') { w.plan = String(comment ?? ''); continue; }
      if (type === 'заметка') { w.note = String(comment ?? ''); continue; }
      const n = Number(val(r, '№')) || w._items.size + 1;
      const mediaRaw = val(r, 'Медиа');
      let it = w._items.get(n);
      if (!it) {
        const kind = XLS_TO_TYPE[type] || 'sets';
        const name = normName(val(r, 'Упражнение') ?? '');
        it = kind === 'sets' ? { type: 'sets', exercise: name, mode: 'bodyweight', note: '', sets: [], media: [] }
          : kind === 'free' ? { type: 'free', title: name, text: '', media: [] }
            : { type: 'interval', title: name, format: '', work: null, rest: null, rounds: null, moves: '', text: '', result: '', media: [] };
        w._items.set(n, it); w.items.push(it); it._n = n;
      }
      if (mediaRaw) it.media = String(mediaRaw).split(';').map((s) => s.trim()).filter(Boolean);
      if (it.type === 'sets') {
        if (comment) it.note = String(comment);
        const round = val(r, 'Круг');
        const wv = val(r, 'Вес, кг'), rv = val(r, 'Повторы / сек'), sn = val(r, 'Комментарий круга');
        if (round !== null && round !== '' || wv !== null || rv !== null || sn) {
          it.sets.push({ w: wv === '' ? null : wv, r: rv === '' ? null : rv, note: sn ? String(sn) : '', _k: Number(round) || it.sets.length + 1 });
          if (wv !== null && num(wv) > 0) it.mode = 'weighted';
        }
      } else if (it.type === 'free') { if (comment) it.text = String(comment); }
      else {
        if (comment) it.text = String(comment);
        const res = val(r, 'Комментарий круга'); if (res) it.result = String(res);
        for (const [col, key] of [['Работа, с', 'work'], ['Отдых, с', 'rest'], ['Раундов', 'rounds']]) { const v = val(r, col); if (v !== null && v !== '') it[key] = num(v); }
        const f = val(r, 'Формат'); if (f) it.format = String(f);
        const m = val(r, 'Движения'); if (m) it.moves = String(m);
      }
    }
    for (const w of wmap.values()) {
      for (const it of w.items) { delete it._n; if (it.sets) { it.sets.sort((a, b) => a._k - b._k); it.sets.forEach((s) => delete s._k); } }
      delete w._items;
      w.created = w.updated || nowISO();
      if (!isISO(w.date)) report.warnings.push({ sheet: sh.name, level: 'todo', wid: w.id, text: `Тренировка «День ${w.day}»: дата «${w.date}» не распознана — открой тренировку и выбери дату.` });
      db.workouts.push(w); report.workouts++;
      if (!db.settings.cycles.includes(sh.name)) db.settings.cycles.push(sh.name);
    }
  }
  db.settings.cycles = db.settings.cycles.filter((c) => c !== 'Цикл 1' || db.workouts.some((w) => w.cycle === 'Цикл 1'));
  for (const w of db.workouts) for (const it of w.items) if (it.type === 'sets') ensureExercise(db, it.exercise);

  // служебные листы
  const find = (n) => wb.sheets.find((s) => s.name.toLowerCase() === n);
  const ex = find('_упражнения');
  if (ex) for (let r = 1; r <= ex.maxR; r++) {
    const name = asText(ex.get(r, 0)); if (!name) continue;
    const e = ensureExercise(db, name);
    e.unit = asText(ex.get(r, 1)) === 'сек' ? 'sec' : 'reps';
    e.assist = (asText(ex.get(r, 2)) || '').toLowerCase() === 'да';
    e.muscles = (asText(ex.get(r, 3)) || '').split(',').map((s) => s.trim()).filter(Boolean);
    e.aliases = (asText(ex.get(r, 4)) || '').split('|').map((s) => s.trim()).filter(Boolean);
    e.fav = (asText(ex.get(r, 5)) || '').toLowerCase() === 'да';
  }
  const ms = find('замеры');
  if (ms) for (let r = 1; r <= ms.maxR; r++) {
    const d = ms.get(r, 0); if (!d) continue;
    const date = d.t === 'd' ? d.v : normalizeDate(d.v);
    db.measures.push({ date, weight: cellNum(ms.get(r, 1)), waist: cellNum(ms.get(r, 2)), chest: cellNum(ms.get(r, 3)), hips: cellNum(ms.get(r, 4)) });
  }
  const st = find('_настройки');
  if (st) for (let r = 1; r <= st.maxR; r++) {
    const k = asText(st.get(r, 0)), v = st.get(r, 1); if (!k || !v) continue;
    if (k === 'занятий_в_неделю') db.settings.perWeek = Number(v.v) || 3;
    if (k === 'текущий_цикл') db.settings.currentCycle = String(v.v);
    if (k === 'циклы') db.settings.cycles = [...new Set([...String(v.v).split('|').map((s) => s.trim()).filter(Boolean), ...db.settings.cycles])];
  }
  const dl = find('_удалённые');
  if (dl) for (let r = 1; r <= dl.maxR; r++) { const id = asText(dl.get(r, 0)); if (id) db.deleted.push({ id, at: String(dl.get(r, 1)?.v || '') }); }
  return { db, report };
}

function normalizeDate(raw) {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (isISO(s)) return s;
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return s;
}

// ======================= СТАРАЯ ТАБЛИЦА → db =======================
// Ожидаемая раскладка (по твоему файлу):
//   «День А | дата»  → под ним упражнения; у каждого: название, затем строки Круг / Вес / Количество;
//   соседние недели лежат правее блоками по ~7 колонок. Комментарии — в ячейках справа/под кругами.
const LABELS = new Set(['круг', 'вес', 'количество']);
const DAY_LETTER = { A: 'А', B: 'Б', C: 'С', 'С': 'С', 'А': 'А', 'Б': 'Б', 'В': 'В' }; // латиница → кириллица
const KNOWN_DAYS = new Set(['А', 'Б', 'В', 'С', 'Г']);
// Явные одинаковые упражнения, написанные по-разному. Остальное предлагает объединить раздел «Упражнения».
const ALIASES = { 'подтягивания на гравитроне': 'Подтягивания в гравитроне', 'лопаточные подтягивания': 'Подтягивания лопаточные' };

function hash(s) { let h = 5381; for (const ch of s) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; return h.toString(36); }

export function parseLegacy(wb) {
  const report = { warnings: [], skipped: 0, workouts: 0, sets: 0 };
  const warn = (sheet, cell, text, extra = {}) => report.warnings.push({ sheet, cell, text, level: 'info', ...extra });
  const workouts = [];
  wb.sheets.forEach((sh, si) => {
    const cycle = `Цикл ${si + 1}`;
    const heads = [];
    for (let r = 0; r <= sh.maxR; r++) for (let c = 0; c <= Math.min(sh.maxC, 60); c++) {
      const t = asText(sh.get(r, c));
      if (t && /^день(\s|$)/i.test(t)) heads.push({ r, c, t });
    }
    const headCols = [...new Set(heads.map((x) => x.c))].sort((a, b) => a - b);
    for (const hd of heads) {
      const endRow = Math.min(...heads.filter((x) => x.c === hd.c && x.r > hd.r).map((x) => x.r), sh.maxR + 1);
      const nextCol = headCols.find((c) => c > hd.c);
      const right = (nextCol !== undefined ? nextCol : hd.c + 7) - 1;
      // день и дата
      let day = normName(hd.t.replace(/^день\s*/i, '')).toUpperCase();
      day = DAY_LETTER[day] || day;
      const wid = 'w' + hash(`${sh.name}|${hd.r}|${hd.c}`);
      let date = '';
      for (let c = hd.c + 1; c <= right && !date; c++) { const cell = sh.get(hd.r, c); if (cell && cell.t === 'd') date = cell.v; }
      const who = `День ${day}${date ? ', ' + date : ''}`;
      if (!KNOWN_DAYS.has(day)) warn(sh.name, cellAddr(hd.r, hd.c), `${who}: в таблице написано «${hd.t}». Выбери нужный день (А/Б/С) в этой тренировке.`, { level: 'todo', wid });
      if (!date) warn(sh.name, cellAddr(hd.r, hd.c), `${who}: не найдена дата. Укажи её в этой тренировке.`, { level: 'todo', wid });

      // упражнения внутри дня
      const starts = [];
      for (let r = hd.r + 1; r < endRow; r++) { const t = asText(sh.get(r, hd.c)); if (t && !LABELS.has(t.toLowerCase())) starts.push({ r, name: t }); }
      const items = [];
      starts.forEach((s, i) => {
        const end = i + 1 < starts.length ? starts[i + 1].r : endRow;
        const rows = {};
        for (let r = s.r + 1; r < end; r++) { const t = (asText(sh.get(r, hd.c + 1)) || '').toLowerCase(); if (LABELS.has(t) && !rows[t]) rows[t] = r; }
        const conv = (cell, r, c) => {
          if (!cell) return null;
          if (cell.t === 'd') { // Excel превратил «2,5» в дату 2 мая — возвращаем 2,5
            const [, m, d] = cell.v.split('-').map(Number);
            warn(sh.name, cellAddr(r, c), `${who}, «${s.name}»: Excel превратил «${d},${m}» в дату ${cell.v}. Исправлено на ${d + m / 10} — проверь, если вес был другим.`, { level: 'fixed', wid });
            return d + m / 10;
          }
          if (cell.t === 's') { const x = cell.v.trim(); if (!x) return null; const n = Number(x.replace(',', '.')); return Number.isFinite(n) ? n : x; }
          return cell.t === 'n' ? cell.v : null;
        };
        // «Пресс»: таблица повёрнута — номера кругов идут вниз, а «Количество» — заголовок столбца
        let vRow = null;
        for (let r = s.r + 1; r < end && vRow === null; r++) {
          if ((asText(sh.get(r, hd.c + 1)) || '').toLowerCase() === 'круг' && LABELS.has((asText(sh.get(r, hd.c + 2)) || '').toLowerCase())) vRow = r;
        }
        let sets;
        if (vRow !== null) {
          const colOf = {};
          for (let c = hd.c + 2; c <= right; c++) { const t = (asText(sh.get(vRow, c)) || '').toLowerCase(); if (LABELS.has(t)) colOf[t] = c; }
          sets = [];
          for (let r = vRow + 1; r < end; r++) {
            if (cellNum(sh.get(r, hd.c + 1)) === null) continue; // не номер круга — конец таблицы
            sets.push({ c: -1, note: '',
              w: colOf['вес'] !== undefined ? conv(sh.get(r, colOf['вес']), r, colOf['вес']) : null,
              r: colOf['количество'] !== undefined ? conv(sh.get(r, colOf['количество']), r, colOf['количество']) : null });
          }
        } else {
          const cols = [];
          for (let c = hd.c + 2; c <= right; c++) if (['круг', 'вес', 'количество'].some((k) => rows[k] !== undefined && sh.get(rows[k], c))) cols.push(c);
          sets = cols.map((c) => ({ c, w: null, r: null, note: '' }));
          sets.forEach((st) => {
            if (rows['вес'] !== undefined) st.w = conv(sh.get(rows['вес'], st.c), rows['вес'], st.c);
            if (rows['количество'] !== undefined) st.r = conv(sh.get(rows['количество'], st.c), rows['количество'], st.c);
          });
        }
        sets.forEach((st) => {
          for (const k of ['w', 'r']) {
            if (typeof st[k] !== 'string') continue;
            if (/^\s*\d+(?:[.,]\d+)?\s*[-–—]\s*\d/.test(st[k])) { // «14-16» — рекомендация тренера, в аналитику не идёт
              st.note += (st.note ? '; ' : '') + 'рекомендация ' + st[k]; warn(sh.name, cellAddr(s.r, hd.c), `${who}, «${s.name}»: «${st[k]}» — рекомендация тренера, перенесена в комментарий круга и в расчёты не идёт.`, { level: 'fixed', wid }); st[k] = null;
            } else if (!/\d/.test(st[k])) { st.note += (st.note ? '; ' : '') + st[k]; st[k] = null; } // текст без цифр — комментарий
          }
        });
        // комментарии: любые тексты правее названия внутри блока упражнения
        let exNote = '';
        for (let r = s.r; r < end; r++) for (let c = hd.c + 2; c <= right; c++) {
          const t = asText(sh.get(r, c));
          if (!t || LABELS.has(t.toLowerCase())) continue;
          if ((r === rows['вес'] || r === rows['количество']) && /\d/.test(t) && sets.some((x) => x.c === c)) continue; // это значение, не комментарий
          const st = sets.find((x) => x.c === c);
          if (r === s.r || !st) exNote += (exNote ? '; ' : '') + t;
          else st.note += (st.note ? '; ' : '') + t;
        }
        const clean = sets.filter((x) => x.w !== null || x.r !== null || x.note).map(({ w, r, note }) => ({ w, r, note }));
        if (!clean.some((x) => x.w !== null || x.r !== null)) { warn(sh.name, cellAddr(s.r, hd.c), `${who}: «${s.name}» без цифр — не добавлено.`); return; }
        const name = ALIASES[nameKey(s.name)] || normName(s.name);
        items.push({ type: 'sets', exercise: name, mode: clean.some((x) => num(x.w) > 0) ? 'weighted' : 'bodyweight', note: exNote, sets: clean, media: [] });
        report.sets += clean.length;
      });
      if (!items.length) { report.skipped++; warn(sh.name, cellAddr(hd.r, hd.c), `${who}: в блоке нет данных — не добавлено.`); continue; }
      workouts.push({ id: wid, cycle, date, day, plan: '', note: '', created: nowISO(), updated: nowISO(), items });
      report.workouts++;
    }
  });
  return { workouts, report };
}

/** Применить результат parseLegacy к db (идемпотентно: повторный импорт не создаст дублей) */
export function applyLegacy(db, parsed) {
  const have = new Set(db.workouts.map((w) => w.id));
  db.importLog ||= [];
  for (const x of parsed.report.warnings) {
    if (x.wid && have.has(x.wid)) continue; // эту тренировку уже импортировали раньше
    db.importLog.push({ id: uid('n'), level: x.level, text: x.text, where: `${x.sheet}${x.cell ? ' ' + x.cell : ''}`, wid: x.wid || '', at: nowISO() });
  }
  let added = 0;
  for (const w of parsed.workouts) {
    if (have.has(w.id)) continue;
    db.workouts.push(w); added++;
    if (!db.settings.cycles.includes(w.cycle)) db.settings.cycles.push(w.cycle);
    for (const it of w.items) {
      const known = findExercise(db, it.exercise);
      if (!known) ensureExercise(db, it.exercise);
    }
  }
  const dates = db.workouts.map((w) => w.date).filter(isISO).sort();
  if (!db.settings.cycleSet) { const c = latestCycle(db); if (c) db.settings.currentCycle = c; }
  db.settings.cycles = db.settings.cycles.filter((c) => c !== 'Цикл 1' || db.workouts.some((w) => w.cycle === 'Цикл 1') || db.settings.cycles.length === 1);
  return { added, from: dates[0], to: dates[dates.length - 1] };
}

/** Единая точка входа для кнопки «Загрузить Excel» */
export async function readAnyWorkbook(arrayBuffer) {
  const wb = await readXlsx(arrayBuffer);
  const app = parseAppFormat(wb);
  if (app) return { kind: 'app', ...app };
  const legacy = parseLegacy(wb);
  return { kind: 'legacy', ...legacy };
}
export { readXlsx };
