export default function Toast({ toast }) {
  if (!toast) return null;
  return <div className={`toast${toast.isError ? ' err' : ''}`} role="status">{toast.message}</div>;
}
