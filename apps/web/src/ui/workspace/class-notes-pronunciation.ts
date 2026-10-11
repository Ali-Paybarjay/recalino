export interface NotePronunciationItem {
  id: string;
  target: string;
}
export interface NotePronunciationPlayback {
  itemId: string;
  busy: boolean;
  ready: boolean;
  problem: string;
  message: string;
}
const attribute = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** This program is fixed application code. Model text is escaped metadata, never script. */
export const NOTE_PRONUNCIATION_BRIDGE = `(() => {
  const meta = document.querySelector('meta[name="recalino-pronunciation"]');
  if (!meta) return;
  const config = JSON.parse(meta.content);
  const items = new Map(config.items.map(item => [item.id, item.target]));
  const buttons = [];
  const icon = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M144,32a8,8,0,0,0-13.09-6.17L69.06,76H32A16,16,0,0,0,16,92v72a16,16,0,0,0,16,16H69.06l61.85,50.17A8,8,0,0,0,144,224ZM128,207.22,77,165.83A8,8,0,0,0,72,164H32V92H72a8,8,0,0,0,5-1.83l51-41.39ZM176,96a8,8,0,0,1,11.31,0,45.26,45.26,0,0,1,0,64A8,8,0,0,1,176,148.69a29.26,29.26,0,0,0,0-41.38A8,8,0,0,1,176,96Zm39-39a100.52,100.52,0,0,1,0,142,8,8,0,0,1-11.31-11.31,84.52,84.52,0,0,0,0-119.38A8,8,0,0,1,215,57Z"/></svg>';
  for (const anchor of document.querySelectorAll('[data-learning-item-id]')) {
    const id = anchor.dataset.learningItemId;
    const target = items.get(id);
    if (!target) continue;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'rc-pronunciation';
    button.dataset.pronunciationItem = id;
    button.innerHTML = icon;
    button.setAttribute('aria-label', 'Hear pronunciation of ' + target);
    button.title = 'Hear pronunciation of ' + target;
    button.addEventListener('click', () => parent.postMessage({type:'recalino:pronunciation', channel:config.channel, itemId:id}, '*'));
    anchor.after(button); buttons.push(button);
  }
  const status = document.createElement('p');
  status.className = 'rc-pronunciation-status'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== parent || !data || data.type !== 'recalino:pronunciation-state' || data.channel !== config.channel) return;
    const state = data.state;
    if (state === null) {
      status.remove();
      for (const button of buttons) {
        button.disabled = false;
        button.setAttribute('aria-busy', 'false');
        const label = 'Hear pronunciation of ' + items.get(button.dataset.pronunciationItem);
        button.setAttribute('aria-label', label); button.title = label;
      }
      return;
    }
    if (!state || !items.has(state.itemId)) return;
    status.textContent = state.problem || state.message || '';
    const selected = buttons.find(button => button.dataset.pronunciationItem === state.itemId);
    if (selected && status.textContent) {
      const heading = selected.closest('h3');
      if (heading) heading.after(status);
      else selected.parentElement.append(status);
    } else status.remove();
    for (const button of buttons) {
      const active = button.dataset.pronunciationItem === state.itemId;
      button.disabled = active && state.busy === true;
      button.setAttribute('aria-busy', String(active && state.busy === true));
      const target = items.get(button.dataset.pronunciationItem);
      const label = (active && state.busy ? 'Preparing pronunciation of ' : active && state.problem ? 'Retry pronunciation of ' : 'Hear pronunciation of ') + target;
      button.setAttribute('aria-label',label); button.title = label;
    }
  });
})();`;

/** This bridge can resize or follow an in-document anchor, never execute document-supplied code. */
export const NOTE_READER_BRIDGE = `(() => {
  const meta = document.querySelector('meta[name="recalino-notes-reader"]');
  if (!meta || !document.body) return;
  const config = JSON.parse(meta.content);
  let lastHeight = 0;
  let pending = false;
  const measure = () => {
    pending = false;
    const body = document.body;
    for (const region of body.querySelectorAll('.tw')) {
      if (region.scrollWidth > region.clientWidth && !region.hasAttribute('tabindex')) region.setAttribute('tabindex', '0');
    }
    const style = getComputedStyle(body);
    const margin = Math.max(0, parseFloat(style.marginTop) || 0) + Math.max(0, parseFloat(style.marginBottom) || 0);
    const height = Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().height) + margin + 2);
    if (height !== lastHeight) {
      lastHeight = height;
      parent.postMessage({type:'recalino:notes-height', channel:config.channel, height}, '*');
    }
  };
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(measure);
  };
  new ResizeObserver(schedule).observe(document.body);
  new MutationObserver(schedule).observe(document.body, {subtree:true, childList:true, attributes:true, characterData:true});
  window.addEventListener('resize', schedule);
  window.addEventListener('load', schedule);
  document.addEventListener('load', schedule, true);
  document.addEventListener('toggle', schedule, true);
  if (document.fonts) {
    document.fonts.ready.then(schedule);
    document.fonts.addEventListener('loadingdone', schedule);
  }
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== parent || !data || data.type !== 'recalino:notes-measure' || data.channel !== config.channel) return;
    lastHeight = 0;
    schedule();
  });
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
    if (!link) return;
    let id;
    try { id = decodeURIComponent(link.getAttribute('href').slice(1)); } catch { return; }
    const target = id ? document.getElementById(id) : document.body;
    if (!target) return;
    event.preventDefault();
    for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    }
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({preventScroll:true});
    measure();
    parent.postMessage({type:'recalino:notes-anchor', channel:config.channel, offset:Math.max(0, target.getBoundingClientRect().top + window.scrollY)}, '*');
  });
  schedule();
})();`;

export const NOTES_READER_MIN_HEIGHT = 420;
export const NOTES_READER_MAX_HEIGHT = 250_000;

export type NotesReaderMessage =
  | { type: "resize"; height: number }
  | { type: "anchor"; offset: number };

/** Sandboxed frames have a null origin, so geometry requires the exact Window and channel. */
export function notesReaderMessage(
  event: Pick<MessageEvent, "source" | "data">,
  frameWindow: Window | null,
  channel: string,
): NotesReaderMessage | null {
  if (!frameWindow || event.source !== frameWindow || !event.data || typeof event.data !== "object")
    return null;
  const data = event.data;
  if (data.channel !== channel) return null;
  if (
    data.type === "recalino:notes-height" &&
    typeof data.height === "number" &&
    Number.isFinite(data.height) &&
    data.height >= 0 &&
    Object.keys(data).every((key) => ["type", "channel", "height"].includes(key))
  )
    return {
      type: "resize",
      height: Math.min(
        NOTES_READER_MAX_HEIGHT,
        Math.max(NOTES_READER_MIN_HEIGHT, Math.ceil(data.height)),
      ),
    };
  if (
    data.type === "recalino:notes-anchor" &&
    typeof data.offset === "number" &&
    Number.isFinite(data.offset) &&
    data.offset >= 0 &&
    Object.keys(data).every((key) => ["type", "channel", "offset"].includes(key))
  )
    return { type: "anchor", offset: Math.min(NOTES_READER_MAX_HEIGHT, data.offset) };
  return null;
}

export function interactiveClassNotesHtml(
  html: string,
  items: readonly NotePronunciationItem[],
  channel: string,
  nonce: string,
  options: { fitContent?: boolean } = {},
): string {
  if (!/^[a-zA-Z0-9_-]{10,100}$/.test(channel) || !/^[a-zA-Z0-9_-]{10,100}$/.test(nonce))
    throw new Error("Invalid pronunciation frame channel");
  const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri about:`;
  const config = attribute(JSON.stringify({ channel, items }));
  const reader = options.fitContent
    ? `<meta name="recalino-notes-reader" content="${attribute(JSON.stringify({ channel }))}"><style>html{height:auto!important;min-height:0!important;overflow:hidden!important}body{height:auto!important;min-height:0!important}main>header>h1{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}</style>`
    : "";
  const pronunciation = items.length > 0;
  const pronunciationHead = pronunciation
    ? `<meta name="recalino-pronunciation" content="${config}"><style>.rc-pronunciation{display:inline-grid;place-items:center;vertical-align:middle;inline-size:44px;block-size:44px;flex:none;margin-inline-start:8px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--acc2);cursor:pointer}.rc-pronunciation:focus-visible{outline:2px solid var(--acc2);outline-offset:2px}.rc-pronunciation:disabled{opacity:.6;cursor:wait}.rc-pronunciation-status{font-family:system-ui,sans-serif;font-size:14px;font-weight:400;white-space:normal}@media print{.rc-pronunciation,.rc-pronunciation-status{display:none}}</style>`
    : "";
  const scripts = [
    pronunciation ? NOTE_PRONUNCIATION_BRIDGE : "",
    options.fitContent ? NOTE_READER_BRIDGE : "",
  ]
    .filter(Boolean)
    .map((program) => `<script nonce="${nonce}">${program}</script>`)
    .join("");
  return html
    .replace(
      "<head>",
      `<head><meta http-equiv="Content-Security-Policy" content="${attribute(policy)}">${reader}${pronunciationHead}`,
    )
    .replace("</body>", `${scripts}</body>`);
}

/** A null-origin frame is admitted by its exact Window and per-document random channel. */
export function pronunciationMessageItem(
  event: Pick<MessageEvent, "source" | "data">,
  frameWindow: Window | null,
  channel: string,
  eligibleIds: ReadonlySet<string>,
): string | null {
  if (!frameWindow || event.source !== frameWindow || !event.data || typeof event.data !== "object")
    return null;
  const data = event.data;
  return data.type === "recalino:pronunciation" &&
    data.channel === channel &&
    typeof data.itemId === "string" &&
    eligibleIds.has(data.itemId) &&
    Object.keys(data).every((key) => ["type", "channel", "itemId"].includes(key))
    ? data.itemId
    : null;
}
