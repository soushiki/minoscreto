export function flashElement(el) {
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1200);
}

const plainRect = (r) => ({ left: r.left, top: r.top, bottom: r.bottom });
const isAlnum = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch);

function wordAt(x, y, cell) {
  let node;
  let offset;
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) { node = pos.offsetNode; offset = pos.offset; }
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (range) { node = range.startContainer; offset = range.startOffset; }
  }
  if (!node || node.nodeType !== 3 || !cell.contains(node)) return null;
  const text = node.data;
  const inner = (i) => '.-/@_'.includes(text[i]) && isAlnum(text[i - 1]) && isAlnum(text[i + 1]);
  if (!isAlnum(text[offset]) && !isAlnum(text[offset - 1])) return null;
  let a = offset;
  let b = offset;
  while (a > 0 && (isAlnum(text[a - 1]) || inner(a - 1))) a--;
  while (b < text.length && (isAlnum(text[b]) || inner(b))) b++;
  if (b - a < 2) return null;
  const range = document.createRange();
  range.setStart(node, a);
  range.setEnd(node, b);
  return { text: text.slice(a, b), rect: plainRect(range.getBoundingClientRect()) };
}

export function pickFromPointer({ target, clientX, clientY }) {
  const cell = target.closest?.('.cell.orig');
  if (!cell) return null;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.rangeCount) {
    const range = selection.getRangeAt(0);
    const a = range.startContainer.parentElement?.closest('.cell.orig');
    const b = range.endContainer.parentElement?.closest('.cell.orig');
    if (a && a === b) {
      const text = selection.toString().replace(/\s+/g, ' ').trim();
      if (text.length >= 2 && text.length <= 200) return { kind: 'new', text, rect: plainRect(range.getBoundingClientRect()) };
    }
    return null;
  }
  const entity = target.closest('.ent');
  if (entity) return { kind: 'entity', entityId: entity.dataset.e, key: entity.dataset.k, rect: plainRect(entity.getBoundingClientRect()) };
  if (target.closest('.plabel')) return null;
  const word = wordAt(clientX, clientY, cell);
  return word ? { kind: 'new', text: word.text, rect: word.rect } : null;
}
