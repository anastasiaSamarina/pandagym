// Фото, GIF и ссылки на видео у упражнения. Файлы лежат в IndexedDB устройства и (при синхронизации) в папке media/ репозитория.
import { h, toast, modal, uid } from './util.js';
import { touch, putMedia } from './store.js';
import { mediaUrl } from './sync.js';

// ---------- фото и GIF ----------
async function shrinkImage(file) {
  if (file.type === 'image/gif' || /\.gif$/i.test(file.name || '')) {
    if (file.size > 8 * 1024 * 1024) throw new Error('GIF больше 8 МБ — сожми его или добавь ссылкой на видео');
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
/** accept: 'image/*' — галерея телефона; '.gif,image/gif' — обычный выбор файла (в галерее Android гифки часто не видны) */
function attach(it, w, rerender, accept) {
  const input = h('input', { type: 'file', accept, style: 'display:none' });
  input.addEventListener('change', async () => {
    const f = input.files[0]; if (!f) return;
    try {
      const { blob, ext } = await shrinkImage(f);
      const id = uid('m') + ext;
      await putMedia(id, blob, false);
      (it.media ||= []).push(id);
      touch(w); rerender();
    } catch (e) { toast(e.message || 'Не удалось добавить файл', 4000); }
    input.remove();
  });
  document.body.append(input); input.click(); setTimeout(() => input.remove(), 120000);
}
function openImage(src) { modal((close) => h('img', { src, class: 'big-img', onclick: close })); }

export function mediaStrip(it, w, rerender) {
  if (!it.media || !it.media.length) return null;
  return h('div', { class: 'media-strip' }, it.media.map((id) => {
    const img = h('img', { alt: '', class: 'thumb', onclick: () => img.src && openImage(img.src) });
    mediaUrl(id).then((u) => { if (u) img.src = u; else img.replaceWith(h('div', { class: 'thumb missing' }, 'нет файла')); });
    return h('div', { class: 'thumb-wrap' }, img,
      h('button', { class: 'x', title: 'Убрать', onclick: () => { it.media = it.media.filter((m) => m !== id); touch(w); rerender(); } }, '✕'));
  }));
}

// ---------- ссылки на видео ----------
/** Что можно показать прямо в карточке: YouTube, Vimeo, Rutube, прямой файл видео/картинки. Остальное — просто ссылка. */
export function embedOf(url) {
  let u; try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) id = u.searchParams.get('v') || (/^\/(?:shorts|embed|live)\/([\w-]{6,})/.exec(u.pathname) || [])[1];
  if (id && /^[\w-]{6,}$/.test(id)) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${id}` };
  if (host === 'vimeo.com' || host === 'player.vimeo.com') { const m = /(\d{6,})/.exec(u.pathname); if (m) return { kind: 'iframe', src: `https://player.vimeo.com/video/${m[1]}` }; }
  if (host === 'rutube.ru') { const m = /\/video\/([0-9a-f]{32})/.exec(u.pathname); if (m) return { kind: 'iframe', src: `https://rutube.ru/play/embed/${m[1]}` }; }
  if (/\.(mp4|webm|mov|m4v)$/i.test(u.pathname)) return { kind: 'video', src: url };
  if (/\.(gif|png|jpe?g|webp)$/i.test(u.pathname)) return { kind: 'img', src: url };
  return null;
}
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

export function linkStrip(it, w, rerender) {
  if (!it.links || !it.links.length) return null;
  return h('div', { class: 'links' }, it.links.map((url) => {
    const emb = embedOf(url);
    const box = h('div', { class: 'video-box' });
    box.hidden = true;
    const toggle = emb ? h('button', { class: 'btn small', onclick: (e) => {
      if (box.hidden) {
        box.replaceChildren(emb.kind === 'iframe' ? h('iframe', { class: 'video-frame', src: emb.src, allowfullscreen: true, loading: 'lazy', referrerpolicy: 'strict-origin-when-cross-origin', allow: 'encrypted-media; picture-in-picture; fullscreen' })
          : emb.kind === 'video' ? h('video', { class: 'video-frame', src: emb.src, controls: true, playsinline: true, preload: 'metadata' }) : h('img', { class: 'big-img', src: emb.src, alt: '' }));
        box.hidden = false; e.target.textContent = '▲ Скрыть';
      } else { box.replaceChildren(); box.hidden = true; e.target.textContent = '▶ Смотреть'; }
    } }, '▶ Смотреть') : null;
    return h('div', { class: 'link-row' },
      h('div', { class: 'row between' },
        h('a', { class: 'link', href: url, target: '_blank', rel: 'noopener noreferrer' }, '🔗 ' + hostOf(url)),
        h('span', { class: 'row' }, toggle, h('button', { class: 'ico', title: 'Убрать ссылку', onclick: () => { it.links = it.links.filter((x) => x !== url); touch(w); rerender(); } }, '✕'))),
      box);
  }));
}
function linkDialog(it, w, rerender) {
  const input = h('input', { class: 'txt', type: 'url', placeholder: 'https://youtu.be/…', autocomplete: 'off', autocapitalize: 'none' });
  modal((close) => h('div', {}, h('h3', {}, 'Ссылка на видео'),
    h('p', { class: 'muted' }, 'YouTube, Vimeo и Rutube можно будет смотреть прямо в карточке, остальные ссылки откроются в новой вкладке. Нужен интернет.'), input,
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: close }, 'Отмена'), h('button', { class: 'btn primary', onclick: () => {
      let v = input.value.trim(); if (!v) return;
      if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
      try { new URL(v); } catch { toast('Не похоже на ссылку'); return; }
      (it.links ||= []).push(v); touch(w); close(); rerender();
    } }, 'Добавить'))));
  setTimeout(() => input.focus(), 50);
}

/** Кнопки «фото / GIF / видео» — теперь на виду, а не в меню «⋯» */
export function mediaButtons(it, w, rerender) {
  return [
    h('button', { class: 'btn small', onclick: () => attach(it, w, rerender, 'image/*') }, '📷 Фото'),
    h('button', { class: 'btn small', title: 'Выбрать файл .gif', onclick: () => attach(it, w, rerender, '.gif,image/gif') }, '🎞 GIF'),
    h('button', { class: 'btn small', onclick: () => linkDialog(it, w, rerender) }, '🔗 Видео'),
  ];
}
