import Segmented from '../../components/Segmented.jsx';
import { CopyIcon, DownloadIcon } from '../../components/Icons.jsx';
import DownloadReceipt from '../../components/DownloadReceipt.jsx';

const fmt = (n) => Math.round(n).toLocaleString('es-CO');
const secs = (ms) => (ms === undefined ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

function NumberField({ label, value, min, max, step, onChange, suffix }) {
  return (
    <label className="xp-num">
      <span className="lbl">{label}</span>
      <span className="xp-numin">
        <input type="number" inputMode="numeric" value={value} min={min} max={max} step={step}
          onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= min) onChange(Math.min(max, n)); }} />
        {suffix && <span className="muted">{suffix}</span>}
      </span>
    </label>
  );
}

export default function ExportCard({ vm }) {
  const { split, rendered } = vm;
  const zip = vm.format === 'zip';
  const multi = rendered.length > 1;
  const { setSplit } = vm.actions;
  const t = vm.timings;

  return (
    <section className="card xp-export">
      <div className="xp-head">
        <div>
          <h2>Exportar texto anonimizado</h2>
          <p className="sub">{vm.applying ? 'Aplicando cambios…' : `${fmt(vm.replacements)} reemplazos · ≈ ${fmt(vm.outputTokens)} tokens en total`}</p>
        </div>
        <Segmented label="Formato" value={vm.format} onChange={vm.actions.setFormat}
          options={[{ value: 'zip', label: 'En partes' }, { value: 'md', label: 'Un solo archivo' }]} />
      </div>

      <div className="xp-opts">
        <div className="xp-opt">
          <span className="lbl">Qué exportar</span>
          <Segmented label="Qué exportar" value={vm.scope} onChange={(v) => (v === 'selection' && !vm.selectedCount ? null : vm.actions.setScope(v))}
            options={[{ value: 'all', label: 'Todo el expediente' }, { value: 'selection', label: `Solo marcados (${vm.selectedCount})` }]} />
        </div>
        {zip && (
          <>
            <div className="xp-opt">
              <span className="lbl">Dividir</span>
              <Segmented label="Cómo dividir" value={split.mode} onChange={(mode) => setSplit({ mode })}
                options={[{ value: 'tokens', label: 'Por tamaño' }, { value: 'pages', label: `Por ${vm.units.many}` }, { value: 'sections', label: 'Por títulos' }]} />
            </div>
            {split.mode === 'pages'
              ? <NumberField label={`${vm.units.title}s por parte`} value={split.pagesPerPart} min={1} max={2000} step={10} onChange={(n) => setSplit({ pagesPerPart: n })} />
              : <NumberField label="Máximo por parte" value={split.maxTokens} min={2000} max={1000000} step={5000} suffix="tokens" onChange={(n) => setSplit({ maxTokens: n })} />}
            <NumberField label="Solapamiento" value={split.overlap} min={0} max={20} step={1} suffix="párrafos" onChange={(n) => setSplit({ overlap: n })} />
          </>
        )}
      </div>
      {zip && split.mode === 'sections' && <p className="muted">Corta solo donde empieza un CAPÍTULO, CLÁUSULA, CONSIDERANDOS, RESUELVE o un título numerado, sin pasar del máximo.</p>}

      {zip && multi && (
        <div className="xp-parts" role="table" aria-label="Partes">
          <div role="row" className="xp-prow hd"><span role="columnheader">Parte</span><span role="columnheader">{vm.units.title}s</span><span role="columnheader">≈ tokens</span><span role="columnheader"><span className="sr">Copiar</span></span></div>
          {rendered.map((p, k) => (
            <div role="row" className="xp-prow" key={p.number}>
              <span role="cell">{p.number} de {rendered.length}</span>
              <span role="cell">{p.first === p.last ? p.first : `${p.first}–${p.last}`}</span>
              <span role="cell">{fmt(vm.parts[k]?.tokens ?? 0)}</span>
              <span role="cell">
                <button type="button" className="btn sm xp-copy" disabled={!vm.canExport} onClick={() => vm.copyPart(k)}>
                  <CopyIcon />Copiar parte {p.number} de {rendered.length}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      {zip && !multi && rendered.length === 1 && <p className="muted">Cabe en una sola parte: se descarga como un único archivo.</p>}

      <div className="row-btns xp-dl">
        <button type="button" className="btn primary" disabled={!vm.canExport} onClick={vm.download}
          title={multi ? 'Un archivo comprimido con las partes y el diccionario' : 'El texto protegido y su diccionario'}>
          <DownloadIcon />{multi ? `Descargar (${rendered.length} partes y diccionario)` : 'Descargar'}
        </button>
        {!multi && (
          <button type="button" className="btn" disabled={!vm.canExport} onClick={() => vm.copyPart(0)}><CopyIcon />Copiar texto para la IA</button>
        )}
      </div>
      {vm.blocked && <p className="xp-warn">Antes de exportar, confirme arriba qué hacer con los folios sin texto.</p>}
      <DownloadReceipt receipt={vm.receipt} onDictionaryAgain={vm.downloadDictionaryAgain} />
      <p className="muted">
        {multi
          ? 'Se descarga un solo archivo comprimido: las partes en «para-subir-a-la-IA» y el diccionario en «NO-SUBIR». También puede copiar cada parte y pegarla en la IA. '
          : 'Se descargan dos archivos: el texto protegido y su diccionario. '}
        Para recuperar los nombres en la respuesta de la IA, use «Restaurar nombres» con el diccionario.
      </p>
      <p className="xp-times muted">Tiempos: lectura {secs(t.readMs)} · párrafos {secs(t.layoutMs)} · detección {secs(t.detectMs)} · anonimizar {secs(t.applyMs)} · exportar {secs(t.exportMs)}</p>
    </section>
  );
}
