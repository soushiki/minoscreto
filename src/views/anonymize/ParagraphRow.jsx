import { memo } from 'react';
import { segmentsOf } from '../../model/index.js';

function OriginalText({ row }) {
  const segments = segmentsOf(row.text, row.occurrences, row.hitRanges);
  return segments.map((seg) => {
    const { occurrence: o, hit } = seg;
    if (!o && !hit) return seg.text;
    const classes = ['frag'];
    const data = {};
    if (o) {
      classes.push('ent', `t-${o.entityType}`);
      if (!o.active) classes.push('off');
      data['data-e'] = o.entityId;
      data['data-k'] = o.key;
    }
    if (hit) {
      classes.push('hit');
      if (hit[0] === row.currentStart) classes.push('cur');
      if (hit[0] === seg.start) data['data-hit'] = `${row.index}:${hit[0]}`;
    }
    return <span key={seg.start} className={classes.join(' ')} {...data}>{seg.text}</span>;
  });
}

function AnonymizedText({ row }) {
  const parts = [];
  let pos = 0;
  row.occurrences.filter((o) => o.active).forEach((o) => {
    if (o.start > pos) parts.push(row.text.slice(pos, o.start));
    parts.push(
      <span key={o.start} className={`tag t-${o.entityType}`} title={row.text.slice(o.start, o.end)}>[{o.label}]</span>
    );
    pos = o.end;
  });
  if (pos < row.text.length) parts.push(row.text.slice(pos));
  return parts;
}

function ParagraphRow({ row }) {
  return (
    <div className="row">
      <div className="cell orig">
        {row.part && <span className="plabel">{row.part}</span>}
        <OriginalText row={row} />
      </div>
      <div className="cell anon">
        {row.part && <span className="plabel">{row.part}</span>}
        <AnonymizedText row={row} />
      </div>
    </div>
  );
}

export default memo(ParagraphRow, (a, b) => a.row.signature === b.row.signature && a.row.text === b.row.text);
