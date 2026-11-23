// Модель данных и вся "математика": сравнение с прошлым разом, объём, плато, слияние при синке.
// Здесь нет работы с экраном и сетью — только чистые функции над объектом db.
//
// db = {
//   v, rev,
//   settings: { perWeek, currentCycle, cycles:[...] },
//   exercises: [{ name, unit:'reps'|'sec', assist:bool, muscles:[...], aliases:[...] }],
//   workouts: [{ id, cycle, date:'YYYY-MM-DD', day:'А', plan, note, created, updated, items:[...] }],
//   measures: [{ date, weight, waist, chest, hips }],
//   deleted:  [{ id, at }]            // удалённые тренировки (нужны, чтобы синк не "воскресил" их)
// }
// item (упражнение в тренировке) бывает трёх видов:
//   { type:'sets',     exercise, mode:'weighted'|'bodyweight', note, sets:[{w, r, note}], media:[] }
//   { type:'free',     title, text, media:[] }                                 — любой текст, картинка
//   { type:'interval', title, format, work, rest, rounds, moves, text, result, media:[] }  — табата и т.п.

import { weekStart, parseISO, isoDate, addDays, isISO } from './util.js';

export const emptyDb = () => ({
  v: 1, rev: 0,
  settings: { perWeek: 3, currentCycle: 'Цикл 1', cycles: ['Цикл 1'], restSec: 60, plateauN: 4, plateauPct: 3, compareMode: 'last', notDup: [] },
  exercises: [], workouts: [], measures: [], deleted: [],
  importLog: [], // что нашёл/исправил импорт старой таблицы (хранится только на устройстве, см. «Проверка данных»)
});

export const DAY_LABELS = ['А', 'Б', 'С'];
/** Название тренировки: старые «А/Б/С» показываем как «День А», любое своё название — как есть */
export const wName = (w) => { const d = String(w.day || '').trim(); return !d ? 'Тренировка' : d.length <= 2 ? `День ${d}` : d; };
/** Короткая метка для клетки календаря */
export const dayBadge = (w) => { const d = String(w.day || '').trim(); if (!d) return '●'; if (d.length <= 2) return d; const m = /^День\s+(\S{1,2})$/i.exec(d); return m ? m[1] : d[0].toUpperCase(); };
/** Что вводится в упражнении: вес / повторы / темп. Для старых записей выводим из режима. */
export const fieldsOf = (it) => (it.fields ? { w: !!it.fields.w, r: it.fields.r !== false, t: !!it.fields.t } : { w: it.mode !== 'bodyweight', r: true, t: !!(it.tempo && it.tempo.some((x) => x !== null && x !== '')) });
export const tempoText = (it) => (it.tempo && it.tempo.some((x) => x !== null && x !== '') ? it.tempo.map((x) => (x === null || x === '' ? 0 : x)).join('-') : '');
export const MUSCLES = ['Ягодицы', 'Квадрицепс', 'Задняя поверхность бедра', 'Спина', 'Грудь', 'Плечи', 'Бицепс', 'Трицепс', 'Пресс / кор', 'Поясница', 'Икры', 'Другое'];

// ---------- числа и названия ----------
/** Любое значение ячейки → число. "12р" → 12, пусто → null.
 *  Диапазон "14-16" — это рекомендация тренера, а не результат: в расчёты не идёт (null). */
export function num(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (x === null || x === undefined || x === '') return null;
  const str = String(x).replace(',', '.');
  if (/^\s*\d+(?:\.\d+)?\s*[-–—]\s*\d/.test(str)) return null;
  const m = str.match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
export const normName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const nameKey = (s) => normName(s).toLowerCase().replace(/ё/g, 'е');

// ---------- справочник упражнений ----------
const MUSCLE_RULES = [
  [/румынк|становая/i, ['Задняя поверхность бедра', 'Ягодицы']],
  [/гиперэкст/i, ['Поясница', 'Ягодицы']],
  [/мост|ягодич/i, ['Ягодицы']],
  [/болгар|выпад|зашаг|присед|жим ногами/i, ['Квадрицепс', 'Ягодицы']],
  [/отведение в тренаж|разведение ног/i, ['Ягодицы']],
  [/сведение/i, ['Грудь']],
  [/пуловер/i, ['Спина', 'Грудь']],
  [/тяга|подтягив|гравитрон/i, ['Спина']],
  [/бицепс/i, ['Бицепс']],
  [/трицепс|обратные отжим|отжимания со скамьи/i, ['Трицепс']],
  [/отжим/i, ['Грудь', 'Трицепс']],
  [/жим гантел/i, ['Грудь']],
  [/жим стоя|отведение (плеч|рук)/i, ['Плечи']],
  [/планк|пресс|скруч|перекат|подн\wтие ног|статик/i, ['Пресс / кор']],
];
/** Догадка по названию. Это только стартовая подсказка — всё правится в разделе "Упражнения". */
export function guessMeta(name) {
  const rule = MUSCLE_RULES.find(([re]) => re.test(name));
  return { unit: /планк/i.test(name) ? 'sec' : 'reps', assist: /гравитрон/i.test(name), muscles: rule ? rule[1] : [] };
}
export function findExercise(db, raw) {
  const k = nameKey(raw);
  return db.exercises.find((e) => nameKey(e.name) === k || (e.aliases || []).some((a) => nameKey(a) === k)) || null;
}
export function ensureExercise(db, raw) {
  const name = normName(raw);
  let e = findExercise(db, name);
  if (!e) { e = { name, aliases: [], ...guessMeta(name) }; db.exercises.push(e); }
  return e;
}
export const exMeta = (db, name) => findExercise(db, name) || { name, aliases: [], ...guessMeta(name) };

/** Слить упражнение from в to: переименовать во всех тренировках, запомнить старое имя как синоним */
export function mergeExercise(db, from, to) {
  if (from === to) return;
  const f = db.exercises.find((e) => e.name === from);
  const t = db.exercises.find((e) => e.name === to);
  for (const w of db.workouts) {
    let changed = false;
    for (const it of w.items) if (it.type === 'sets' && it.exercise === from) { it.exercise = to; changed = true; }
    if (changed) w.updated = new Date().toISOString();
  }
  if (t) {
    t.aliases = [...new Set([...(t.aliases || []), from, ...((f && f.aliases) || [])])];
    if (f && !(t.muscles || []).length) t.muscles = f.muscles;
  }
  db.exercises = db.exercises.filter((e) => e.name !== from);
}

// ---------- история и сравнение ----------
const hasData = (s) => num(s.w) !== null || num(s.r) !== null;
export const filledSets = (it) => (it.sets || []).filter(hasData);

/** Цикл самой свежей тренировки — именно в него по умолчанию попадают новые */
export function latestCycle(db) {
  let best = null;
  for (const w of db.workouts) if (isISO(w.date) && (!best || w.date > best.date)) best = w;
  return best ? best.cycle : null;
}

/** Все выполнения упражнения по возрастанию даты */
export function historyOf(db, name) {
  const out = [];
  for (const w of db.workouts) for (const it of w.items) if (it.type === 'sets' && it.exercise === name && filledSets(it).length) out.push({ w, it });
  out.sort((a, b) => (a.w.date < b.w.date ? -1 : a.w.date > b.w.date ? 1 : (a.w.created || '') < (b.w.created || '') ? -1 : 1));
  return out;
}
/** Последнее такое же упражнение РАНЬШЕ по дате (хоть вчера, хоть месяц назад) */
export function prevOf(db, w, it) {
  const h = historyOf(db, it.exercise).filter((e) => e.w.id !== w.id && e.w.date < w.date);
  return h.length ? h[h.length - 1] : null;
}

export function setStats(sets, meta = {}) {
  let rounds = 0, reps = 0, maxW = null, minW = null, wr = 0, vol = 0;
  for (const s of sets) {
    const w = num(s.w), r = num(s.r);
    if (w === null && r === null) continue;
    rounds++;
    if (r !== null) reps += r;
    if (w !== null && w > 0) { maxW = maxW === null ? w : Math.max(maxW, w); minW = minW === null ? w : Math.min(minW, w); }
    wr += (w || 0) * (r || 0);
    // объём: вес × повторы; для своего веса и времени — просто сумма повторов/секунд
    vol += meta.unit === 'sec' || !(w > 0) ? (r || 0) : w * (r || 0);
  }
  return { rounds, reps, maxW, minW, vol, avgW: reps && wr ? wr / reps : null };
}

/**
 * Сравнение подходов с прошлым разом по номеру круга.
 * Возвращает cells[i] = { w, r } где значение 'better' | 'worse' | 'same' | null.
 * Для упражнений с облегчением (гравитрон) вес меньше = лучше.
 */
export function diffSets(prevSets, curSets, assist = false) {
  const cmp = (cur, prev, invert) => {
    const a = num(cur), b = num(prev);
    if (a === null) return null;
    if (b === null) return 'better';
    if (a === b) return 'same';
    return (a > b) !== invert ? 'better' : 'worse';
  };
  const cells = curSets.map((s, i) => {
    if (!hasData(s)) return { w: null, r: null };
    const p = prevSets && prevSets[i];
    if (!prevSets) return { w: null, r: null };
    if (!p || !hasData(p)) return { w: num(s.w) !== null ? 'better' : null, r: num(s.r) !== null ? 'better' : null, added: true };
    return { w: cmp(s.w, p.w, assist), r: cmp(s.r, p.r, false) };
  });
  return cells;
}

/** С чем сравнивать: 'last' — прошлый раз, 'best' — лучший по объёму, 'avg4' — среднее за последние 4 раза */
export const COMPARE_MODES = [['last', 'С прошлым разом'], ['best', 'С лучшим разом'], ['avg4', 'Со средним за 4 раза']];
export function refFor(db, w, it, mode = 'last') {
  const meta = exMeta(db, it.exercise);
  const hist = historyOf(db, it.exercise).filter((e) => e.w.id !== w.id && e.w.date < w.date);
  if (!hist.length) return null;
  if (mode === 'best') {
    let best = hist[0], bv = setStats(best.it.sets, meta).vol;
    for (const e of hist) { const v = setStats(e.it.sets, meta).vol; if (v >= bv) { best = e; bv = v; } }
    return { w: best.w, it: best.it, label: 'Лучший раз' };
  }
  if (mode === 'avg4') {
    const last = hist.slice(-4), n = Math.max(...last.map((e) => filledSets(e.it).length));
    const avg = (xs) => { const v = xs.map(num).filter((x) => x !== null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };
    const sets = Array.from({ length: n }, (_, i) => {
      const at = last.map((e) => e.it.sets[i]).filter(Boolean);
      return { w: avg(at.map((x) => x.w)), r: avg(at.map((x) => x.r)), note: '' };
    });
    return { w: last.at(-1).w, it: { sets, tempo: null }, label: `Среднее за ${last.length} ${last.length === 1 ? 'раз' : 'раза'}` };
  }
  const p = hist[hist.length - 1];
  return { w: p.w, it: p.it, label: 'Прошлый раз' };
}

export function compareItem(db, w, it, mode) {
  const meta = exMeta(db, it.exercise);
  const prev = refFor(db, w, it, mode || db.settings.compareMode || 'last');
  if (!prev) return { prev: null, cells: [], roundsDelta: 0, volPct: null, meta };
  const cur = setStats(it.sets, meta), old = setStats(prev.it.sets, meta);
  return {
    prev, meta,
    cells: diffSets(prev.it.sets, it.sets, meta.assist),
    roundsDelta: cur.rounds - old.rounds, curVol: cur.vol, prevVol: old.vol,
    volPct: old.vol > 0 && cur.vol > 0 ? ((cur.vol - old.vol) / old.vol) * 100 : null,
  };
}

/** Плато: в последних N выполнениях ни разу не побили лучшее из первого (вес лучше или объём +3%) */
export const plateauCfg = (db) => [Math.max(2, Number(db.settings.plateauN) || 4), Number(db.settings.plateauPct ?? 3)];
export function plateau(hist, meta, N = 4, pct = 3) {
  if (hist.length < N) return null;
  const last = hist.slice(-N);
  const st = last.map((e) => setStats(e.it.sets, meta));
  let bestW = meta.assist ? st[0].minW : st[0].maxW, bestVol = st[0].vol;
  for (const s of st.slice(1)) {
    const w = meta.assist ? s.minW : s.maxW;
    const wBetter = w !== null && bestW !== null && (meta.assist ? w < bestW : w > bestW);
    if (wBetter || s.vol > bestVol * (1 + pct / 100)) return null;
  }
  return { since: last[0].w.date, sessions: N, weight: bestW };
}

/**
 * Плато упражнения для Аналитики: упражнение делали минимум в двух циклах (разовые не считаем),
 * а в последних N занятиях не вырос ни вес, ни объём.
 */
export function plateauFor(db, name, hist = historyOf(db, name)) {
  const cycles = new Set(hist.map((e) => e.w.cycle));
  if (cycles.size < 2) return null;
  const r = plateau(hist, exMeta(db, name), ...plateauCfg(db));
  return r ? { ...r, cycles: cycles.size, total: hist.length, last: hist[hist.length - 1].w.date } : null;
}

// ---------- недели и календарь ----------
/** Уникальные даты тренировок */
export const workoutDates = (db) => [...new Set(db.workouts.map((w) => w.date).filter(isISO))].sort();
export function weekCounts(db) {
  const m = new Map();
  for (const d of workoutDates(db)) { const k = weekStart(d); m.set(k, (m.get(k) || 0) + 1); }
  return m;
}
/**
 * «Мягкая» серия недель: недели без единой тренировки (болезнь, отпуск) серию НЕ обнуляют — они просто пропускаются.
 * Серию прерывает только неделя, где тренировки были, но цель не выполнена. Текущая неделя серию не ломает, пока не закончилась.
 */
export function weekStreak(db, today) {
  const counts = weekCounts(db), goal = db.settings.perWeek || 1;
  const first = workoutDates(db)[0];
  if (!first) return 0;
  const firstK = weekStart(first);
  let k = weekStart(today), streak = 0;
  if ((counts.get(k) || 0) < goal) k = addDays(k, -7);
  while (k >= firstK) {
    const c = counts.get(k) || 0;
    if (c >= goal) streak++;
    else if (c > 0) break;
    k = addDays(k, -7);
  }
  return streak;
}

// ---------- проверка данных ----------
export function validate(db, today) {
  const out = [];
  const add = (level, text, link) => out.push({ level, text, link });
  const seen = new Map();
  for (const w of db.workouts) {
    const link = '#/w/' + w.id;
    const title = `${w.cycle} · ${wName(w)} · ${w.date || 'без даты'}`;
    if (!isISO(w.date)) { add('error', `${title}: дата не распознана`, link); continue; }
    if (w.date > addDays(today, 7)) add('warn', `${title}: дата в будущем`, link);
    if (w.date < '2015-01-01') add('warn', `${title}: очень старая дата`, link);
    const k = w.date + '|' + w.day;
    if (seen.has(k)) add('warn', `${title}: две тренировки «${wName(w)}» в один день — возможно, ошибка в дате`, link);
    seen.set(k, w.id);
    if (!w.items.length && !w.plan && !w.note) add('info', `${title}: пустая тренировка`, link);
    for (const it of w.items) {
      if (it.type === 'sets' && !filledSets(it).length) add('info', `${title}: «${it.exercise}» без данных`, link);
    }
  }
  // выбросы: вес сильно выше медианы по упражнению
  const byEx = new Map();
  for (const w of db.workouts) for (const it of w.items) if (it.type === 'sets') for (const s of it.sets) {
    const x = num(s.w); if (x) { if (!byEx.has(it.exercise)) byEx.set(it.exercise, []); byEx.get(it.exercise).push({ x, w }); }
  }
  for (const [ex, arr] of byEx) {
    if (arr.length < 6) continue;
    const med = [...arr].map((a) => a.x).sort((a, b) => a - b)[Math.floor(arr.length / 2)];
    for (const a of arr) if (a.x > med * 3) add('warn', `«${ex}»: вес ${a.x} кг (обычно около ${med}) — ${a.w.date}. Опечатка?`, '#/w/' + a.w.id);
  }
  for (const [a, b] of similarExercises(db)) add('info', `Похожие упражнения: «${a}» и «${b}». Если это одно и то же — объедини в разделе «Упражнения»`, '#/exercises');
  const dm = new Map();
  for (const m of db.measures) dm.set(m.date, (dm.get(m.date) || 0) + 1);
  for (const [d, c] of dm) if (c > 1) add('warn', `Замеры: несколько записей за ${d}`, '#/body');
  return out;
}

const stem = (w) => w.slice(0, 5);
// слова, которые есть в куче названий и ничего не говорят о самом упражнении
const STOP_STEMS = new Set(['кажду', 'ногу', 'одной', 'одну', 'руку', 'трена', 'кросс', 'смите', 'стоя', 'вес', 'с вес']);
const tokens = (s) => new Set(nameKey(s).split(/[^а-яa-z0-9]+/).filter((w) => w.length >= 4).map(stem).filter((t) => !STOP_STEMS.has(t)));
/** Уже существующие упражнения, похожие на введённое название («Гравитрон» → «Подтягивания в гравитроне») */
export function similarTo(db, name, limit = 4) {
  const a = tokens(name);
  if (!a.size) return [];
  return db.exercises
    .filter((e) => nameKey(e.name) !== nameKey(name))
    .map((e) => ({ e, n: [...tokens(e.name)].filter((t) => a.has(t)).length }))
    .filter((x) => x.n > 0).sort((x, y) => y.n - x.n)
    .filter((x, _, arr) => x.n === arr[0].n) // только самые близкие: общее слово вроде «подтягивания» само по себе не повод
    .slice(0, limit).map((x) => x.e);
}
export const dupKey = (a, b) => [nameKey(a), nameKey(b)].sort().join('|');
export function similarExercises(db) {
  const skip = new Set((db.settings && db.settings.notDup) || []);
  const names = db.exercises.map((e) => e.name);
  const out = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = tokens(names[i]), b = tokens(names[j]);
    if (!a.size || !b.size) continue;
    const inter = [...a].filter((x) => b.has(x)).length;
    if (inter / (a.size + b.size - inter) >= 0.6 && !skip.has(dupKey(names[i], names[j]))) out.push([names[i], names[j]]);
  }
  return out;
}

// ---------- слияние при синхронизации ----------
/** Слить две базы: тренировки по id (побеждает более поздний updated), удаления учитываются */
export function mergeDb(local, remote) {
  const out = emptyDb();
  const delMap = new Map();
  for (const d of [...(local.deleted || []), ...(remote.deleted || [])]) {
    if (!delMap.has(d.id) || delMap.get(d.id) < d.at) delMap.set(d.id, d.at);
  }
  const wm = new Map();
  for (const w of [...remote.workouts, ...local.workouts]) {
    const cur = wm.get(w.id);
    if (!cur || (w.updated || '') >= (cur.updated || '')) wm.set(w.id, w);
  }
  out.workouts = [...wm.values()].filter((w) => !(delMap.has(w.id) && delMap.get(w.id) >= (w.updated || '')));
  out.deleted = [...delMap].map(([id, at]) => ({ id, at })).filter((d) => !wm.has(d.id) || (wm.get(d.id).updated || '') <= d.at);
  const mm = new Map();
  for (const m of [...remote.measures, ...local.measures]) mm.set(m.date, m); // при совпадении даты — локальная запись
  out.measures = [...mm.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const em = new Map();
  for (const e of [...remote.exercises, ...local.exercises]) em.set(e.name, e);
  // упражнение, которое уже объединили с другим (его название лежит в синонимах другого) и которое нигде не используется,
  // не должно «воскресать» с другого устройства — иначе дубли возвращаются после каждой синхронизации
  const used = new Set(out.workouts.flatMap((w) => w.items.map((it) => it.exercise).filter(Boolean)));
  const merged = [...em.values()];
  const aliasKeys = new Set(merged.flatMap((e) => (e.aliases || []).map(nameKey)));
  out.exercises = merged.filter((e) => used.has(e.name) || !aliasKeys.has(nameKey(e.name)));
  out.settings = { ...remote.settings, ...local.settings, cycles: [...new Set([...(remote.settings.cycles || []), ...(local.settings.cycles || [])])],
    notDup: [...new Set([...((remote.settings || {}).notDup || []), ...((local.settings || {}).notDup || [])])] };
  out.importLog = local.importLog || [];
  out.rev = Math.max(local.rev || 0, remote.rev || 0) + 1;
  return out;
}

/** Круги → короткая строка для списков: "40×14, 45×14" */
export function setsLine(sets) {
  return sets.filter(hasData).map((s) => {
    const w = num(s.w);
    const r = s.r ?? '';
    return w ? `${String(w).replace('.', ',')}×${r}` : `${r}`;
  }).join(' · ');
}
export { weekStart, parseISO, isoDate };
