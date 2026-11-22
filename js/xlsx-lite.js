// Минимальные чтение и запись .xlsx без SheetJS.
// .xlsx — это zip-архив с XML внутри. Распаковку/упаковку делает JSZip (vendor/jszip.min.js),
// остальное — здесь. Поддерживается только то, что нужно приложению:
// текст, числа, даты, несколько листов, ширина колонок, закреплённая шапка.
//
// Прочитанная ячейка: { t: 'n'|'s'|'d'|'b', v }   (d = дата, v = 'YYYY-MM-DD')
// Записываемая ячейка: строка | число | boolean | {d:'YYYY-MM-DD'} | null

const JSZ = () => window.JSZip;
const BUILTIN_DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const parseXml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const all = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));

export class Sheet {
  constructor(name) { this.name = name; this.cells = new Map(); this.maxR = -1; this.maxC = -1; }
  set(r, c, cell) { this.cells.set(r * 16384 + c, cell); if (r > this.maxR) this.maxR = r; if (c > this.maxC) this.maxC = c; }
  get(r, c) { return this.cells.get(r * 16384 + c) || null; }
  /** Строка как массив значений (для таблиц с шапкой) */
  rowValues(r) { const out = []; for (let c = 0; c <= this.maxC; c++) { const x = this.get(r, c); out.push(x ? x.v : null); } return out; }
}

export const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const colIndex = (letters) => { let c = 0; for (const ch of letters) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };
export const cellAddr = (r, c) => colName(c) + (r + 1);

function serialToISO(n, is1904) {
  const ms = Math.round((n + (is1904 ? -24107 : -25569)) * 86400000); // 25569 — смещение 1899-12-30 → 1970-01-01
  return new Date(ms).toISOString().slice(0, 10);
}

function looksLikeDateFormat(code) {
  if (!code) return false;
  const c = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(c) && !/^general$/i.test(c);
}

// ======================= ЧТЕНИЕ =======================
export async function readXlsx(arrayBuffer) {
  const zip = await JSZ().loadAsync(arrayBuffer);
  const text = async (p) => { const f = zip.file(p); return f ? f.async('string') : null; };

  const wbDoc = parseXml(await text('xl/workbook.xml'));
  const relDoc = parseXml(await text('xl/_rels/workbook.xml.rels'));
  const rels = {};
  for (const r of all(relDoc, 'Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  const wbPr = all(wbDoc, 'workbookPr')[0];
  const is1904 = !!wbPr && ['1', 'true'].includes(wbPr.getAttribute('date1904'));

  // общие строки
  const shared = [];
  const ssXml = await text('xl/sharedStrings.xml');
  if (ssXml) {
    for (const si of all(parseXml(ssXml), 'si')) {
      shared.push(all(si, 't').filter((t) => t.parentNode.localName !== 'rPh').map((t) => t.textContent).join(''));
    }
  }

  // какие стили (s="N") — даты
  const dateStyle = new Set();
  const stXml = await text('xl/styles.xml');
  if (stXml) {
    const st = parseXml(stXml);
    const custom = {};
    for (const nf of all(st, 'numFmt')) custom[nf.getAttribute('numFmtId')] = nf.getAttribute('formatCode');
    const cellXfs = all(st, 'cellXfs')[0];
    if (cellXfs) {
      Array.from(cellXfs.children).forEach((xf, i) => {
        const id = Number(xf.getAttribute('numFmtId') || 0);
        if (BUILTIN_DATE_IDS.has(id) || looksLikeDateFormat(custom[id])) dateStyle.add(i);
      });
    }
  }

  const sheets = [];
  for (const s of all(wbDoc, 'sheet')) {
    const name = s.getAttribute('name');
    const target = rels[s.getAttributeNS(R_NS, 'id')] || rels[s.getAttribute('r:id')];
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    const xml = await text(path);
    if (!xml) continue;
    const sheet = new Sheet(name);
    for (const c of all(parseXml(xml), 'c')) {
      const m = /^([A-Z]+)(\d+)$/.exec(c.getAttribute('r') || '');
      if (!m) continue;
      const col = colIndex(m[1]), row = Number(m[2]) - 1;
      const t = c.getAttribute('t');
      const style = Number(c.getAttribute('s') || 0);
      const vEl = all(c, 'v')[0];
      if (t === 'inlineStr') {
        const v = all(c, 't').map((x) => x.textContent).join('');
        if (v !== '') sheet.set(row, col, { t: 's', v });
        continue;
      }
      if (!vEl) continue;
      const raw = vEl.textContent;
      if (t === 's') { const v = shared[Number(raw)]; if (v !== undefined && v !== '') sheet.set(row, col, { t: 's', v }); }
      else if (t === 'str') { if (raw !== '') sheet.set(row, col, { t: 's', v: raw }); }
      else if (t === 'b') sheet.set(row, col, { t: 'b', v: raw === '1' });
      else if (t === 'e') { /* ошибка формулы — пропускаем */ }
      else if (t === 'd') sheet.set(row, col, { t: 'd', v: raw.slice(0, 10) });
      else {
        const n = parseFloat(raw);
        if (Number.isNaN(n)) continue;
        sheet.set(row, col, dateStyle.has(style) ? { t: 'd', v: serialToISO(n, is1904) } : { t: 'n', v: n });
      }
    }
    sheets.push(sheet);
  }
  return { sheets };
}

// ======================= ЗАПИСЬ =======================
const esc = (s) => String(s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF4"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(sh) {
  const rows = sh.rows;
  const widths = sh.widths || [];
  let maxC = 0;
  let body = '';
  rows.forEach((row, r) => {
    let cells = '';
    row.forEach((v, c) => {
      if (v === null || v === undefined || v === '') return;
      maxC = Math.max(maxC, c);
      const ref = cellAddr(r, c);
      const isHead = r === 0 && sh.header !== false;
      if (v && typeof v === 'object' && v.d) {
        const [y, m, d] = v.d.split('-').map(Number);
        const serial = Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;
        cells += `<c r="${ref}" s="2"><v>${serial}</v></c>`;
      } else if (typeof v === 'number') {
        cells += `<c r="${ref}"><v>${v}</v></c>`;
      } else if (typeof v === 'boolean') {
        cells += `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
      } else {
        const s = isHead ? 1 : (String(v).includes('\n') ? 3 : 0);
        cells += `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }
    });
    body += `<row r="${r + 1}">${cells}</row>`;
  });
  const cols = widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const freeze = sh.header !== false && rows.length > 1
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const filter = sh.header !== false && rows.length > 1 ? `<autoFilter ref="A1:${cellAddr(rows.length - 1, Math.max(maxC, 0))}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${body}</sheetData>${filter}</worksheet>`;
}

const safeSheetName = (n, used) => {
  let s = String(n).replace(/[\\\/?*\[\]:]/g, '-').slice(0, 31) || 'Лист';
  let i = 2;
  while (used.has(s.toLowerCase())) s = s.slice(0, 28) + ' ' + i++;
  used.add(s.toLowerCase());
  return s;
};

/** sheets: [{name, rows:[[...]], widths?:[...], header?:true}] → Blob */
export async function writeXlsx(sheets) {
  const zip = new (JSZ())();
  const used = new Set();
  const names = sheets.map((s) => safeSheetName(s.name, used));
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R_NS}"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', STYLES);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
