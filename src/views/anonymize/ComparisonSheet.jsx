import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import FileButton from '../../components/FileButton.jsx';
import Segmented from '../../components/Segmented.jsx';
import { pickFromPointer } from '../../utils/dom.js';
import { COMPACT_QUERY, TOUCH_QUERY, useMediaQuery } from '../../utils/useMediaQuery.js';
import ParagraphRow from './ParagraphRow.jsx';

const DOCX = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const VIEWS = [
  { value: 'split', label: 'Lado a lado' },
  { value: 'orig', label: 'Original' },
  { value: 'anon', label: 'Anonimizado' }
];
const COMPACT_VIEWS = VIEWS.filter((v) => v.value !== 'split');

const stickyBottom = (compact) =>
  document.querySelector(compact ? '.view-switch' : '.stick')?.getBoundingClientRect().bottom ?? 0;

export default function ComparisonSheet({ vm }) {
  const body = useRef(null);
  const { currentHit, query } = vm;
  const compact = useMediaQuery(COMPACT_QUERY);
  const touch = useMediaQuery(TOUCH_QUERY);
  const view = compact && vm.view === 'split' ? 'orig' : vm.view;
  const anchor = useRef(null);

  const changeView = useCallback((next) => {
    const rows = body.current ? [...body.current.querySelectorAll('.row')] : [];
    const top = stickyBottom(compact);
    const index = rows.findIndex((r) => r.getBoundingClientRect().bottom > top);
    anchor.current = index >= 0 ? { index, offset: rows[index].getBoundingClientRect().top - top } : null;
    vm.actions.setView(next);
  }, [vm.actions, compact]);

  useLayoutEffect(() => {
    const target = anchor.current;
    anchor.current = null;
    if (!target || !body.current) return;
    const row = body.current.querySelectorAll('.row')[target.index];
    const top = stickyBottom(compact);
    if (row) window.scrollBy(0, row.getBoundingClientRect().top - top - target.offset);
  }, [view]);
  const hitPi = currentHit?.pi;
  const hitStart = currentHit?.start;

  useEffect(() => {
    if (hitPi === undefined) return;
    const el = body.current?.querySelector(`[data-hit="${hitPi}:${hitStart}"]`);
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [hitPi, hitStart, query]);

  const onMouseUp = ({ target, clientX, clientY }) => {
    setTimeout(() => {
      const popover = pickFromPointer({ target, clientX, clientY });
      if (popover) vm.actions.openPopover(popover);
    }, 0);
  };

  useEffect(() => {
    if (!touch) return undefined;
    let timer;
    const onSelection = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const selection = window.getSelection();
        const node = selection?.anchorNode;
        const element = node?.nodeType === 3 ? node.parentElement : node;
        if (!element || !body.current?.contains(element) || selection.isCollapsed) return;
        const popover = pickFromPointer({ target: element, clientX: 0, clientY: 0 });
        if (popover) vm.actions.openPopover(popover);
      }, 450);
    };
    document.addEventListener('selectionchange', onSelection);
    return () => { clearTimeout(timer); document.removeEventListener('selectionchange', onSelection); };
  }, [touch, vm.actions]);

  return (
    <section className="sheet" data-view={view} aria-label="Comparación del documento">
      <div className="stick">
        <div className="sheethead">
          <div className="doc">
            <strong>{vm.name}.docx</strong>
            <span>{vm.paragraphCount} párrafos · {vm.enabledCount} datos · {vm.replacements} reemplazos</span>
          </div>
          <FileButton accept={DOCX} onFile={vm.loadFile}>Abrir otro Word</FileButton>
          <Segmented className="view-switch" options={compact ? COMPACT_VIEWS : VIEWS} value={view} onChange={changeView} label="Vista" />
        </div>
        <div className="cols">
          <div>{compact ? 'Original · toca una palabra o selecciona una frase' : 'Original (haz clic en una palabra o selecciona una frase)'}</div>
          <div>Lo que verá la IA</div>
        </div>
      </div>
      <div ref={body} onMouseUp={onMouseUp}>
        {vm.rows.length === 0 && vm.loaded && <div className="empty">No se encontró texto en este documento.</div>}
        {vm.rows.map((row) => <ParagraphRow key={row.index} row={row} />)}
      </div>
    </section>
  );
}
