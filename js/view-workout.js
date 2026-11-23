// Экран тренировки: ввод, редактирование, сравнение с прошлым разом (зелёный/красный).
import { icon } from './icons.js';
import { goto, h, refresh, toast, modal, confirmBox, fmtDate, fmtNum, parseInput, todayISO, uid, nowISO, isISO, plural, WD, weekdayIdx } from './util.js';
import { state, touch, markChanged, deleteWorkout, putMedia } from './store.js';
import { compareItem, exMeta, ensureExercise, findExercise, historyOf, setsLine, filledSets, nameKey, similarTo, wName, fieldsOf, tempoText, normName } from './model.js';
import { shareWorkout } from './share.js';
import { openTimer } from './timer.js';
import { startRest } from './rest.js';
import { mediaStrip, linkStrip, mediaButtons } from './media-ui.js';
import { mergeDialog } from './view-settings.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

export function createWorkout({ date = todayISO(), day = '', from = null } = {}) {
  const db = state.db;
  const w = { id: uid('w'), cycle: db.settings.currentCycle, date, day: from ? from.day : day, plan: from ? from.plan || '' : '', note: '', created: nowISO(), updated: nowISO(), items: from ? clone(from.items) : [] };
  db.workouts.push(w);
  markChanged();
  return w;
}
/** Пустую тренировку, из которой ушли, не храним */
export function dropIfEmpty(id) {
  const db = state.db, w = db.workouts.find((x) => x.id === id);
  if (w && !w.items.length && !w.plan && !w.note) { db.workouts = db.workouts.filter((x) => x.id !== id); markChanged(); }
}

// ---------- добавление упражнения ----------
function addDialog(w, rerender, replaceIt = null) {
  const db = state.db;
  const search = h('input', { class: 'search', placeholder: 'Название упражнения…', autocomplete: 'off' });
  const list = h('div', { class: 'pick-list' });
  const kind = h('select', { class: 'sel' }, h('option', { value: 'weighted' }, 'С весом'), h('option', { value: 'bodyweight' }, 'Свой вес'), h('option', { value: 'time' }, 'На время (сек)'));
  let close;
  const pick = (name, mode) => {
    const e = ensureExercise(db, name);
    if (mode === 'time') { e.unit = 'sec'; mode = 'bodyweight'; }
    if (replaceIt) { replaceIt.exercise = e.name; touch(w); close(); rerender(); return; }
    const last = historyOf(db, e.name).pop();
    const rounds = last ? filledSets(last.it).length : 3;
    const item = { type: 'sets', exercise: e.name, mode: last ? last.it.mode : mode || 'weighted', note: '', sets: Array.from({ length: rounds }, () => ({ w: null, r: null, note: '' })), media: [] };
    if (last) { if (last.it.fields) item.fields = clone(last.it.fields); if (last.it.tempo) item.tempo = [...last.it.tempo]; if (last.it.links) item.links = [...last.it.links]; }
    w.items.push(item);
    touch(w); close(); rerender();
  };
  const last = (e) => historyOf(db, e.name).pop();
  const rowFor = (e, hint) => h('button', { class: 'pick', onclick: () => pick(e.name, null) },
    h('b', {}, e.fav ? '★ ' : '', e.name, hint ? h('span', { class: 'chip' }, hint) : null),
    h('small', {}, last(e) ? `Последний раз ${fmtDate(last(e).w.date)}: ${setsLine(last(e).it.sets)}` : 'Ещё не делала'));
  const byRecent = (a, b) => ((last(b) && last(b).w.date) || '').localeCompare((last(a) && last(a).w.date) || '');
  // «Гравитрон» должен подсказать «Подтягивания в гравитроне», если я уже делала это под другим названием
  async function createNew() {
    const name = search.value.trim();
    if (!name) return;
    const sims = similarTo(db, name, 3);
    if (sims.length) {
      const choice = await new Promise((res) => {
        let done = false;
        modal((c) => h('div', {}, h('h3', {}, 'Похоже, это уже было'),
          h('p', { class: 'muted' }, `Ты вводишь «${name}». Если это то же упражнение, выбери его — история и сравнение с прошлым разом сохранятся.`),
          sims.map((e) => h('button', { class: 'pick', onclick: () => { done = true; c(); res(e.name); } }, h('b', {}, `Это «${e.name}»`), h('small', {}, last(e) ? `Последний раз ${fmtDate(last(e).w.date)}` : ''))),
          h('button', { class: 'btn', onclick: () => { done = true; c(); res('__new__'); } }, `Нет, создать новое «${name}»`)), () => { if (!done) res(null); });
      });
      if (choice === null) return;
      if (choice !== '__new__') { pick(choice, null); return; }
    }
    pick(name, kind.value);
  }
  const paint = () => {
    const q = nameKey(search.value);
    const direct = db.exercises.filter((e) => !q || nameKey(e.name).includes(q) || (e.aliases || []).some((a) => nameKey(a).includes(q))).sort(byRecent);
    const similar = q ? similarTo(db, search.value, 4).filter((e) => !direct.includes(e)) : [];
    list.replaceChildren(...direct.slice(0, 40).map((e) => rowFor(e)), ...similar.map((e) => rowFor(e, 'похоже')));
    if (q && !db.exercises.some((e) => nameKey(e.name) === q)) {
      list.prepend(h('div', { class: 'pick create' }, h('span', {}, (direct.length || similar.length) ? `Нет подходящего? Создать «${search.value.trim()}»` : `Создать «${search.value.trim()}»`), kind,
        h('button', { class: 'btn primary', onclick: createNew }, 'Добавить')));
    }
  };
  search.addEventListener('input', paint);
  modal((c) => {
    close = c;
    return h('div', {}, h('h3', {}, replaceIt ? 'Заменить упражнение' : 'Добавить упражнение'),
      replaceIt ? null : h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { w.items.push({ type: 'free', title: '', text: '', media: [] }); touch(w); c(); rerender(); } }, icon('plus'), 'Свободный блок'),
        h('button', { class: 'btn', onclick: () => { w.items.push({ type: 'interval', title: 'Табата', format: 'Табата', work: 20, rest: 10, rounds: 8, moves: '', text: '', result: '', media: [] }); touch(w); c(); rerender(); } }, icon('timer'), 'Табата')),
      search, list);
  });
  paint(); setTimeout(() => search.focus(), 50);
}

// ---------- карточка упражнения с кругами ----------
const mark = (el, cls) => { el.classList.remove('better', 'worse', 'same'); if (cls) el.classList.add(cls); };

function setsCard(w, it, ctx) {
  const db = state.db, meta = exMeta(db, it.exercise);
  const cmp0 = compareItem(db, w, it), prev = cmp0.prev;
  const F = fieldsOf(it);
  const weighted = F.w;
  const chip = h('div', { class: 'chips' });
  const rows = [];
  const tbody = h('tbody');

  const paint = () => {
    const c = compareItem(db, w, it);
    rows.forEach((r, i) => { mark(r.w, c.cells[i] && c.cells[i].w); mark(r.r, c.cells[i] && c.cells[i].r); });
    const parts = [];
    const fmtBig = (x) => Math.round(x).toLocaleString('ru-RU');
    if (!c.prev) parts.push(h('span', { class: 'chip' }, 'раньше не было'));
    else {
      if (c.roundsDelta) parts.push(h('span', { class: 'chip ' + (c.roundsDelta > 0 ? 'better' : 'worse') }, `${c.roundsDelta > 0 ? '+' : '−'}${Math.abs(c.roundsDelta)} ${plural(c.roundsDelta, ['круг', 'круга', 'кругов'])}`));
      if (c.volPct !== null && Math.abs(c.volPct) >= 0.5) {
        const what = meta.unit === 'sec' ? 'секунд' : weighted ? 'поднято' : 'повторов';
        const kg = weighted && meta.unit !== 'sec' ? ' кг' : '';
        parts.push(h('span', { class: 'chip ' + (c.volPct > 0 ? 'better' : 'worse'), title: 'Сумма «вес × повторы» по всем кругам' },
          `Всего ${what} ${c.volPct > 0 ? '+' : '−'}${Math.abs(Math.round(c.volPct))}%: ${fmtBig(c.curVol)} против ${fmtBig(c.prevVol)}${kg}`));
      }
      if (!parts.length) parts.push(h('span', { class: 'chip' }, 'без изменений'));
    }
    chip.replaceChildren(...parts);
  };

  const cols = (weighted ? 1 : 0) + (F.r ? 1 : 0);
  function buildRow(s, i) {
    const p = prev && prev.it.sets[i];
    const wIn = weighted ? h('input', { class: 'num', inputmode: 'decimal', 'aria-label': 'Вес', value: fmtNum(s.w), placeholder: p ? fmtNum(p.w) : '', onfocus: (e) => e.target.select(), oninput: (e) => { s.w = parseInput(e.target.value); touch(w); paint(); } }) : null;
    const rIn = F.r ? h('input', { class: 'num', inputmode: 'decimal', 'aria-label': meta.unit === 'sec' ? 'Секунды' : 'Повторы', value: fmtNum(s.r), placeholder: p ? fmtNum(p.r) : '', onfocus: (e) => e.target.select(), oninput: (e) => { s.r = parseInput(e.target.value); touch(w); paint(); } }) : null;
    const noteIn = h('input', { class: 'note-in', placeholder: 'Комментарий к кругу (например: с резинкой)', value: s.note || '', oninput: (e) => { s.note = e.target.value; touch(w); } });
    const noteRow = h('tr', { class: 'note-row' }, h('td', {}), h('td', { colspan: cols + 1 }, noteIn));
    if (!s.note) noteRow.hidden = true;
    rows.push({ w: wIn || document.createElement('i'), r: rIn || document.createElement('i') });
    return [
      h('tr', {}, h('td', { class: 'n' }, i + 1), weighted ? h('td', {}, wIn) : null, F.r ? h('td', {}, rIn) : null,
        h('td', { class: 'acts' },
          h('button', { class: 'ico' + (s.note ? ' on' : ''), title: 'Комментарий к подходу', 'aria-label': 'Комментарий к подходу', onclick: () => { noteRow.hidden = !noteRow.hidden; if (!noteRow.hidden) noteIn.focus(); } }, icon('comment')),
          h('button', { class: 'ico', title: 'Удалить подход', 'aria-label': 'Удалить подход', onclick: () => { if (it.sets.length > 1) { it.sets.splice(i, 1); touch(w); ctx.rerender(); } } }, icon('x')))),
      noteRow];
  }
  it.sets.forEach((s, i) => tbody.append(...buildRow(s, i)));

  const prevLine = prev ? h('div', { class: 'prev' }, `${prev.label || 'Прошлый раз'} · ${fmtDate(prev.w.date, false)}: `, h('span', {}, setsLine(prev.it.sets)), prev.it.tempo && tempoText(prev.it) ? ` · темп ${tempoText(prev.it)}` : '') : null;
  const unit = meta.unit === 'sec' ? 'Сек' : 'Повт';
  const star = h('button', { class: 'ico star' + (meta.fav ? ' on' : ''), title: 'В избранное', 'aria-label': 'В избранное', onclick: (ev) => { const e = ensureExercise(db, it.exercise); e.fav = !e.fav; markChanged(); star.replaceChildren(icon(e.fav ? 'star' : 'starO')); star.classList.toggle('on', e.fav); } }, icon(meta.fav ? 'star' : 'starO'));
  // темп: 4 числа — подъём, пауза вверху, опускание, пауза внизу
  const tempoLabels = ['Вверх, с', 'Пауза, с', 'Вниз, с', 'Пауза, с'];
  const tempoRow = F.t ? h('div', { class: 'tempo' }, h('small', { class: 'muted' }, 'Темп'),
    h('div', { class: 'tempo-grid' }, tempoLabels.map((l, k) => h('label', { class: 'fld' }, h('span', {}, l),
      h('input', { class: 'num', inputmode: 'decimal', value: it.tempo && it.tempo[k] !== undefined && it.tempo[k] !== null ? it.tempo[k] : '', placeholder: '0', onfocus: (e) => e.target.select(),
        oninput: (e) => { it.tempo = it.tempo || [null, null, null, null]; it.tempo[k] = parseInput(e.target.value); touch(w); } }))))) : null;
  const restSec = Number(db.settings.restSec) || 60;
  const card = h('article', { class: 'card ex' },
    h('header', { class: 'ex-head' },
      h('button', { class: 'ex-name-btn', title: 'Изменить название', onclick: () => renameDialog(w, it, ctx) }, it.exercise),
      star,
      h('button', { class: 'ico', title: 'Выше', 'aria-label': 'Выше', disabled: w.items.indexOf(it) === 0, onclick: () => ctx.move(it, -1) }, icon('up')),
      h('button', { class: 'ico', title: 'Ниже', 'aria-label': 'Ниже', disabled: w.items.indexOf(it) === w.items.length - 1, onclick: () => ctx.move(it, 1) }, icon('down')),
      h('button', { class: 'ico', title: 'Ещё', 'aria-label': 'Ещё', onclick: () => exMenu(w, it, ctx) }, icon('dots'))),
    chip, prevLine, tempoRow,
    h('table', { class: 'sets' },
      h('thead', {}, h('tr', {}, h('th', {}, '№'), weighted ? h('th', {}, 'Вес, кг') : null, F.r ? h('th', {}, unit) : null, h('th', {}))),
      tbody),
    h('div', { class: 'tools-row' },
      h('button', { class: 'btn small grow', onclick: () => { const l = it.sets[it.sets.length - 1] || {}; it.sets.push({ w: l.w ?? null, r: l.r ?? null, note: '' }); touch(w); ctx.rerender(); } }, icon('plus'), 'Подход'),
      ...mediaButtons(it, w, ctx.rerender)),
    h('button', { class: 'btn rest-big', title: 'Время отдыха меняется в Настройках', onclick: () => startRest(restSec) }, icon('timer'), `Отдых ${restSec} с`),
    it.note ? h('input', { class: 'note-in', placeholder: 'Комментарий к упражнению', value: it.note || '', oninput: (e) => { it.note = e.target.value; touch(w); } }) : null,
    linkStrip(it, w, ctx.rerender),
    mediaStrip(it, w, ctx.rerender));
  paint();
  return card;
}

/** Меню «⋯» у упражнения: настройка полей и удаление */
function exMenu(w, it, ctx) {
  modal((close) => h('div', {}, h('h3', {}, it.exercise),
    h('div', { class: 'col' },
      h('button', { class: 'btn', onclick: () => { close(); fieldsDialog(w, it, ctx); } }, icon('sliders'), 'Редактировать упражнение (поля)'),
      h('button', { class: 'btn danger', onclick: () => { close(); ctx.remove(it); } }, icon('trash'), 'Удалить упражнение'),
      h('button', { class: 'btn', onclick: close }, 'Закрыть'))));
}

/** Переименовать упражнение в этой тренировке (или сразу везде) */
function renameDialog(w, it, ctx) {
  const db = state.db;
  const input = h('input', { class: 'txt', value: it.exercise });
  modal((close) => h('div', {}, h('h3', {}, 'Название упражнения'),
    h('p', { class: 'muted' }, 'Изменится только в этой тренировке. Если упражнение везде называется неправильно — нажми «Переименовать везде».'), input,
    h('div', { class: 'row wrap end' },
      h('button', { class: 'btn', onclick: () => { const n = it.exercise; close(); mergeDialog(n, '', (nn) => { ctx.rerender(); void nn; }); } }, 'Переименовать везде…'),
      h('button', { class: 'btn primary', onclick: () => {
        const name = normName(input.value); if (!name) return;
        if (name !== it.exercise) {
          const e = ensureExercise(db, name); it.exercise = e.name; touch(w);
          toast(`Теперь «${e.name}» — только в этой тренировке`);
        }
        close(); ctx.rerender();
      } }, 'Сохранить'))));
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

/** Что вводится в упражнении: вес, повторы, темп */
function fieldsDialog(w, it, ctx) {
  const db = state.db, F = fieldsOf(it), meta = exMeta(db, it.exercise);
  const box = (label, on, hint) => { const c = h('input', { type: 'checkbox', checked: on }); return { c, el: h('label', { class: 'chk big' }, c, h('span', {}, h('b', {}, label), hint ? h('small', { class: 'muted' }, hint) : null)) }; };
  const fw = box('Вес', F.w, 'гантели, штанга, тренажёр. Для упражнений со своим весом — выключи'), fr = box('Повторы', F.r, 'сколько раз (или секунд — выбери ниже)'), ft = box('Темп', F.t, 'сколько секунд вверх, пауза, вниз, пауза');
  const unit = h('select', { class: 'sel', value: meta.unit }, h('option', { value: 'reps' }, 'повторы'), h('option', { value: 'sec' }, 'секунды'));
  modal((close) => h('div', {}, h('h3', {}, 'Что вводить в упражнении'), h('p', { class: 'muted' }, `«${it.exercise}». Круги добавляются кнопкой «＋ круг». Уже введённые значения не пропадут, даже если поле скрыть.`),
    fw.el, fr.el, ft.el, h('label', { class: 'fld' }, h('span', {}, 'Считать в (для этого упражнения во всех тренировках)'), unit),
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: close }, 'Отмена'), h('button', { class: 'btn primary', onclick: () => {
      if (!fw.c.checked && !fr.c.checked) { toast('Нужно хотя бы одно поле: вес или повторы'); return; }
      it.fields = { w: fw.c.checked, r: fr.c.checked, t: ft.c.checked };
      it.mode = it.fields.w ? 'weighted' : 'bodyweight';
      const e = ensureExercise(db, it.exercise); e.unit = unit.value;
      touch(w); markChanged(); close(); ctx.rerender();
    } }, 'Сохранить'))));
}

// ---------- свободный и интервальный блоки ----------
function freeCard(w, it, ctx) {
  return h('article', { class: 'card ex' },
    h('header', { class: 'ex-head' }, h('input', { class: 'title-in', placeholder: 'Название блока', value: it.title || '', oninput: (e) => { it.title = e.target.value; touch(w); } }),
      h('div', { class: 'ex-tools' }, h('button', { class: 'ico', onclick: () => ctx.move(it, -1) }, '↑'), h('button', { class: 'ico', onclick: () => ctx.move(it, 1) }, '↓'), h('button', { class: 'ico del', title: 'Удалить блок', 'aria-label': 'Удалить блок', onclick: () => ctx.remove(it) }, icon('trash')))),
    h('textarea', { class: 'area', rows: 4, placeholder: 'Любой текст: что делали, сообщение от тренера…', oninput: (e) => { it.text = e.target.value; touch(w); } }, it.text || ''),
    h('div', { class: 'tools' }, ...mediaButtons(it, w, ctx.rerender)),
    linkStrip(it, w, ctx.rerender),
    mediaStrip(it, w, ctx.rerender));
}
const fmtT = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
const tabataTotal = (it) => (it.work || 0) * (it.rounds || 0) + (it.rest || 0) * Math.max((it.rounds || 1) - 1, 0);

/** Настройка табаты: формат, работа / отдых / раунды со стрелками, список движений */
function tabataDialog(w, it, ctx) {
  const D = { format: it.format || 'Табата', work: it.work ?? 20, rest: it.rest ?? 10, rounds: it.rounds ?? 8, moves: it.moves || '' };
  const total = h('b', {});
  const upd = () => { total.textContent = tabataTotal(D) ? fmtT(tabataTotal(D)) : '—'; };
  const stepper = (key, label, unit, step, min) => {
    const val = h('input', { class: 'tb-val', inputmode: 'numeric', 'aria-label': label, value: D[key], onfocus: (e) => e.target.select(), oninput: (e) => { D[key] = Math.max(min, Number(e.target.value) || 0); upd(); } });
    const bump = (d) => { D[key] = Math.max(min, (Number(D[key]) || 0) + d); val.value = D[key]; upd(); };
    return h('div', { class: 'tb-step' }, h('small', { class: 'muted' }, label),
      h('div', { class: 'tb-ctl' }, h('button', { class: 'tb-btn', 'aria-label': `${label} меньше`, onclick: () => bump(-step) }, '−'), val, h('button', { class: 'tb-btn', 'aria-label': `${label} больше`, onclick: () => bump(step) }, '+')),
      h('small', { class: 'muted' }, unit));
  };
  const fmtRow = h('div', { class: 'pf' });
  const paintFmt = () => fmtRow.replaceChildren(...['Табата', 'EMOM', 'AMRAP', 'Круговая', 'Другое'].map((f) => h('button', { class: 'pill' + (D.format === f ? ' on' : ''), onclick: () => { D.format = f; paintFmt(); } }, f)));
  paintFmt(); upd();
  modal((close) => h('div', {}, h('h3', {}, 'Настройка таймера'), fmtRow,
    h('div', { class: 'tb-steppers' }, stepper('work', 'Работа', 'сек', 5, 5), stepper('rest', 'Отдых', 'сек', 5, 0), stepper('rounds', 'Раунды', '', 1, 1)),
    h('div', { class: 'tb-total' }, h('span', { class: 'muted' }, 'Всего'), total),
    h('label', { class: 'fld wide' }, h('span', {}, 'Движения (по одному в строке)'), h('textarea', { class: 'area', rows: 5, placeholder: 'Берпи\nСкалолаз\nПрыжки…', oninput: (e) => { D.moves = e.target.value; } }, D.moves)),
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: close }, 'Отмена'),
      h('button', { class: 'btn primary', onclick: () => { Object.assign(it, D); touch(w); close(); ctx.rerender(); } }, 'Сохранить'))));
}

function intervalCard(w, it, ctx) {
  const moves = (it.moves || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const total = tabataTotal(it);
  const chip = (t) => h('button', { class: 'chip tb-chip', onclick: () => tabataDialog(w, it, ctx) }, t);
  const row = (label, summary, open, ...inner) => {
    const d = h('details', { class: 'tb-row', open }, h('summary', {}, h('span', {}, label), h('span', { class: 'muted tb-sum' }, summary || 'добавить')), ...inner);
    return d;
  };
  return h('article', { class: 'card ex interval tabata' },
    h('header', { class: 'ex-head' }, h('input', { class: 'title-in', placeholder: 'Название', value: it.title || '', oninput: (e) => { it.title = e.target.value; touch(w); } }),
      h('div', { class: 'ex-tools' }, h('button', { class: 'ico', title: 'Выше', 'aria-label': 'Выше', disabled: w.items.indexOf(it) === 0, onclick: () => ctx.move(it, -1) }, icon('up')), h('button', { class: 'ico', title: 'Ниже', 'aria-label': 'Ниже', disabled: w.items.indexOf(it) === w.items.length - 1, onclick: () => ctx.move(it, 1) }, icon('down')),
        h('button', { class: 'ico del', title: 'Удалить блок', 'aria-label': 'Удалить блок', onclick: () => ctx.remove(it) }, icon('trash')))),
    h('div', { class: 'chips' }, chip(it.format || 'Табата'), chip(`${it.work || 0} с работа`), chip(`${it.rest || 0} с отдых`), chip(`${it.rounds || 0} ${plural(it.rounds || 0, ['раунд', 'раунда', 'раундов'])}`), total ? chip(fmtT(total)) : null,
      h('button', { class: 'ico', title: 'Настроить', 'aria-label': 'Настроить', onclick: () => tabataDialog(w, it, ctx) }, icon('edit'))),
    moves.length ? h('ol', { class: 'tb-moves' }, moves.map((m) => h('li', {}, m))) : h('button', { class: 'btn small', onclick: () => tabataDialog(w, it, ctx) }, icon('plus'), 'Добавить движения'),
    it.work && it.rounds ? h('button', { class: 'btn primary tb-start', onclick: () => openTimer({ title: it.title || it.format, work: it.work, rest: it.rest || 0, rounds: it.rounds, moves }) }, `▶ Старт таймера · ${fmtT(total)}`) : null,
    row('Результат', it.result, !!it.result, h('input', { class: 'note-in', placeholder: 'Сколько сделала, как зашло', value: it.result || '', oninput: (e) => { it.result = e.target.value; touch(w); } })),
    row('Описание от тренера', it.text ? it.text.split('\n')[0].slice(0, 30) : '', !!it.text, h('textarea', { class: 'area', rows: 3, oninput: (e) => { it.text = e.target.value; touch(w); } }, it.text || '')),
    h('div', { class: 'tools' }, ...mediaButtons(it, w, ctx.rerender)),
    linkStrip(it, w, ctx.rerender),
    mediaStrip(it, w, ctx.rerender));
}

// ---------- копирование на другую дату ----------
function copyDialog(w) {
  const date = h('input', { type: 'date', value: todayISO(), class: 'date-in' });
  modal((close) => h('div', {}, h('h3', {}, 'Скопировать тренировку'), h('p', { class: 'muted' }, `${wName(w)} · ${fmtDate(w.date)} → на дату:`), date,
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: close }, 'Отмена'),
      h('button', { class: 'btn primary', onclick: () => { if (!isISO(date.value)) return; const n = createWorkout({ date: date.value, from: w }); close(); goto('#/w/' + n.id); } }, 'Скопировать'))));
}

// ---------- сам экран ----------
export function workoutView(id) {
  const db = state.db;
  const w = db.workouts.find((x) => x.id === id);
  if (!w) return h('div', { class: 'page' }, h('p', { class: 'empty' }, 'Тренировка не найдена (возможно, удалена на другом устройстве).'), h('a', { class: 'btn', href: '#/' }, 'В журнал'));
  const root = h('div', { class: 'page workout' });
  const ctx = {
    rerender: () => { const y = window.scrollY; build(); window.scrollTo(0, y); },
    remove: async (it) => {
      const label = it.type === 'sets' ? `упражнение «${it.exercise}»` : `блок «${it.title || 'без названия'}»`;
      if (await confirmBox(`Удалить ${label} из тренировки?`, 'Удалить')) { w.items = w.items.filter((x) => x !== it); touch(w); ctx.rerender(); }
    },
    move: (it, d) => { const i = w.items.indexOf(it), j = i + d; if (j < 0 || j >= w.items.length) return; [w.items[i], w.items[j]] = [w.items[j], w.items[i]]; touch(w); ctx.rerender(); },
  };

  function build() {
    const copyDate = h('input', { type: 'date', class: 'hidden-date', value: todayISO(), 'aria-label': 'Дата копии', onchange: (e) => {
      if (!isISO(e.target.value)) return;
      const n = createWorkout({ date: e.target.value, from: w });
      toast(`Скопировано на ${fmtDate(n.date)}`); location.hash = '#/w/' + n.id;
    } });
    const dateIn = h('input', { type: 'date', class: 'date-in', value: isISO(w.date) ? w.date : '', onchange: (e) => { if (isISO(e.target.value)) { w.date = e.target.value; touch(w); ctx.rerender(); } } });
    const head = h('section', { class: 'card wk-head' },
      h('a', { class: 'back', href: '#/', 'aria-label': 'Назад', title: 'Назад' }, icon('back')),
      h('div', { class: 'row wrap actions' },
        h('button', { class: 'btn small primary icon-only', title: 'Поделиться картинкой', 'aria-label': 'Поделиться', onclick: () => shareWorkout(w) }, icon('share')),
        h('span', { class: 'copy-wrap' }, h('button', { class: 'btn small', title: 'Скопировать тренировку на другую дату', onclick: () => { try { copyDate.showPicker(); } catch { copyDate.click(); } } }, icon('copy'), 'Копия'), copyDate),
        h('button', { class: 'btn small danger', title: 'Удалить тренировку', 'aria-label': 'Удалить', onclick: removeWorkout }, icon('trash'))),
      h('label', { class: 'fld' }, h('span', {}, 'Название'),
        h('input', { class: 'title-in', placeholder: `Тренировка ${w.date}`, value: (w.day && w.day.length <= 2) ? `День ${w.day}` : w.day || '', oninput: (e) => { w.day = e.target.value; touch(w); } })),
      h('div', { class: 'row wrap' }, dateIn, h('span', { class: 'muted' }, isISO(w.date) ? WD[weekdayIdx(w.date)] : 'без даты'),
        h('select', { class: 'sel', 'aria-label': 'Цикл', value: w.cycle, onchange: (e) => { w.cycle = e.target.value; touch(w); } }, db.settings.cycles.map((c) => h('option', { value: c }, c)))),
      h('label', { class: 'fld' }, h('span', {}, 'Описание'),
        h('textarea', { class: 'area', rows: 3, placeholder: 'Что угодно: сообщение тренера, задача на тренировку, самочувствие…', oninput: (e) => { w.plan = e.target.value; touch(w); } }, w.plan || '')));

    const cards = w.items.map((it) => (it.type === 'sets' ? setsCard(w, it, ctx) : it.type === 'interval' ? intervalCard(w, it, ctx) : freeCard(w, it, ctx)));
    root.replaceChildren(head, ...cards,
      h('button', { class: 'btn add', onclick: () => addDialog(w, ctx.rerender) }, icon('plus'), 'Добавить упражнение'),
      h('section', { class: 'card' }, h('textarea', { class: 'area', rows: 2, placeholder: 'Заметка о тренировке (самочувствие, как прошла)', oninput: (e) => { w.note = e.target.value; touch(w); } }, w.note || '')));
  }

  async function removeWorkout() {
    if (!(await confirmBox(`Удалить тренировку «${wName(w) || w.date}» от ${fmtDate(w.date)}?`, 'Удалить'))) return;
    const snap = JSON.parse(JSON.stringify(w));
    deleteWorkout(w.id);
    location.hash = '#/';
    toast('Тренировка удалена', 8000, { label: 'Отменить', fn: () => {
      snap.updated = nowISO();
      state.db.workouts.push(snap);
      state.db.deleted = state.db.deleted.filter((d) => d.id !== snap.id);
      markChanged(); refresh(); toast('Тренировка возвращена');
    } });
  }
  build();
  return root;
}
