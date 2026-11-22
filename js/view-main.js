// Основные экраны: журнал (с календарём), аналитика, замеры.
import { h, put, refresh, toast, modal, fmtDate, fmtNum, fmtShort, parseInput, todayISO, isISO, addDays, weekStart, weekdayIdx, parseISO, daysBetween, WD, MONTHS_NOM, isoDate, pad } from './util.js';
import { state, markChanged } from './store.js';
import { filledSets, exMeta, ensureExercise, findExercise, historyOf, setStats, plateau, plateauCfg, weekCounts, weekStreak, workoutDates, setsLine, nameKey, num, similarExercises, wName, dayBadge } from './model.js';
import { createWorkout } from './view-workout.js';
import { lineChart, barChart, ring, sparkline, copyBtn } from './charts.js';
import { importDialog, mergeDialog } from './view-settings.js';

const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.created || '') < (a.created || '') ? -1 : 1);

// ======================= новая тренировка =======================
export function newWorkoutDialog(date = todayISO()) {
  const db = state.db;
  const dateIn = h('input', { type: 'date', class: 'date-in', value: date });
  const wdLabel = h('span', { class: 'muted' });
  const recent = [...db.workouts].filter((w) => isISO(w.date) && w.items.length).sort(byDateDesc).slice(0, 14);
  // названия, которые уже встречались: быстро подставить «День А», «Ноги» и т.п.
  const names = [...new Set(db.workouts.slice().sort(byDateDesc).map((w) => wName(w)).filter((n) => n !== 'Тренировка'))].slice(0, 6);
  const nameIn = h('input', { class: 'txt', placeholder: `Тренировка ${date}`, maxlength: 60 });
  const box = h('div', {});
  let showAll = false;
  modal((close) => {
    const go = (opts) => { if (!isISO(dateIn.value)) { toast('Выбери дату'); return; } const w = createWorkout({ ...opts, date: dateIn.value }); close(); location.hash = '#/w/' + w.id; };
    // подсказки пересчитываются при смене даты: «в понедельник копирую прошлый понедельник»
    const paint = () => {
      const d = isISO(dateIn.value) ? dateIn.value : date;
      wdLabel.textContent = WD[weekdayIdx(d)];
      nameIn.placeholder = `Тренировка ${d}`;
      const same = recent.find((w) => weekdayIdx(w.date) === weekdayIdx(d) && w.date < d);
      const ordered = same ? [same, ...recent.filter((w) => w !== same)] : recent;
      const shown = showAll ? ordered : ordered.slice(0, 3);
      box.replaceChildren(ordered.length ? h('div', {}, h('h4', {}, 'Или скопировать прошлую'),
        same ? null : h('small', { class: 'muted' }, `Раньше по ${WD[weekdayIdx(d)]} не занималась — последние тренировки:`),
        h('div', { class: 'pick-list compact' }, shown.map((w, i) => h('button', { class: 'pick', onclick: () => go({ from: w }) },
          h('b', {}, `${wName(w)} · ${fmtShort(w.date)}`,
            w === same ? h('span', { class: 'chip' }, `тот же день недели (${WD[weekdayIdx(d)]})`) : (!same && i === 0 ? h('span', { class: 'chip' }, 'последняя') : null)),
          h('small', {}, w.items.map((x) => x.exercise || x.title).filter(Boolean).slice(0, 3).join(', '))))),
        ordered.length > 3 ? h('button', { class: 'btn small', onclick: () => { showAll = !showAll; paint(); } }, showAll ? 'Свернуть' : `Показать ещё ${ordered.length - 3}`) : null) : null);
    };
    dateIn.addEventListener('change', paint);
    paint();
    return h('div', {}, h('h3', {}, 'Новая тренировка'),
      h('label', { class: 'fld' }, h('span', {}, 'Дата'), h('div', { class: 'row' }, dateIn, wdLabel)),
      h('label', { class: 'fld' }, h('span', {}, 'Название'), nameIn),
      names.length ? h('div', { class: 'row wrap' }, names.map((n) => h('button', { class: 'pill', onclick: () => { nameIn.value = n; nameIn.focus(); } }, n))) : null,
      h('button', { class: 'btn primary', onclick: () => go({ day: nameIn.value.trim() || nameIn.placeholder }) }, 'Создать пустую'),
      box,
      h('small', { class: 'muted' }, `Цикл: ${db.settings.currentCycle} (меняется в Настройках)`));
  });
}

// ======================= журнал =======================
function weekCard() {
  const db = state.db, today = todayISO();
  const counts = weekCounts(db), ws = weekStart(today), done = counts.get(ws) || 0, goal = db.settings.perWeek;
  const dates = new Set(workoutDates(db));
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  return h('section', { class: 'card week' },
    ring(done, goal),
    h('div', { class: 'grow' },
      h('b', {}, done >= goal ? 'Цель недели выполнена' : `На этой неделе ${done} из ${goal}`),
      h('div', { class: 'wk-days' }, days.map((d, i) => h('span', { class: 'wd' + (dates.has(d) ? ' done' : '') + (d === today ? ' today' : '') }, WD[i]))),
      h('small', { class: 'muted' }, `Серия недель по плану: ${weekStreak(db, today)}`)));
}

let calMonth = null;
export function journalView() {
  const db = state.db;
  const root = h('div', { class: 'page' });
  if (!db.workouts.length) {
    put(root, h('h1', {}, 'Тренировки'), h('section', { class: 'card onboard' },
      h('h3', {}, 'Давай начнём'),
      h('p', {}, 'Данные хранятся прямо в приложении. Самый быстрый старт — загрузить твой текущий Excel: всё разберётся автоматически.'),
      h('button', { class: 'btn primary', onclick: () => importDialog() }, '📂 Загрузить Excel с тренировками'),
      h('button', { class: 'btn', onclick: () => newWorkoutDialog() }, '＋ Начать с пустой тренировки'),
      h('a', { class: 'btn', href: '#/settings' }, '☁ Подключить GitHub (если данные уже там)')));
    return root;
  }
  const today = todayISO();
  if (!calMonth) calMonth = today.slice(0, 7);
  const [y, m] = calMonth.split('-').map(Number);
  const go = (d) => { const x = new Date(y, m - 1 + d, 1); calMonth = `${x.getFullYear()}-${pad(x.getMonth() + 1)}`; refresh(); };
  const monthBar = (extra) => h('div', { class: 'row between month-bar' },
    h('button', { class: 'ico big', 'aria-label': 'Предыдущий месяц', onclick: () => go(-1) }, '‹'),
    h('b', {}, `${MONTHS_NOM[m - 1]} ${y}`, extra || null),
    h('button', { class: 'ico big', 'aria-label': 'Следующий месяц', onclick: () => go(1) }, '›'));
  const cycles = [...new Set(db.workouts.map((w) => w.cycle))];
  const filter = journalView.filter || 'all';
  const sel = h('select', { class: 'sel', value: filter, onchange: (e) => { journalView.filter = e.target.value; refresh(); } },
    h('option', { value: 'all' }, 'Все циклы'), cycles.map((c) => h('option', { value: c }, c)));
  // календарь
  const first = `${calMonth}-01`, offset = weekdayIdx(first), dim = new Date(y, m, 0).getDate();
  const byDate = new Map();
  for (const w of db.workouts) if (isISO(w.date)) { if (!byDate.has(w.date)) byDate.set(w.date, []); byDate.get(w.date).push(w); }
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(h('div', { class: 'cal-cell empty' }));
  for (let d = 1; d <= dim; d++) {
    const date = `${calMonth}-${pad(d)}`, ws = byDate.get(date) || [];
    cells.push(h('button', { class: 'cal-cell' + (ws.length ? ' done' : '') + (date === today ? ' today' : ''), onclick: () => { if (ws.length) location.hash = '#/w/' + ws[0].id; else newWorkoutDialog(date); } },
      h('span', { class: 'cd' }, d), ws.length ? h('span', { class: 'dl' }, ws.map(dayBadge).join(' ')) : null));
  }
  const monthDays = [...byDate.keys()].filter((d) => d.startsWith(calMonth)).length;
  put(root, h('div', { class: 'row between' }, h('h1', {}, 'Журнал'), h('button', { class: 'btn primary', onclick: () => newWorkoutDialog() }, '＋ Тренировка')),
    h('section', { class: 'card' }, monthBar(),
      h('div', { class: 'cal-head' }, WD.map((x) => h('span', {}, x))),
      h('div', { class: 'cal' }, cells),
      h('small', { class: 'muted' }, `Тренировок в этом месяце: ${monthDays}. Нажми на пустой день, чтобы добавить.`)),
    weekCard(),
    h('section', { class: 'card month-card' }, monthBar(), cycles.length > 1 ? h('div', { class: 'row' }, sel) : null));
  const list = [...db.workouts].filter((w) => (filter === 'all' || w.cycle === filter) && isISO(w.date) && w.date.startsWith(calMonth)).sort(byDateDesc);
  if (!list.length) put(root, h('div', { class: 'empty small' }, 'В этом месяце тренировок нет'));
  for (const w of list) {
    put(root, h('a', { class: 'card wk-item', href: '#/w/' + w.id },
      h('div', { class: 'wk-date' }, h('b', {}, parseISO(w.date).getDate()), h('small', {}, WD[weekdayIdx(w.date)])),
      h('div', { class: 'grow' },
        h('div', {}, h('b', {}, wName(w)), ' ', h('small', { class: 'muted' }, w.cycle)),
        h('small', { class: 'muted' }, w.items.map((i) => i.exercise || i.title || 'Блок').slice(0, 4).join(' · ') + (w.items.length > 4 ? ` · +${w.items.length - 4}` : '')),
        w.items.length ? null : h('small', { class: 'muted' }, 'пусто'))));
  }
  return root;
}

// ======================= фильтр «год / месяц» =======================
const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
/** Подпись недели: «12–18 окт» или «28 окт–3 ноя» (неделя = понедельник–воскресенье) */
const weekLabel = (k) => {
  const a = parseISO(k), b = parseISO(addDays(k, 6));
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MONTH_SHORT[a.getMonth()]}` : `${a.getDate()} ${MONTH_SHORT[a.getMonth()]}–${b.getDate()} ${MONTH_SHORT[b.getMonth()]}`;
};
/** p = { year, month }: month 0 — весь год, year 0 — все годы (если allowAll) */
function periodBar(p, { allowAll = false } = {}) {
  const db = state.db, ys = new Set([new Date().getFullYear()]);
  for (const d of [...db.workouts.map((w) => w.date), ...db.measures.map((m) => m.date)]) if (isISO(d)) ys.add(Number(d.slice(0, 4)));
  return h('div', { class: 'row wrap' },
    h('select', { class: 'sel', value: String(p.year), onchange: (e) => { p.year = Number(e.target.value); refresh(); } },
      allowAll ? h('option', { value: '0' }, 'Все годы') : null, [...ys].sort((a, b) => b - a).map((y) => h('option', { value: String(y) }, y))),
    p.year ? h('select', { class: 'sel', value: String(p.month), onchange: (e) => { p.month = Number(e.target.value); refresh(); } },
      h('option', { value: '0' }, 'Весь год'), MONTHS_NOM.map((n, i) => h('option', { value: String(i + 1) }, n))) : null);
}
function periodRange(p) {
  if (!p.year) return ['0000-01-01', '9999-12-31'];
  if (!p.month) return [`${p.year}-01-01`, `${p.year}-12-31`];
  return [`${p.year}-${pad(p.month)}-01`, `${p.year}-${pad(p.month)}-${pad(new Date(p.year, p.month, 0).getDate())}`];
}
const now0 = new Date();
const bodyPeriod = { year: 0, month: 0 };

// ======================= аналитика =======================
function exerciseList(onPick, limit = 200, opts = {}) {
  const db = state.db;
  const input = h('input', { class: 'search', placeholder: '🔍 Найти упражнение: делала ли я это раньше?', autocomplete: 'off' });
  const list = h('div', { class: 'pick-list' });
  const paint = () => {
    const q = nameKey(input.value);
    if (opts.onQuery) opts.onQuery(q);
    if (opts.top && !q) { list.replaceChildren(); return; } // наверху страницы список показываем только когда что-то введено
    const rows = db.exercises.filter((e) => !q || nameKey(e.name).includes(q) || (e.aliases || []).some((a) => nameKey(a).includes(q)))
      .map((e) => ({ e, hist: historyOf(db, e.name) }))
      .sort((a, b) => ((b.hist.at(-1) || { w: { date: '' } }).w.date).localeCompare((a.hist.at(-1) || { w: { date: '' } }).w.date)).slice(0, limit);
    list.replaceChildren(...(rows.length ? rows.map(({ e, hist }) => {
      const last = hist.at(-1), pl = plateau(hist, exMeta(db, e.name), ...plateauCfg(db));
      return h('button', { class: 'pick', onclick: () => onPick(e.name) },
        h('b', {}, e.fav ? '★ ' : '', e.name, pl ? h('span', { class: 'chip worse' }, 'плато') : null),
        h('small', {}, last ? `${hist.length} раз · последний ${fmtDate(last.w.date)}: ${setsLine(last.it.sets)}` : 'Пока не выполнялось'));
    }) : [h('div', { class: 'empty small' }, q ? `«${input.value}» ещё не встречалось — значит, делаешь впервые.` : 'Упражнений пока нет')]));
  };
  input.addEventListener('input', paint); paint();
  return opts.noInput ? list : h('div', {}, input, list);
}

function favCard(e) {
  const db = state.db, meta = exMeta(db, e.name), hist = historyOf(db, e.name);
  const st = hist.map((x) => setStats(x.it.sets, meta));
  const useW = st.some((x) => x.maxW !== null);
  const last = hist.at(-1), ls = st.at(-1), ps = st.at(-2);
  let chip = null;
  if (ls && ps) {
    const wk = meta.assist ? ls.minW : ls.maxW, wp = meta.assist ? ps.minW : ps.maxW;
    if (wk !== null && wp !== null && wk !== wp) { const better = meta.assist ? wk < wp : wk > wp; chip = h('span', { class: 'chip ' + (better ? 'better' : 'worse') }, `вес ${better ? '+' : '−'}${fmtNum(Math.abs(wk - wp))} кг к прошлому`); }
    else if (ps.vol > 0) { const p = Math.round(((ls.vol - ps.vol) / ps.vol) * 100); chip = h('span', { class: 'chip ' + (p > 0 ? 'better' : p < 0 ? 'worse' : '') }, p === 0 ? 'как в прошлый раз' : `объём ${p > 0 ? '+' : '−'}${Math.abs(p)}% к прошлому`); }
  }
  return h('a', { class: 'card fav', href: '#/analytics/' + encodeURIComponent(e.name) },
    h('div', { class: 'grow' }, h('b', {}, '★ ' + e.name),
      h('div', { class: 'muted small' }, last ? `${fmtDate(last.w.date, false)}: ${setsLine(last.it.sets)}` : 'пока не выполнялось'), chip),
    sparkline(st.slice(-12).map((x) => (useW ? x.maxW ?? 0 : x.reps))));
}

export function analyticsView(name) {
  const db = state.db;
  const root = h('div', { class: 'page' });
  if (!name) {
    const favs = db.exercises.filter((e) => e.fav && historyOf(db, e.name).length >= 0);
    const plateaus = db.exercises.map((e) => ({ e, hist: historyOf(db, e.name) })).map((x) => ({ ...x, pl: plateau(x.hist, exMeta(db, x.e.name), ...plateauCfg(db)) })).filter((x) => x.pl)
      .sort((a, b) => (a.pl.since < b.pl.since ? -1 : 1));
    const tab = analyticsView.tab || (favs.length ? 'fav' : 'all');
    const pill = (k, label) => h('button', { class: 'pill' + (tab === k ? ' on' : ''), onclick: () => { analyticsView.tab = k; refresh(); } }, label);
    const body = h('div', {});
    put(root, h('h1', {}, 'Аналитика'),
      exerciseList((n) => { location.hash = '#/analytics/' + encodeURIComponent(n); }, 200, { top: true, onQuery: (q) => { body.hidden = !!q; } }),
      body);
    put(body, h('div', { class: 'row wrap' }, pill('fav', `★ Избранное (${favs.length})`), pill('plateau', `Плато (${plateaus.length})`), pill('all', 'Все упражнения')));
    if (tab === 'fav') {
      put(body, favs.length ? favs.map(favCard) : h('section', { class: 'card empty' }, 'Здесь будут упражнения, за которыми ты хочешь следить. Нажми ☆ рядом с названием — в тренировке или на странице упражнения.'));
    } else if (tab === 'plateau') {
      put(body, h('p', { class: 'muted small' }, `Плато — когда в последних ${plateauCfg(db)[0]} выполнениях упражнения не вырос ни вес, ни общий объём (больше чем на ${plateauCfg(db)[1]}%). Это не ошибка: иногда так и задумано тренером. Менять правило можно в Настройках.`),
        plateaus.length ? plateaus.map(({ e, pl, hist }) => h('a', { class: 'card', href: '#/analytics/' + encodeURIComponent(e.name) },
          h('b', {}, e.name), h('div', { class: 'muted small' }, `Не растёт с ${fmtDate(pl.since)} — ${pl.sessions} занятия подряд${pl.weight ? `, рабочий вес ${fmtNum(pl.weight)} кг` : ''}. Всего выполнялось ${hist.length} раз.`)))
          : h('section', { class: 'card empty' }, '✓ Плато не найдено'));
    } else {
      const dups = similarExercises(db);
      put(body, dups.length ? h('a', { class: 'card warn', href: '#/exercises' }, `Возможных дублей упражнений: ${dups.length}. Открыть и объединить →`) : null,
        h('section', { class: 'card' }, exerciseList((n) => { location.hash = '#/analytics/' + encodeURIComponent(n); }, 500, { noInput: true })));
    }
    return root;
  }
  const meta = exMeta(db, name), hist = historyOf(db, name);
  const stats = hist.map((e) => ({ e, s: setStats(e.it.sets, meta) }));
  const pl = plateau(hist, meta, ...plateauCfg(db));
  const hasWeight = stats.some((x) => x.s.maxW !== null);
  const unitWord = meta.unit === 'sec' ? 'секунд' : 'повторов';
  const last = stats.at(-1), prev = stats.at(-2);
  const best = hasWeight ? (meta.assist ? stats.reduce((a, b) => (b.s.minW !== null && (a === null || b.s.minW < a.s.minW) ? b : a), null) : stats.reduce((a, b) => (b.s.maxW !== null && (a === null || b.s.maxW > a.s.maxW) ? b : a), null)) : null;
  const tile = (label, value, sub) => h('div', { class: 'tile' }, h('small', { class: 'muted' }, label), h('b', {}, value), sub ? h('small', { class: 'muted' }, sub) : null);

  const mode = analyticsView.mode || 'session';
  const volSeries = () => {
    if (mode === 'week') {
      const wk = new Map();
      for (const x of stats) { const k = weekStart(x.e.w.date); wk.set(k, (wk.get(k) || 0) + x.s.vol); }
      return [...wk].map(([k, v]) => ({ label: fmtShort(k), value: Math.round(v), tip: `Неделя с ${fmtShort(k)}: ${Math.round(v)}` }));
    }
    return stats.map((x) => ({ label: fmtShort(x.e.w.date), value: Math.round(x.s.vol), tip: `${x.e.w.date}: ${Math.round(x.s.vol)}` }));
  };
  const wBox = h('div', {}, lineChart([
    { name: 'Макс. вес', cls: 's1', points: stats.filter((x) => x.s.maxW !== null).map((x) => ({ x: x.e.w.date, y: x.s.maxW, tip: setsLine(x.e.it.sets) })) },
    { name: 'Средний рабочий', cls: 's2', points: stats.filter((x) => x.s.avgW).map((x) => ({ x: x.e.w.date, y: Math.round(x.s.avgW * 10) / 10 })) }], { unit: 'кг' }));
  const volTitle = meta.unit === 'sec' ? 'Сколько секунд за тренировку' : hasWeight ? 'Сколько всего поднято' : 'Сколько повторов всего';
  const chartBox = h('div', {});
  const paintVol = () => chartBox.replaceChildren(barChart(volSeries()));
  paintVol();

  put(root, 
    h('div', { class: 'row between wrap' }, h('a', { class: 'back', href: '#/analytics' }, '← Аналитика'),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => { const e = ensureExercise(db, name); e.fav = !e.fav; markChanged(); refresh(); } }, (findExercise(db, name) || {}).fav ? '★ В избранном' : '☆ В избранное'),
        h('button', { class: 'btn small', onclick: () => mergeDialog(name, '', (nn) => { location.hash = '#/analytics/' + encodeURIComponent(nn); }) }, '✎ Переименовать / объединить'))),
    h('h1', {}, name),
    meta.assist ? h('div', { class: 'chips' }, h('span', { class: 'chip' }, 'вес = облегчение: меньше лучше')) : null,
    !hist.length ? h('section', { class: 'card empty' }, 'По этому упражнению пока нет заполненных тренировок.') : null,
    pl ? h('section', { class: 'card warn' }, `⚠ Плато: за последние ${pl.sessions} раза (с ${fmtDate(pl.since)}) вес и объём не росли. Может, пора изменить вес, число кругов или повторов — или это осознанное решение тренера.`) : null);
  if (!hist.length) return root;
  put(root, 
    h('div', { class: 'tiles' },
      tile('Последний раз', fmtDate(last.e.w.date, false), `${daysBetween(last.e.w.date, todayISO())} дн. назад`),
      tile('Всего раз', hist.length, `с ${fmtDate(hist[0].w.date, false)}`),
      best ? tile(meta.assist ? 'Меньше всего облегчения' : 'Макс. вес', `${fmtNum(meta.assist ? best.s.minW : best.s.maxW)} кг`, fmtDate(best.e.w.date, false)) : tile('Макс. за раз', fmtNum(Math.max(...stats.map((x) => x.s.reps))), unitWord),
      prev ? tile('Всего vs прошлый раз', `${last.s.vol >= prev.s.vol ? '+' : '−'}${prev.s.vol ? Math.abs(Math.round(((last.s.vol - prev.s.vol) / prev.s.vol) * 100)) : 0}%`, `${Math.round(last.s.vol)} vs ${Math.round(prev.s.vol)}`) : tile('Объём', Math.round(last.s.vol), 'первая запись')),
    hasWeight ? h('section', { class: 'card' }, h('div', { class: 'row between wrap' }, h('h3', {}, 'Вес по времени'),
      copyBtn(() => wBox, { title: `${name} — вес по времени`, legend: [{ cls: 's1', label: 'Макс. вес' }, { cls: 's2', label: 'Средний (с учётом повторов)' }] })), wBox,
      h('div', { class: 'legend' }, h('span', { class: 'sw s1' }), 'Макс. вес', h('span', { class: 'sw s2' }), 'Средний (с учётом повторов)')) : null,
    h('section', { class: 'card' }, h('div', { class: 'row between wrap' }, h('h3', {}, volTitle),
      h('div', { class: 'row wrap' }, h('div', { class: 'seg' }, [['session', 'По тренировкам'], ['week', 'По неделям']].map(([k, l]) => h('button', { class: 'pill' + (mode === k ? ' on' : ''), onclick: () => { analyticsView.mode = k; refresh(); } }, l))),
        copyBtn(chartBox, () => ({ title: `${name} — ${volTitle.toLowerCase()} (${mode === 'week' ? 'по неделям' : 'по тренировкам'})` })))), chartBox,
      h('p', { class: 'muted small' }, volExplain(last, meta, hasWeight))),
    h('section', { class: 'card' }, h('h3', {}, 'История'),
      h('div', { class: 'hist' }, [...stats].reverse().map((x) => h('a', { class: 'hist-row', href: '#/w/' + x.e.w.id },
        h('b', {}, fmtDate(x.e.w.date)), h('span', { class: 'muted' }, wName(x.e.w)),
        h('span', { class: 'grow' }, setsLine(x.e.it.sets)), x.e.it.note ? h('small', { class: 'muted' }, x.e.it.note) : null)))));
  return root;
}

/** Понятное объяснение графика на примере последней тренировки */
function volExplain(last, meta, hasWeight) {
  const sets = filledSets(last.e.it);
  const fmtBig = (x) => Math.round(x).toLocaleString('ru-RU');
  if (meta.unit === 'sec') return `Для каждой тренировки складываются секунды по всем кругам. Последний раз: ${sets.map((s) => num(s.r) ?? 0).join(' + ')} = ${fmtBig(last.s.vol)} с. Если столбики растут, значит ты держишь дольше.`;
  if (!hasWeight) return `Для каждой тренировки складываются повторы по всем кругам. Последний раз: ${sets.map((s) => num(s.r) ?? 0).join(' + ')} = ${fmtBig(last.s.vol)}. Если столбики растут, значит ты делаешь больше.`;
  return `Для каждого круга считаем вес × повторы и складываем по всем кругам. Последний раз: ${sets.map((s) => `${fmtNum(num(s.w) ?? 0)}×${num(s.r) ?? 0}`).join(' + ')} = ${fmtBig(last.s.vol)} кг. Если вес прежний, а столбики растут — ты делаешь больше работы (больше кругов или повторов). «По неделям» — сумма за все тренировки недели.`;
}

// ======================= замеры =======================
const BODY = [['weight', 'Вес', 'кг'], ['chest', 'ОГ (грудь)', 'см'], ['waist', 'ОТ (талия)', 'см'], ['hips', 'ОБ (бёдра)', 'см']];
export function bodyView() {
  const db = state.db;
  const root = h('div', { class: 'page' });
  const date = h('input', { type: 'date', class: 'date-in', value: todayISO() });
  const inputs = Object.fromEntries(BODY.map(([k, l, u]) => [k, h('input', { class: 'num', inputmode: 'decimal', placeholder: u })]));
  const fill = (d) => { const m = db.measures.find((x) => x.date === d); for (const [k] of BODY) inputs[k].value = m ? fmtNum(m[k]) : ''; };
  date.addEventListener('change', () => fill(date.value)); fill(date.value);
  const save = () => {
    if (!isISO(date.value)) { toast('Выбери дату'); return; }
    const rec = { date: date.value, ...Object.fromEntries(BODY.map(([k]) => [k, num(parseInput(inputs[k].value))])) };
    if (BODY.every(([k]) => rec[k] === null)) { toast('Заполни хотя бы одно поле — пустую запись сохранить нельзя'); return; }
    db.measures = db.measures.filter((x) => x.date !== rec.date); db.measures.push(rec);
    db.measures.sort((a, b) => (a.date < b.date ? -1 : 1)); markChanged(); toast('Сохранено'); refresh();
  };
  put(root, h('h1', {}, 'Замеры'),
    h('section', { class: 'card' }, h('div', { class: 'row wrap' }, date), h('div', { class: 'grid4' }, BODY.map(([k, l, u]) => h('label', { class: 'fld' }, h('span', {}, `${l}, ${u}`), inputs[k]))),
      h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: save }, 'Сохранить'))),
    h('section', { class: 'card' }, h('div', { class: 'row between wrap' }, h('h3', {}, 'Графики'), periodBar(bodyPeriod, { allowAll: true }))),
    ...BODY.map(([k, l, u]) => {
      const [from, to] = periodRange(bodyPeriod);
      const pts = db.measures.filter((m) => m[k] !== null && m[k] !== undefined && isISO(m.date) && m.date >= from && m.date <= to).map((m) => ({ x: m.date, y: m[k] }));
      const box = h('div', {}, pts.length ? lineChart([{ name: l, cls: 's1', points: pts }], { unit: u }) : h('div', { class: 'empty small' }, 'Нет замеров за выбранный период'));
      return h('section', { class: 'card' }, h('div', { class: 'row between wrap' }, h('h3', {}, `${l}, ${u}`), pts.length ? copyBtn(box, { title: `${l}, ${u}` }) : null), box);
    }),
    h('section', { class: 'card' }, h('h3', {}, 'Записи'), h('small', { class: 'muted' }, 'Стрелки показывают изменение к предыдущему замеру. Цветом не окрашиваются: «лучше» здесь зависит от цели.'),
      h('div', { class: 'hist' }, [...db.measures].reverse().map((m, i, arr) => {
        const p = arr[i + 1];
        return h('div', { class: 'hist-row' }, h('b', { onclick: () => { date.value = m.date; fill(m.date); window.scrollTo(0, 0); } }, fmtDate(m.date, false)),
          BODY.map(([k, l]) => m[k] == null ? h('span', { class: 'muted' }, '—') : h('span', {}, `${l.split(' ')[0]} ${fmtNum(m[k])}`, p && p[k] != null && p[k] !== m[k] ? h('small', { class: 'muted' }, m[k] > p[k] ? ' ▲' : ' ▼') : '')),
          h('button', { class: 'ico', title: 'Удалить', onclick: () => { db.measures = db.measures.filter((x) => x.date !== m.date); markChanged(); refresh(); } }, '✕'));
      }))));
  return root;
}
