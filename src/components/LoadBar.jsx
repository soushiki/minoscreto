/** Barra de carga solo visual: el texto aria-live de al lado ya anuncia el avance. */
export default function LoadBar({ done, total }) {
  const determinate = total > 0;
  return (
    <span className={`load-bar ${determinate ? 'is-determinate' : 'is-indeterminate'}`} aria-hidden="true">
      <span className="load-bar-fill" style={determinate ? { width: `${Math.round(100 * done / total)}%` } : undefined} />
    </span>
  );
}
