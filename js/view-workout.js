// Экран тренировки: ввод, редактирование, сравнение с прошлым разом (зелёный/красный).
import { h, refresh, toast, modal, confirmBox, fmtDate, fmtNum, parseInput, todayISO, uid, nowISO, isISO, plural, WD, weekdayIdx } from './util.js';
import { state, touch, markChanged, deleteWorkout, putMedia } from './store.js';
import { compareItem, exMeta, ensureExercise, findExercise, historyOf, setsLine, filledSets, nameKey, similarTo, DAY_LABELS } from './model.js';
import { shareWorkout } from './share.js';
import { mediaUrl } from './sync.js';
import { openTimer } from './timer.js';

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

// ---------- картинки/гифки ----------
async function shrinkImage(file) {
  if (file.type === 'image/gif') {
    if (file.size > 8 * 1024 * 1024) throw new Error('GIF больше 8 МБ — сожми его или сохрани ссылкой в комментарии');
    return { blob: file, ext: '.gif' };
  }
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.82));
  return { blob, ext: '.jpg' };
}
function attachMedia(it, w, rerender) {
  const input = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  input.addEventListener('change', async () => {
    const f = input.files[0]; if (!f) return;
    try {
      const { blob, ext } = await shrinkImage(f);
      const id = uid('m') + ext;
      await putMedia(id, blob, false);
      (it.media ||= []).push(id);
      touch(w); rerender();
    } catch (e) { toast(e.message || 'Не удалось добавить картинку'); }
  });
  document.body.append(input); input.click(); setTimeout(() => input.remove(), 60000);
}
function mediaStrip(it, w, rerender) {
  if (!it.media || !it.media.length) return null;
  return h('div', { class: 'media-strip' }, it.media.map((id) => {
    const img = h('img', { alt: '', class: 'thumb', onclick: () => img.src && openImage(img.src) });
    mediaUrl(id).then((u) => { if (u) img.src = u; else img.replaceWith(h('div', { class: 'thumb missing' }, 'нет файла')); });
    return h('div', { class: 'thumb-wrap' }, img,
      h('button', { class: 'x', title: 'Убрать', onclick: () => { it.media = it.media.filter((m) => m !== id); touch(w); rerender(); } }, '✕'));
  }), );
}
function openImage(src) { modal((close) => h('img', { src, class: 'big-img', onclick: close })); }

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
    w.items.push({ type: 'sets', exercise: e.name, mode: last ? last.it.mode : mode || 'weighted', note: '', sets: Array.from({ length: rounds }, () => ({ w: null, r: null, note: '' })), media: [] });
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
    return h('div', {}, h('h3', {}, replaceIt ? 'Заменить упражнение' : 'Добавить упражнение'), search, list,
      replaceIt ? null : h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { w.items.push({ type: 'free', title: '', text: '', media: [] }); touch(w); c(); rerender(); } }, '＋ Свободный блок'),
        h('button', { class: 'btn', onclick: () => { w.items.push({ type: 'interval', title: 'Табата', format: 'Табата', work: 20, rest: 10, rounds: 8, moves: '', text: '', result: '', media: [] }); touch(w); c(); rerender(); } }, '⏱ Интервальная (табата)')));
  });
  paint(); setTimeout(() => search.focus(), 50);
}

// ---------- карточка упражнения с кругами ----------
const mark = (el, cls) => { el.classList.remove('better', 'worse', 'same'); if (cls) el.classList.add(cls); };

function setsCard(w, it, ctx) {
  const db = state.db, meta = exMeta(db, it.exercise);
  const cmp0 = compareItem(db, w, it), prev = cmp0.prev;
  const weighted = it.mode !== 'bodyweight';
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
      if (!parts.length) parts.push(h('span', { class: 'chip' }, 'как в прошлый раз'));
    }
    chip.replaceChildren(...parts);
  };

  function buildRow(s, i) {
    const p = prev && prev.it.sets[i];
    const wIn = weighted ? h('input', { class: 'num', inputmode: 'decimal', 'aria-label': 'Вес', value: fmtNum(s.w), placeholder: p ? fmtNum(p.w) : '', onfocus: (e) => e.target.select(), oninput: (e) => { s.w = parseInput(e.target.value); touch(w); paint(); } }) : null;
    const rIn = h('input', { class: 'num', inputmode: 'decimal', 'aria-label': meta.unit === 'sec' ? 'Секунды' : 'Повторы', value: fmtNum(s.r), placeholder: p ? fmtNum(p.r) : '', onfocus: (e) => e.target.select(), oninput: (e) => { s.r = parseInput(e.target.value); touch(w); paint(); } });
    const noteIn = h('input', { class: 'note-in', placeholder: 'Комментарий к кругу (например: с резинкой)', value: s.note || '', oninput: (e) => { s.note = e.target.value; touch(w); } });
    const noteRow = h('tr', { class: 'note-row' }, h('td', {}), h('td', { colspan: weighted ? 4 : 3 }, noteIn));
    if (!s.note) noteRow.hidden = true;
    rows.push({ w: wIn || document.createElement('i'), r: rIn });
    return [
      h('tr', {}, h('td', { class: 'n' }, i + 1), weighted ? h('td', {}, wIn) : null, h('td', {}, rIn),
        h('td', { class: 'acts' },
          h('button', { class: 'ico' + (s.note ? ' on' : ''), title: 'Комментарий', onclick: () => { noteRow.hidden = !noteRow.hidden; if (!noteRow.hidden) noteIn.focus(); } }, '💬'),
          h('button', { class: 'ico', title: 'Удалить круг', onclick: () => { if (it.sets.length > 1) { it.sets.splice(i, 1); touch(w); ctx.rerender(); } } }, '✕'))),
      noteRow];
  }
  it.sets.forEach((s, i) => tbody.append(...buildRow(s, i)));

  const prevLine = prev ? h('div', { class: 'prev' }, `Прошлый раз · ${fmtDate(prev.w.date, false)}: `, h('span', {}, setsLine(prev.it.sets))) : null;
  const unit = meta.unit === 'sec' ? 'Сек' : 'Повт';
  const star = h('button', { class: 'ico star', title: 'В избранное (следить в Аналитике)', onclick: (ev) => { const e = ensureExercise(db, it.exercise); e.fav = !e.fav; markChanged(); ev.target.textContent = e.fav ? '★' : '☆'; } }, meta.fav ? '★' : '☆');
  const card = h('article', { class: 'card ex' },
    h('header', { class: 'ex-head' },
      h('div', { class: 'ex-title' }, h('a', { class: 'ex-name', href: '#/analytics/' + encodeURIComponent(it.exercise) }, it.exercise), star),
      h('div', { class: 'ex-tools' },
        h('button', { class: 'ico', title: 'Выше', onclick: () => ctx.move(it, -1) }, '↑'),
        h('button', { class: 'ico', title: 'Ниже', onclick: () => ctx.move(it, 1) }, '↓'),
        h('button', { class: 'ico', title: 'Ещё', onclick: () => itemMenu(w, it, ctx) }, '⋯'))),
    chip, prevLine,
    h('table', { class: 'sets' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Круг'), weighted ? h('th', {}, 'Вес, кг') : null, h('th', {}, unit), h('th', {}))),
      tbody),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => { const l = it.sets[it.sets.length - 1] || {}; it.sets.push({ w: l.w ?? null, r: l.r ?? null, note: '' }); touch(w); ctx.rerender(); } }, '＋ круг')),
    h('input', { class: 'note-in', placeholder: 'Комментарий к упражнению', value: it.note || '', oninput: (e) => { it.note = e.target.value; touch(w); } }),
    mediaStrip(it, w, ctx.rerender));
  paint();
  return card;
}

function itemMenu(w, it, ctx) {
  const act = (label, fn) => h('button', { class: 'menu-item', onclick: () => { close(); fn(); } }, label);
  let close;
  modal((c) => {
    close = c;
    return h('div', { class: 'menu' }, h('h3', {}, it.exercise || it.title || 'Блок'),
      act('📷 Добавить фото / GIF', () => attachMedia(it, w, ctx.rerender)),
      it.type === 'sets' ? act(it.mode === 'bodyweight' ? '🏋 Добавить вес' : '🧍 Убрать вес (свой вес)', () => { it.mode = it.mode === 'bodyweight' ? 'weighted' : 'bodyweight'; touch(w); ctx.rerender(); }) : null,
      it.type === 'sets' ? act('🔁 Заменить упражнение', () => addDialog(w, ctx.rerender, it)) : null,
      act('🗑 Удалить из тренировки', async () => { if (await confirmBox('Удалить блок из тренировки?')) { w.items = w.items.filter((x) => x !== it); touch(w); ctx.rerender(); } }));
  });
}

// ---------- свободный и интервальный блоки ----------
function freeCard(w, it, ctx) {
  return h('article', { class: 'card ex' },
    h('header', { class: 'ex-head' }, h('input', { class: 'title-in', placeholder: 'Название (например: Кардио, Табата 12.11)', value: it.title || '', oninput: (e) => { it.title = e.target.value; touch(w); } }),
      h('div', { class: 'ex-tools' }, h('button', { class: 'ico', onclick: () => ctx.move(it, -1) }, '↑'), h('button', { class: 'ico', onclick: () => ctx.move(it, 1) }, '↓'), h('button', { class: 'ico', onclick: () => itemMenu(w, it, ctx) }, '⋯'))),
    h('textarea', { class: 'area', rows: 4, placeholder: 'Любой текст: что делали, ссылка на видео, сообщение от тренера…', oninput: (e) => { it.text = e.target.value; touch(w); } }, it.text || ''),
    mediaStrip(it, w, ctx.rerender));
}
function intervalCard(w, it, ctx) {
  const numIn = (key, label) => h('label', { class: 'fld' }, h('span', {}, label),
    h('input', { class: 'num', inputmode: 'numeric', value: it[key] ?? '', oninput: (e) => { it[key] = e.target.value === '' ? null : Number(e.target.value); touch(w); } }));
  const total = (it.work || 0) * (it.rounds || 0) + (it.rest || 0) * Math.max((it.rounds || 1) - 1, 0);
  return h('article', { class: 'card ex interval' },
    h('header', { class: 'ex-head' }, h('input', { class: 'title-in', placeholder: 'Название', value: it.title || '', oninput: (e) => { it.title = e.target.value; touch(w); } }),
      h('div', { class: 'ex-tools' }, h('button', { class: 'ico', onclick: () => ctx.move(it, -1) }, '↑'), h('button', { class: 'ico', onclick: () => ctx.move(it, 1) }, '↓'), h('button', { class: 'ico', onclick: () => itemMenu(w, it, ctx) }, '⋯'))),
    h('div', { class: 'grid4' },
      h('label', { class: 'fld' }, h('span', {}, 'Формат'), h('select', { class: 'sel', value: it.format || 'Табата', onchange: (e) => { it.format = e.target.value; touch(w); } },
        ['Табата', 'EMOM', 'AMRAP', 'Круговая', 'Другое'].map((o) => h('option', { value: o }, o)))),
      numIn('work', 'Работа, с'), numIn('rest', 'Отдых, с'), numIn('rounds', 'Раундов')),
    h('div', { class: 'row' },
      it.work && it.rounds ? h('button', { class: 'btn primary', onclick: () => openTimer({ title: it.title || it.format, work: it.work, rest: it.rest || 0, rounds: it.rounds, moves: (it.moves || '').split('\n').map((s) => s.trim()).filter(Boolean) }) }, `▶ Таймер · ${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`) : h('small', { class: 'muted' }, 'Заполни работу и раунды — появится таймер')),
    h('label', { class: 'fld wide' }, h('span', {}, 'Движения (по одному в строке)'), h('textarea', { class: 'area', rows: 4, oninput: (e) => { it.moves = e.target.value; touch(w); } }, it.moves || '')),
    h('label', { class: 'fld wide' }, h('span', {}, 'Описание / сообщение от тренера'), h('textarea', { class: 'area', rows: 3, oninput: (e) => { it.text = e.target.value; touch(w); } }, it.text || '')),
    h('label', { class: 'fld wide' }, h('span', {}, 'Результат (сколько сделала, как зашло)'), h('input', { class: 'note-in', value: it.result || '', oninput: (e) => { it.result = e.target.value; touch(w); } })),
    mediaStrip(it, w, ctx.rerender));
}

// ---------- копирование на другую дату ----------
function copyDialog(w) {
  const date = h('input', { type: 'date', value: todayISO(), class: 'date-in' });
  modal((close) => h('div', {}, h('h3', {}, 'Скопировать тренировку'), h('p', { class: 'muted' }, `День ${w.day || ''} · ${fmtDate(w.date)} → на дату:`), date,
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: close }, 'Отмена'),
      h('button', { class: 'btn primary', onclick: () => { if (!isISO(date.value)) return; const n = createWorkout({ date: date.value, from: w }); close(); location.hash = '#/w/' + n.id; } }, 'Скопировать'))));
}

// ---------- сам экран ----------
export function workoutView(id) {
  const db = state.db;
  const w = db.workouts.find((x) => x.id === id);
  if (!w) return h('div', { class: 'page' }, h('p', { class: 'empty' }, 'Тренировка не найдена (возможно, удалена на другом устройстве).'), h('a', { class: 'btn', href: '#/' }, 'В журнал'));
  const root = h('div', { class: 'page workout' });
  const ctx = {
    rerender: () => { const y = window.scrollY; build(); window.scrollTo(0, y); },
    move: (it, d) => { const i = w.items.indexOf(it), j = i + d; if (j < 0 || j >= w.items.length) return; [w.items[i], w.items[j]] = [w.items[j], w.items[i]]; touch(w); ctx.rerender(); },
  };

  function build() {
    const days = [...new Set([...DAY_LABELS, ...db.workouts.map((x) => x.day).filter(Boolean)])];
    const copyDate = h('input', { type: 'date', class: 'hidden-date', value: todayISO(), 'aria-label': 'Дата копии', onchange: (e) => {
      if (!isISO(e.target.value)) return;
      const n = createWorkout({ date: e.target.value, from: w });
      toast(`Скопировано на ${fmtDate(n.date)}`); location.hash = '#/w/' + n.id;
    } });
    const dateIn = h('input', { type: 'date', class: 'date-in', value: isISO(w.date) ? w.date : '', onchange: (e) => { if (isISO(e.target.value)) { w.date = e.target.value; touch(w); ctx.rerender(); } } });
    const head = h('section', { class: 'card wk-head' },
      h('a', { class: 'back', href: '#/' }, '← Журнал'),
      h('div', { class: 'row wrap actions' },
        h('button', { class: 'btn small primary', title: 'Картинка с подсветкой — в буфер обмена', onclick: () => shareWorkout(w) }, '📋 Поделиться'),
        h('button', { class: 'btn small', title: 'Картинка без цветной подсветки', onclick: () => shareWorkout(w, { withColors: false }) }, '🖼 Без цвета'),
        h('span', { class: 'copy-wrap' }, h('button', { class: 'btn small', title: 'Скопировать тренировку на другую дату', onclick: () => { try { copyDate.showPicker(); } catch { copyDate.click(); } } }, '⧉ Копия'), copyDate),
        h('button', { class: 'btn small danger', title: 'Удалить тренировку', 'aria-label': 'Удалить', onclick: removeWorkout }, '🗑')),
      h('div', { class: 'row wrap' }, dateIn, h('span', { class: 'muted' }, isISO(w.date) ? WD[weekdayIdx(w.date)] : 'без даты')),
      h('div', { class: 'row wrap' }, h('span', { class: 'muted' }, 'День:'),
        days.map((d) => h('button', { class: 'pill' + (w.day === d ? ' on' : ''), onclick: () => { w.day = w.day === d ? '' : d; touch(w); ctx.rerender(); } }, d)),
        h('input', { class: 'day-in', placeholder: 'другое', maxlength: 12, value: days.includes(w.day) ? '' : w.day, onchange: (e) => { w.day = e.target.value.trim(); touch(w); ctx.rerender(); } })),
      h('div', { class: 'row wrap' }, h('span', { class: 'muted' }, 'Цикл:'),
        h('select', { class: 'sel', value: w.cycle, onchange: (e) => { w.cycle = e.target.value; touch(w); } }, db.settings.cycles.map((c) => h('option', { value: c }, c)))),
      h('details', { class: 'plan', open: !!w.plan }, h('summary', {}, 'План от тренера (вставь сообщение целиком)'),
        h('textarea', { class: 'area', rows: 6, placeholder: 'Сообщение тренера: упражнения, подходы, комментарии…', oninput: (e) => { w.plan = e.target.value; touch(w); } }, w.plan || '')));

    const cards = w.items.map((it) => (it.type === 'sets' ? setsCard(w, it, ctx) : it.type === 'interval' ? intervalCard(w, it, ctx) : freeCard(w, it, ctx)));
    root.replaceChildren(head, ...cards,
      h('button', { class: 'btn add', onclick: () => addDialog(w, ctx.rerender) }, '＋ Добавить упражнение'),
      h('section', { class: 'card' }, h('textarea', { class: 'area', rows: 2, placeholder: 'Заметка о тренировке (самочувствие, как прошла)', oninput: (e) => { w.note = e.target.value; touch(w); } }, w.note || '')));
  }

  function removeWorkout() {
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
