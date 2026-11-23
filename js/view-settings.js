import { icon } from './icons.js';
// Настройки, импорт/экспорт Excel, справочник упражнений, проверка данных.
import { h, put, refresh, toast, modal, confirmBox, fmtDate, download, todayISO, nowISO } from './util.js';
import { state, replaceDb, markChanged, saveDevice, notify } from './store.js';
import { mergeDb, mergeExercise, similarExercises, validate, historyOf, exMeta, nameKey, normName, dupKey } from './model.js';
import { dbToXlsx, readAnyWorkbook, applyLegacy } from './excel-io.js';
import { syncNow, testConnection, isConfigured, getSyncLog, clearSyncLog } from './sync.js';
import { soundOn, setSound, beep, keepAliveOn, setKeepAlive } from './rest.js';

// ======================= импорт =======================
export function importDialog() {
  const input = h('input', { type: 'file', accept: '.xlsx', style: 'display:none' });
  input.addEventListener('change', async () => {
    const f = input.files[0]; if (!f) return;
    try { await importFile(f); } catch (e) { console.error(e); toast('Не получилось прочитать файл: ' + e.message, 5000); }
  });
  document.body.append(input); input.click(); setTimeout(() => input.remove(), 120000);
}

async function importFile(file) {
  const res = await readAnyWorkbook(await file.arrayBuffer());
  const db = state.db;
  if (res.kind === 'legacy') {
    if (!res.workouts.length) { toast('В файле не нашлось тренировок в знакомом виде (блоки «День … / Круг / Вес / Количество»).', 6000); return; }
    const r = applyLegacy(db, res);
    for (const e of db.exercises) if (!e.aliases) e.aliases = [];
    markChanged(); notify('data');
    reportDialog(res, r);
  } else {
    const hasData = db.workouts.length || db.measures.length;
    if (!hasData) { replaceDb(res.db); reportDialog({ report: { workouts: res.report.workouts, sets: 0, warnings: res.report.warnings } }, { added: res.report.workouts }); return; }
    modal((close) => h('div', {}, h('h3', {}, 'Файл в формате приложения'), h('p', {}, `В файле ${res.report.workouts} тренировок. В приложении уже есть данные. Что сделать?`),
      h('div', { class: 'col' },
        h('button', { class: 'btn primary', onclick: () => { Object.assign(state.db, mergeDb(state.db, res.db)); markChanged(); notify('data'); close(); toast('Объединено'); } }, 'Объединить с текущими данными (рекомендуется)'),
        h('button', { class: 'btn danger', onclick: async () => { close(); if (await confirmBox('Все текущие данные в приложении будут заменены данными из файла. Продолжить?', 'Заменить')) { replaceDb(res.db); toast('Данные заменены'); } } }, 'Заменить всё данными из файла'),
        h('button', { class: 'btn', onclick: close }, 'Отмена'))));
  }
}

function reportDialog(res, r) {
  const ws = res.report.warnings;
  const todo = ws.filter((x) => x.level === 'todo'), fixed = ws.filter((x) => x.level === 'fixed'), info = ws.filter((x) => x.level === 'info');
  const exists = (id) => id && state.db.workouts.some((w) => w.id === id);
  modal((close) => h('div', {},
    h('h3', {}, `✓ Загружено тренировок: ${r.added}`),
    r.from ? h('p', { class: 'muted' }, `Период ${r.from} — ${r.to}` + (res.report.sets ? `, кругов: ${res.report.sets}` : '')) : null,
    todo.length ? h('div', { class: 'imp todo' }, h('h4', {}, `Нужно твоё решение: ${todo.length}`),
      todo.map((x) => h('div', { class: 'imp-row' }, h('span', {}, x.text), exists(x.wid) ? h('a', { class: 'btn small', href: '#/w/' + x.wid, onclick: close }, 'Открыть') : null)))
      : h('div', { class: 'imp ok' }, '✓ Ничего решать не нужно.'),
    fixed.length ? h('div', { class: 'imp' }, h('b', {}, `Исправлено автоматически: ${fixed.length}`), h('div', { class: 'muted small' }, 'Ничего делать не нужно — это просто отчёт. Excel превращает «2,5» в дату, а тренерские диапазоны вроде «14-16» я убрала из расчётов.')) : null,
    info.length ? h('div', { class: 'imp' }, h('b', {}, `Пропущено пустых блоков: ${info.length}`)) : null,
    h('p', { class: 'muted small' }, 'Полный список остаётся доступен: Настройки → Проверка данных → «Из импорта».'),
    h('div', { class: 'row end' },
      h('a', { class: 'btn', href: '#/check', onclick: close }, 'Открыть список'),
      h('button', { class: 'btn primary', onclick: () => { close(); refresh(); } }, 'Готово'))));
}

// ======================= настройки =======================
export function settingsView() {
  const db = state.db, dev = state.device, st = db.settings;
  const root = h('div', { class: 'page' });
  // Черновик: ничего не сохраняется, пока не нажата «Сохранить»
  const D = { perWeek: st.perWeek, currentCycle: st.currentCycle, restSec: st.restSec || 60, sound: soundOn(), keepAlive: keepAliveOn(), plateauN: st.plateauN || 4, plateauPct: st.plateauPct ?? 3,
    compareMode: st.compareMode || 'last', theme: dev.theme, gh: { ...dev.gh }, token: dev.token };
  let dirty = false;
  const bar = h('div', { class: 'save-bar', hidden: true },
    h('span', {}, 'Есть несохранённые изменения'),
    h('button', { class: 'btn', onclick: () => refresh() }, 'Отмена'),
    h('button', { class: 'btn primary', onclick: () => save() }, 'Сохранить'));
  const touched = () => { dirty = true; bar.hidden = false; };
  const field = (label, input) => h('label', { class: 'fld' }, h('span', {}, label), input);
  const numIn = (key, attrs) => h('input', { class: 'num', type: 'number', ...attrs, value: D[key], oninput: (e) => { D[key] = e.target.value; touched(); } });
  const ghIn = (key, ph) => h('input', { class: 'txt', value: D.gh[key], placeholder: ph, autocapitalize: 'none', autocomplete: 'off', oninput: (e) => { D.gh[key] = e.target.value.trim(); touched(); } });
  const token = h('input', { class: 'txt', type: 'password', value: D.token, placeholder: 'github_pat_…', autocomplete: 'off', oninput: (e) => { D.token = e.target.value.trim(); touched(); } });
  const status = h('div', { class: 'muted' }, statusText());

  function save() {
    st.perWeek = Math.max(1, Number(D.perWeek) || 3);
    st.currentCycle = D.currentCycle; st.cycleSet = true;
    st.restSec = Math.max(10, Number(D.restSec) || 60);
    st.plateauN = Math.min(12, Math.max(2, Number(D.plateauN) || 4));
    st.plateauPct = Math.max(0, Number(D.plateauPct) || 0);
    st.compareMode = D.compareMode;
    setSound(D.sound); setKeepAlive(D.keepAlive);
    dev.theme = D.theme; dev.gh = { ...dev.gh, ...D.gh }; dev.token = D.token;
    saveDevice(); applyTheme(); markChanged();
    dirty = false; toast('Настройки сохранены'); refresh();
  }
  /** кнопки «Проверить» и «Синхронизировать» используют то, что сейчас в полях */
  const saveFirst = () => { if (dirty) save(); };

  put(root, h('h1', {}, 'Настройки'),
    h('section', { class: 'card' }, h('h3', {}, 'Занятия'),
      field('Занятий в неделю (цель)', numIn('perWeek', { min: 1, max: 14 })),
      field('Текущий цикл', h('select', { class: 'sel', value: D.currentCycle, onchange: (e) => { D.currentCycle = e.target.value; touched(); } }, st.cycles.map((c) => h('option', { value: c }, c)))),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: () => cycleDialog('new') }, icon('plus'), 'Новый цикл'),
        h('button', { class: 'btn', onclick: () => cycleDialog('rename') }, icon('edit'), 'Переименовать текущий')),
      h('small', { class: 'muted' }, 'Каждый цикл — отдельный лист в Excel-файле.')),
    h('section', { class: 'card' }, h('h3', {}, icon('timer'), ' Отдых'),
      field('Отдых между подходами, секунд', numIn('restSec', { min: 10, max: 600, step: 5 })),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: D.sound, onchange: (e) => { D.sound = e.target.checked; touched(); if (e.target.checked) beep(880, 120); } }), 'Звук по окончании отдыха (на этом устройстве)'),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: D.keepAlive, onchange: (e) => { D.keepAlive = e.target.checked; touched(); } }), 'Сигнал при свёрнутом приложении (может приглушать музыку)'),
      h('small', { class: 'muted' }, 'Звук работает, пока приложение открыто и экран не заблокирован. Если звука нет, проверь, что в браузере для этого сайта он не отключён, и громкость мультимедиа не на нуле.')),
    h('section', { class: 'card' }, h('h3', {}, icon('trend'), ' Плато'),
      field('Сколько последних занятий смотреть', numIn('plateauN', { min: 2, max: 12 })),
      field('Рост объёма, который считается прогрессом, %', numIn('plateauPct', { min: 0, max: 50, step: 0.5 })),
      h('small', { class: 'muted' }, 'Плато — когда за последние N занятий ни разу не вырос рабочий вес и общий объём (вес × повторы) не вырос больше чем на указанный процент по сравнению с самым первым из них.')),
    h('section', { class: 'card' }, h('h3', {}, icon('swap'), ' Сравнение на карточке упражнения'),
      h('p', { class: 'muted' }, 'С чем сравнивать текущую тренировку в самой тренировке (цветные подсказки и «всего +N%»). В Аналитике можно смотреть любое сравнение.'),
      h('div', { class: 'col' }, [['last', 'С прошлым разом'], ['best', 'С лучшим разом (по общему объёму)'], ['avg4', 'Со средним за последние 4 раза']].map(([k, l]) =>
        h('label', { class: 'chk' }, h('input', { type: 'radio', name: 'cmp', value: k, checked: D.compareMode === k, onchange: () => { D.compareMode = k; touched(); } }), l)))),
    h('section', { class: 'card' }, h('h3', {}, 'Данные'),
      h('div', { class: 'col' },
        h('button', { class: 'btn', onclick: importDialog }, icon('upload'), 'Загрузить Excel (старая таблица или файл приложения)'),
        h('button', { class: 'btn', onclick: async () => { download(await dbToXlsx(db), `workouts-${todayISO()}.xlsx`); } }, icon('download'), 'Скачать workouts.xlsx'),
        h('button', { class: 'btn', onclick: () => download(new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' }), `gym-backup-${todayISO()}.json`) }, icon('download'), 'Резервная копия (JSON)'),
        h('a', { class: 'btn', href: '#/exercises' }, icon('tag'), 'Упражнения: объединить дубли и переименовать'),
        h('a', { class: 'btn', href: '#/check' }, icon('search'), 'Проверка данных (даты, дубли, выбросы)'))),
    h('section', { class: 'card' }, h('h3', {}, 'Синхронизация с GitHub'),
      h('p', { class: 'muted' }, 'Нужна, чтобы телефон и компьютер видели одни данные. Без неё приложение работает, данные лежат только в этом браузере. Пошаговая инструкция: docs/SYNC_SETUP.md.'),
      field('Владелец (логин GitHub)', ghIn('owner', 'my-login')), field('Репозиторий с данными', ghIn('repo', 'gym-data')),
      field('Ветка', ghIn('branch', 'main')), field('Путь к файлу (.json — быстро и надёжно, .xlsx — таблица)', ghIn('path', 'data/gym.json')), field('Токен доступа (хранится только на этом устройстве)', token),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: async () => { saveFirst(); try { const r = await testConnection(); toast(r.canPush ? `Подключение работает${r.private ? ' (репозиторий приватный ✓)' : ' — внимание: репозиторий ПУБЛИЧНЫЙ'}` : 'Репозиторий виден, но токен без права записи (нужен Contents: Read and write)', 6000); } catch (e) { toast(e.message, 6000); } } }, icon('check'), 'Проверить подключение'),
        h('button', { class: 'btn primary', onclick: async () => { saveFirst(); try { await syncNow(); toast('Синхронизировано'); refresh(); } catch (e) { toast(e.message, 6000); } } }, icon('refresh'), 'Синхронизировать сейчас'),
        h('button', { class: 'btn', onclick: () => { dev.token = ''; saveDevice(); toast('Токен удалён с этого устройства'); refresh(); } }, icon('trash'), 'Забыть токен'),
        h('a', { class: 'btn', href: '#/synclog' }, icon('list'), 'Журнал синхронизации')),
      status),
    h('section', { class: 'card' }, h('h3', {}, 'Вид'),
      field('Тема', h('select', { class: 'sel', value: D.theme, onchange: (e) => { D.theme = e.target.value; touched(); } },
        h('option', { value: 'auto' }, 'Как в системе'), h('option', { value: 'light' }, 'Светлая'), h('option', { value: 'dark' }, 'Тёмная')))),
    h('p', { class: 'muted small' }, 'Версия 5 (2026-11-24) · данные: ', `${db.workouts.length} тренировок, ${db.exercises.length} упражнений`),
    bar);
  return root;
}
function statusText() {
  const s = state.device.lastSync;
  return isConfigured() ? `Последняя синхронизация: ${s ? new Date(s).toLocaleString('ru-RU') : 'ещё не было'}` : 'Синхронизация не настроена — данные хранятся только на этом устройстве.';
}
export function applyTheme() {
  const t = state.device.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
}
function cycleDialog(mode) {
  const db = state.db;
  const input = h('input', { class: 'txt', value: mode === 'rename' ? db.settings.currentCycle : `Цикл ${db.settings.cycles.length + 1}`, maxlength: 31 });
  modal((close) => h('div', {}, h('h3', {}, mode === 'new' ? 'Новый цикл' : 'Переименовать цикл'), input,
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: close }, 'Отмена'), h('button', { class: 'btn primary', onclick: () => {
      const name = normName(input.value).replace(/[\\/?*[\]:]/g, '-');
      if (!name) return;
      db.settings.cycleSet = true;
      if (mode === 'new') { if (!db.settings.cycles.includes(name)) db.settings.cycles.push(name); db.settings.currentCycle = name; }
      else {
        const old = db.settings.currentCycle;
        for (const w of db.workouts) if (w.cycle === old) { w.cycle = name; w.updated = nowISO(); }
        db.settings.cycles = db.settings.cycles.map((c) => (c === old ? name : c)); db.settings.currentCycle = name;
      }
      markChanged(); close(); refresh();
    } }, 'Сохранить'))));
}

// ======================= упражнения =======================
export function exercisesView() {
  const db = state.db;
  const root = h('div', { class: 'page' });
  const used = (n) => historyOf(db, n).length;
  const sim = similarExercises(db);
  put(root, h('a', { class: 'back', href: '#/settings', 'aria-label': 'Назад', title: 'Назад' }, icon('back')), h('h1', {}, 'Упражнения'),
    h('p', { class: 'muted' }, 'Справочник упражнений. Здесь можно: переименовать упражнение или объединить два названия в одно — новое название сразу подставится во всех тренировках; указать, что упражнение считается в секундах; отметить «облегчение» (гравитрон: меньше вес = лучше, поэтому цвета сравнения инвертируются).'),
    sim.length ? h('section', { class: 'card warn' }, h('b', {}, 'Возможные дубли'),
      sim.map(([a, b]) => h('div', { class: 'dup-row' }, h('span', {}, `«${a}» ≈ «${b}»`), h('span', { class: 'row' }, h('button', { class: 'btn small', onclick: () => mergeDialog(a, b) }, 'Объединить'),
        h('button', { class: 'btn small', onclick: () => { (db.settings.notDup ||= []).push(dupKey(a, b)); markChanged(); toast('Хорошо, больше не буду предлагать'); refresh(); } }, 'Это не дубль'))))) : null);
  const q = h('input', { class: 'search', placeholder: 'Найти упражнение', autocomplete: 'off' });
  put(root, q);
  const names = [...db.exercises].sort((a, b) => used(b.name) - used(a.name) || a.name.localeCompare(b.name, 'ru'));
  const table = h('div', { class: 'ex-table' }, names.map((e) => h('section', { class: 'card ex-row', 'data-n': nameKey(e.name) + ' ' + (e.aliases || []).map(nameKey).join(' ') },
    h('div', { class: 'row between' }, h('b', {}, e.name), h('small', { class: 'muted' }, `${used(e.name)} раз`)),
    h('div', { class: 'row wrap' },
      h('select', { class: 'sel', value: e.unit, onchange: (ev) => { e.unit = ev.target.value; markChanged(); } }, h('option', { value: 'reps' }, 'повторы'), h('option', { value: 'sec' }, 'секунды')),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!e.assist, onchange: (ev) => { e.assist = ev.target.checked; markChanged(); } }), 'облегчение (меньше = лучше)')),
    h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => mergeDialog(e.name) }, icon('edit'), 'Переименовать / объединить'),
      used(e.name) ? null : h('button', { class: 'btn small danger', onclick: () => { db.exercises = db.exercises.filter((x) => x !== e); markChanged(); refresh(); } }, 'Удалить')))));
  put(root, table);
  q.addEventListener('input', () => { const k = nameKey(q.value); table.querySelectorAll('.ex-row').forEach((el) => { el.hidden = !!k && !el.dataset.n.includes(k); }); });
  return root;
}
export function mergeDialog(from, to = '', onDone = null) {
  const db = state.db;
  const input = h('input', { class: 'txt', value: to || from, autocomplete: 'off' });
  const list = h('div', { class: 'pick-list compact' });
  const hint = h('div', { class: 'muted small' });
  const used = (n) => historyOf(db, n).length;
  const paint = () => {
    const q = nameKey(input.value), target = normName(input.value);
    const matches = db.exercises.filter((e) => e.name !== from && (!q || nameKey(e.name).includes(q))).sort((a, b) => used(b.name) - used(a.name)).slice(0, 8);
    list.replaceChildren(...matches.map((e) => h('button', { class: 'pick', onclick: () => { input.value = e.name; paint(); } },
      h('b', {}, e.name), h('small', {}, `${used(e.name)} раз — нажми, чтобы объединить с ним`))));
    const exists = db.exercises.find((e) => e.name !== from && nameKey(e.name) === nameKey(target));
    hint.textContent = !target || target === from ? 'Введи новое название или выбери существующее упражнение из списка.'
      : exists ? `Будет объединено с «${exists.name}»: все записи «${from}» станут «${exists.name}», история общая.` : `Будет просто переименовано: «${from}» → «${target}» во всех тренировках.`;
  };
  input.addEventListener('input', paint);
  modal((close) => h('div', {}, h('h3', {}, 'Переименовать / объединить'), h('p', { class: 'muted' }, `Упражнение «${from}»`),
    input, hint, list,
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: close }, 'Отмена'), h('button', { class: 'btn primary', onclick: () => {
      const target = normName(input.value); if (!target || target === from) { close(); return; }
      const exists = db.exercises.find((e) => nameKey(e.name) === nameKey(target));
      if (exists) mergeExercise(db, from, exists.name);
      else { const e = db.exercises.find((x) => x.name === from); mergeExercise(db, from, target); if (e) { e.aliases = [...new Set([...(e.aliases || []), from])]; e.name = target; db.exercises.push(e); } }
      markChanged(); close(); toast('Готово — название обновлено во всех тренировках');
      if (onDone) onDone(exists ? exists.name : target); else refresh();
    } }, 'Применить'))));
  paint(); setTimeout(() => { input.focus(); input.select(); }, 50);
}

// ======================= проверка данных =======================
export function checkView() {
  const db = state.db;
  const items = validate(db, todayISO());
  const lvlMark = { error: '⛔', warn: '⚠️', info: 'ℹ️' };
  const log = (db.importLog || []);
  const lvl = { todo: '❗ Нужно решить', fixed: '✓ Исправлено автоматически', info: 'ℹ️ Пропущено' };
  const exists = (id) => id && db.workouts.some((w) => w.id === id);
  const logSection = log.length ? h('section', { class: 'card' }, h('div', { class: 'row between wrap' }, h('h3', {}, `Из импорта (${log.length})`),
      h('button', { class: 'btn small', onclick: () => { db.importLog = db.importLog.filter((x) => x.level === 'todo'); markChanged(); refresh(); } }, 'Скрыть уже исправленные')),
    h('p', { class: 'muted small' }, 'Что нашлось при загрузке старой таблицы. «Нужно решить» — открой тренировку и поправь, потом нажми «Скрыть». Остальное — для информации.'),
    ['todo', 'fixed', 'info'].map((k) => log.filter((x) => x.level === k).length ? h('div', {}, h('h4', {}, lvl[k]),
      log.filter((x) => x.level === k).map((x) => h('div', { class: 'imp-row' }, h('span', {}, x.text, h('small', { class: 'muted' }, ` (${x.where})`)),
        h('span', { class: 'row' }, exists(x.wid) ? h('a', { class: 'btn small', href: '#/w/' + x.wid }, 'Открыть') : null,
          h('button', { class: 'btn small', onclick: () => { db.importLog = db.importLog.filter((y) => y.id !== x.id); markChanged(); refresh(); } }, 'Скрыть'))))) : null)) : null;
  return h('div', { class: 'page' }, h('a', { class: 'back', href: '#/settings', 'aria-label': 'Назад', title: 'Назад' }, icon('back')), h('h1', {}, 'Проверка данных'),
    logSection,
    h('p', { class: 'muted' }, 'Ниже — автоматическая проверка: даты, которые не читаются, две одинаковые тренировки в один день, пустые тренировки, подозрительные веса, похожие названия упражнений.'),
    items.length ? h('section', { class: 'card' }, items.map((i) => h('a', { class: 'check-row', href: i.link || '#/check' }, h('span', {}, lvlMark[i.level]), h('span', {}, i.text)))) : h('section', { class: 'card empty' }, '✓ Проблем не найдено'));
}

// ======================= журнал синхронизации =======================
export function syncLogView() {
  const log = getSyncLog().slice().reverse();
  const logMark = { info: '·', ok: '✓', warn: '⚠', error: '⛔' };
  const text = () => getSyncLog().map((x) => `${x.t} [${x.level}] ${x.msg}`).join('\n');
  const root = h('div', { class: 'page' }, h('a', { class: 'back', href: '#/settings', 'aria-label': 'Назад', title: 'Назад' }, icon('back')), h('h1', {}, 'Журнал синхронизации'),
    h('p', { class: 'muted' }, `Здесь записано, что приложение делало при каждой синхронизации и что ответил GitHub. Хранится только на этом устройстве, токен в журнал не попадает. Если что-то не работает — нажми «Скопировать» и пришли текст.`),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary', onclick: async () => { try { await syncNow(); toast('Синхронизировано'); } catch (e) { toast(e.message, 6000); } refresh(); } }, icon('refresh'), 'Синхронизировать сейчас'),
      h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(text()); toast('Журнал скопирован'); } catch { toast('Не удалось скопировать'); } } }, 'Скопировать'),
      h('button', { class: 'btn', onclick: () => download(new Blob([text()], { type: 'text/plain;charset=utf-8' }), `sync-log-${todayISO()}.txt`) }, icon('download'), 'Скачать'),
      h('button', { class: 'btn', onclick: () => { clearSyncLog(); refresh(); } }, 'Очистить')),
    log.length ? h('section', { class: 'card log' }, log.map((x) => h('div', { class: 'log-row ' + x.level }, h('span', {}, logMark[x.level] || '·'),
      h('small', { class: 'muted' }, new Date(x.t).toLocaleString('ru-RU')), h('span', {}, x.msg)))) : h('section', { class: 'card empty' }, 'Журнал пока пуст.'));
  return root;
}
