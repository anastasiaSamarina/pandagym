// Фото, GIF и ссылки на видео у упражнения. Файлы лежат в IndexedDB устройства и (при синхронизации) в папке media/ репозитория.
import { icon } from './icons.js';
import { h, toast, modal, uid } from './util.js';
import { touch, putMedia } from './store.js';
import { mediaUrl } from './sync.js';

// ---------- файлы: фото, GIF, короткие видео (хранятся как есть, без пережатия) ----------
const EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'm4v', 'mov', 'webm'];
const MAX_MB = 25;
export const isVideoId = (id) => /\.(mp4|m4v|mov|webm)$/i.test(id);
/** Только расширения в accept: тогда телефон открывает обычный выбор файлов, а не только «Google Фото» */
const ACCEPT = EXTS.map((e) => '.' + e).join(',');
function extOf(f) {
  const m = /\.(\w+)$/.exec(f.name || ''); const e = m && m[1].toLowerCase();
  if (e && EXTS.includes(e)) return e === 'jpeg' ? 'jpg' : e;
  const t = (f.type || '').split('/')[1] || '';
  return EXTS.includes(t) ? t : /^image/.test(f.type) ? 'jpg' : /^video/.test(f.type) ? 'mp4' : null;
}
function attach(it, w, rerender) {
  const input = h('input', { type: 'file', accept: ACCEPT, multiple: true, style: 'display:none' });
  input.addEventListener('change', async () => {
    let added = 0;
    for (const f of [...input.files]) {
      const ext = extOf(f);
      if (!ext) { toast(`«${f.name}»: такой формат не поддерживается (jpg, png, gif, webp, mp4)`, 5000); continue; }
      if (f.size > MAX_MB * 1024 * 1024) { toast(`«${f.name}» больше ${MAX_MB} МБ — сожми видео или добавь ссылкой`, 6000); continue; }
      try { const id = uid('m') + '.' + ext; await putMedia(id, f, false); (it.media ||= []).push(id); added++; }
      catch (e) { toast(e.message || 'Не удалось добавить файл', 4000); }
    }
    if (added) { touch(w); rerender(); }
    input.remove();
  });
  document.body.append(input); input.click(); setTimeout(() => input.remove(), 120000);
}
function openImage(src) { modal((close) => h('img', { src, class: 'big-img', onclick: close })); }

export function mediaStrip(it, w, rerender) {
  if (!it.media || !it.media.length) return null;
  const remove = (id) => h('button', { class: 'x', title: 'Убрать', 'aria-label': 'Убрать', onclick: () => { it.media = it.media.filter((m) => m !== id); touch(w); rerender(); } }, icon('x'));
  return h('div', { class: 'media-strip' }, it.media.map((id) => {
    if (isVideoId(id)) {
      // видео играет прямо в карточке: без звука, по кругу, само (когда попадает на экран)
      const v = h('video', { class: 'media-video', playsinline: true, controls: true, preload: 'metadata' });
      v.muted = true; v.loop = true; v.autoplay = true; v.setAttribute('playsinline', '');
      mediaUrl(id).then((u) => {
        if (!u) { v.replaceWith(h('div', { class: 'thumb missing' }, 'нет файла')); return; }
        v.src = u;
        if ('IntersectionObserver' in window) new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); }), { threshold: 0.4 }).observe(v);
        else v.play().catch(() => {});
      });
      return h('div', { class: 'thumb-wrap video-wrap' }, v, remove(id));
    }
    const img = h('img', { alt: '', class: 'thumb', onclick: () => img.src && openImage(img.src) });
    mediaUrl(id).then((u) => { if (u) img.src = u; else img.replaceWith(h('div', { class: 'thumb missing' }, 'нет файла')); });
    return h('div', { class: 'thumb-wrap' }, img, remove(id));
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
      } else { box.replaceChildren(); box.hidden = true; e.target.textContent = 'Смотреть'; }
    } }, 'Смотреть') : null;
    return h('div', { class: 'link-row' },
      h('div', { class: 'row between' },
        h('a', { class: 'link', href: url, target: '_blank', rel: 'noopener noreferrer' }, '🔗 ' + hostOf(url)),
        h('span', { class: 'row' }, toggle, h('button', { class: 'ico', title: 'Убрать ссылку', 'aria-label': 'Убрать ссылку', onclick: () => { it.links = it.links.filter((x) => x !== url); touch(w); rerender(); } }, icon('x')))),
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

/** Две кнопки без подписей: файл и ссылка */
export function mediaButtons(it, w, rerender) {
  return [
    h('button', { class: 'btn small icon-only', title: 'Прикрепить файл: фото, GIF или короткое видео', 'aria-label': 'Прикрепить файл', onclick: () => attach(it, w, rerender) }, icon('clip')),
    h('button', { class: 'btn small icon-only', title: 'Добавить ссылку на видео', 'aria-label': 'Добавить ссылку', onclick: () => linkDialog(it, w, rerender) }, icon('link')),
  ];
}
