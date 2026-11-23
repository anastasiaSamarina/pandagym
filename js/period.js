// Компактный фильтр периода: «Всё · 3 мес · 6 мес · [год] · [месяц]». Общий для замеров и аналитики.
import { h, refresh, isISO, addDays, todayISO, MONTHS_NOM, pad } from './util.js';

/** p = { mode: 'all' | '3' | '6' | 'year', year, month } — месяц 0 = весь год */
export const newPeriod = () => ({ mode: 'all', year: 0, month: 0 });

export function periodRange(p) {
  const today = todayISO();
  if (p.mode === '1' || p.mode === '3' || p.mode === '6') {
    const d = new Date(); d.setMonth(d.getMonth() - Number(p.mode));
    return [`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, today];
  }
  if (p.mode === 'year' && p.year) {
    if (!p.month) return [`${p.year}-01-01`, `${p.year}-12-31`];
    return [`${p.year}-${pad(p.month)}-01`, `${p.year}-${pad(p.month)}-${pad(new Date(p.year, p.month, 0).getDate())}`];
  }
  return ['0000-01-01', '9999-12-31'];
}
export const inPeriod = (p, date) => { const [a, b] = periodRange(p); return isISO(date) && date >= a && date <= b; };
export function periodText(p) {
  if (p.mode === '1') return 'последний месяц';
  if (p.mode === '3' || p.mode === '6') return `последние ${p.mode} мес.`;
  if (p.mode === 'year' && p.year) return p.month ? `${MONTHS_NOM[p.month - 1]} ${p.year}` : `${p.year} год`;
  return 'всё время';
}

/** dates — список ISO-дат, из которых берём доступные годы */
export function periodBar(p, dates = [], onChange = refresh) {
  const ys = new Set(); for (const d of dates) if (isISO(d)) ys.add(Number(d.slice(0, 4)));
  if (p.year) ys.add(p.year);
  const years = [...ys].sort((a, b) => b - a);
  const set = (mode) => { p.mode = mode; if (mode !== 'year') { p.year = 0; p.month = 0; } onChange(); };
  const chip = (mode, label) => h('button', { class: 'pill' + (p.mode === mode ? ' on' : ''), onclick: () => set(mode) }, label);
  return h('div', { class: 'pf', role: 'group', 'aria-label': 'Период' },
    chip('all', 'Всё'), chip('1', 'Месяц'), chip('3', '3 мес'), chip('6', '6 мес'),
    years.length ? h('select', { class: 'pf-sel' + (p.mode === 'year' ? ' on' : ''), 'aria-label': 'Год', value: p.mode === 'year' ? String(p.year) : '', onchange: (e) => {
      const y = Number(e.target.value); if (!y) { set('all'); return; }
      p.mode = 'year'; p.year = y; p.month = 0; onChange();
    } }, h('option', { value: '' }, 'Год'), years.map((y) => h('option', { value: String(y) }, y))) : null,
    p.mode === 'year' && p.year ? h('select', { class: 'pf-sel on', 'aria-label': 'Месяц', value: String(p.month), onchange: (e) => { p.month = Number(e.target.value); onChange(); } },
      h('option', { value: '0' }, 'Весь год'), MONTHS_NOM.map((n, i) => h('option', { value: String(i + 1) }, n))) : null);
}
void addDays;
