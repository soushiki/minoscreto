// Carga del motor PDFium (ADR-004, R6, S5, S6). Solo cuando se pide el primer PDF con diseño: GET de los dos
// archivos del build (mismo origen), SHA-256 de cada uno contra el valor del build, y solo entonces el worker blob:
// recibe los bytes del wasm. Es el único `fetch` de src/ (fitness en tests/engine.test.js).
import { ENGINE } from 'virtual:minoscreto-engine';

/** code: 'unavailable' | 'unsupported' | 'wasm' | 'fetch' | 'hash' | 'worker' | 'timeout' | 'terminated', o el de PDFium. */
export class EngineError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'EngineError';
    this.code = code;
  }
}

const READY_TIMEOUT_MS = 30_000;
const OPEN_TIMEOUT_MS = 30_000; // abrir un archivo de hasta 80 MB
const CALL_TIMEOUT_MS = 10_000; // por página (ADR-005)
const SAVE_TIMEOUT_MS = 30_000; // guardar un archivo de hasta 80 MB
const ENGINE_PATH = /^\/engine\/[\w.-]+$/; // mismo origen, solo /engine/ (S6)
const SHA256_HEX = /^[0-9a-f]{64}$/;

async function getVerified(file) {
  if (!ENGINE_PATH.test(file?.url ?? '') || !SHA256_HEX.test(file?.sha256 ?? '')) throw new EngineError('unavailable', 'ENGINE inválido');
  let bytes;
  try {
    const response = await fetch(file.url, { method: 'GET', credentials: 'same-origin', redirect: 'error' });
    if (!response.ok) throw new EngineError('fetch', `HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw error instanceof EngineError ? error : new EngineError('fetch', error?.message);
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hex !== file.sha256) throw new EngineError('hash', file.url);
  return bytes;
}

function startWorker(workerCode, wasmBinary) {
  const url = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
  let worker;
  try {
    worker = new Worker(url);
  } catch (error) {
    URL.revokeObjectURL(url);
    return Promise.reject(new EngineError('worker', error?.message));
  }
  return new Promise((resolve, reject) => {
    const fail = (error) => {
      clearTimeout(timer);
      worker.terminate();
      reject(error);
    };
    const timer = setTimeout(() => fail(new EngineError('timeout', 'el motor no arrancó')), READY_TIMEOUT_MS);
    worker.onmessage = ({ data }) => {
      if (data?.type === 'ready') {
        clearTimeout(timer);
        resolve(worker);
      } else if (data?.type === 'error') {
        fail(new EngineError('wasm', data.message)); // p. ej. WebAssembly bloqueado por CSP o por el navegador
      }
    };
    worker.onerror = (event) => {
      event?.preventDefault?.();
      fail(new EngineError('worker', event?.message));
    };
    worker.onmessageerror = () => fail(new EngineError('worker', 'mensaje ilegible'));
    try {
      worker.postMessage({ type: 'init', wasmBinary }, [wasmBinary.buffer]);
    } catch (error) {
      fail(new EngineError('worker', error?.message));
    }
  }).finally(() => URL.revokeObjectURL(url));
}

// EngineClient: llamadas con promesa sobre postMessage. Un fallo del worker rechaza todo lo pendiente y lo termina.
function createClient(worker, onDead) {
  const pending = new Map();
  let nextId = 1;
  let dead = null;

  const kill = (error) => {
    if (dead) return;
    dead = error;
    worker.terminate();
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    onDead();
  };

  worker.onmessage = ({ data }) => {
    if (data?.type !== 'result') return;
    const call = pending.get(data.id);
    if (!call) return;
    pending.delete(data.id);
    if (data.ok) call.resolve(data.result);
    else call.reject(new EngineError(data.error?.code ?? 'error', data.error?.message));
  };
  worker.onerror = (event) => {
    event?.preventDefault?.();
    kill(new EngineError('worker', event?.message));
  };
  worker.onmessageerror = () => kill(new EngineError('worker', 'mensaje ilegible'));

  // Sin respuesta a tiempo = PDFium colgado en un archivo hostil: se termina el worker (ADR-005) y quien llama
  // recibe 'timeout' para caer al PDF de texto.
  const call = (method, args = [], transfer = [], timeoutMs = CALL_TIMEOUT_MS) => {
    if (dead) return Promise.reject(dead);
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => kill(new EngineError('timeout', method)), timeoutMs);
      const settle = (done) => (value) => {
        clearTimeout(timer);
        done(value);
      };
      pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
      try {
        worker.postMessage({ type: 'call', id, method, args }, transfer);
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(new EngineError('worker', error?.message));
      }
    });
  };

  return Object.freeze({
    /** Copia `bytes` y transfiere la copia; el buffer de quien llama queda intacto. La contraseña no se guarda. */
    open(bytes, password = '') {
      const copy = new Uint8Array(bytes);
      return call('open', [copy, password], [copy.buffer], OPEN_TIMEOUT_MS);
    },
    pageStats: (pageIndex) => call('pageStats', [pageIndex]),
    /** `needles`: [{ value, put }]; una página por llamada, con su propio tiempo límite (ADR-005). */
    editPage: (pageIndex, options) => call('editPage', [pageIndex, { mode: options?.mode, needles: options?.needles }]),
    /** Bytes del documento entero, sin cifrado. */
    save: () => call('save', [], [], SAVE_TIMEOUT_MS),
    close: () => call('close'),
    terminate: () => kill(new EngineError('terminated')),
    get alive() {
      return !dead;
    }
  });
}

async function start(engine, onDead) {
  if (!engine) throw new EngineError('unavailable', 'sin motor en este build');
  if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') throw new EngineError('wasm', 'WebAssembly no disponible');
  if (typeof Worker !== 'function' || !globalThis.crypto?.subtle) throw new EngineError('unsupported');
  const [workerCode, wasmBinary] = await Promise.all([getVerified(engine.worker), getVerified(engine.wasm)]);
  return createClient(await startWorker(workerCode, wasmBinary), onDead);
}

/** Un cargador memoizado: la misma promesa mientras el motor viva; tras un fallo o `terminate()` se puede reintentar. */
export function createEngineLoader(engine = ENGINE) {
  let loading = null;
  return function loadEngine() {
    if (loading) return loading;
    const mine = start(engine, () => {
      if (loading === mine) loading = null;
    }).catch((error) => {
      if (loading === mine) loading = null;
      throw error;
    });
    loading = mine;
    return mine;
  };
}

export const loadEngine = createEngineLoader();
