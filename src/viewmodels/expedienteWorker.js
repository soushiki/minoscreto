// Cliente del worker del expediente: promesas por mensaje y, sin Worker disponible, ejecución directa.
let worker = null;
let starting = null;
let sequence = 0;
const pending = new Map();

async function getWorker() {
  if (worker) return worker;
  if (!starting) {
    starting = import('../workers/expediente.worker.js?worker&inline').then(({ default: ExpedienteWorker }) => {
      worker = new ExpedienteWorker();
      worker.onmessage = ({ data }) => {
        const job = pending.get(data.id);
        if (!job) return;
        pending.delete(data.id);
        if (data.error) job.reject(new Error(data.error)); else job.resolve(data.result);
      };
      worker.onerror = (event) => {
        for (const job of pending.values()) job.reject(new Error(event.message || 'Falló el proceso en segundo plano.'));
        pending.clear();
      };
      return worker;
    });
  }
  return starting;
}

export async function runExpedienteTask(op, payload) {
  if (typeof Worker === 'undefined') {
    const { runTask } = await import('../workers/expedienteTasks.js');
    return runTask(op, payload);
  }
  const w = await getWorker();
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, op, payload });
  });
}
