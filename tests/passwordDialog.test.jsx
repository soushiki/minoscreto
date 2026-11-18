import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { forwardRef, useImperativeHandle } from 'react';
import PasswordDialog from '../src/components/PasswordDialog.jsx';
import { usePasswordPrompt } from '../src/viewmodels/usePasswordPrompt.js';

// Como en expediente.test.js: jsdom no tiene Worker, así que pdf.js corre su build legacy en el mismo hilo.
vi.mock('pdfjs-dist', async () => ({ ...(await import('pdfjs-dist/legacy/build/pdf.mjs')), GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline', () => ({ default: class {} }));

const RIGHT = 'minoscreto-prueba';
const fixture = (name) => new Uint8Array(readFileSync(`tests/fixtures/${name}_sintetico.pdf`));

// Monta el hook con su diálogo y deja al test llamar askPassword/close y leer el estado, como hará la pantalla (T8).
const Harness = forwardRef(function Harness(_, ref) {
  const pw = usePasswordPrompt();
  useImperativeHandle(ref, () => pw, [pw]);
  return <PasswordDialog prompt={pw.prompt} onSubmit={pw.submit} onCancel={pw.cancel} />;
});

const setup = () => {
  const ref = { current: null };
  const user = userEvent.setup();
  render(<Harness ref={ref} />);
  const ask = (opts) => { let p; act(() => { p = ref.current.askPassword({ fileName: 'caso.pdf', ...opts }); }); return p; };
  return { ref, user, ask };
};

const dialog = () => document.querySelector('dialog.pw-dialog');
const input = () => dialog().querySelector('input');
const openBtn = () => screen.queryByRole('button', { name: /Abrir|Comprobando/ });

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('PasswordDialog + usePasswordPrompt (T7: R1, A1, S1, S3)', () => {
  it('abre con nombre del archivo, aria-label, type="password", foco en la entrada y «Abrir» desactivado vacío', async () => {
    const { ask } = setup();
    ask();
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(dialog().getAttribute('aria-label')).toBe('Contraseña del PDF');
    expect(screen.getByText('caso.pdf')).toBeTruthy();
    expect(input().type).toBe('password');
    expect(input().getAttribute('name')).toBeNull();
    expect(input().getAttribute('autocomplete')).toBe('off');
    await waitFor(() => expect(document.activeElement).toBe(input()));
    expect(openBtn().disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Enter envía: responde la contraseña, borra la entrada y el estado no la guarda', async () => {
    const { ref, user, ask } = setup();
    const answer = ask();
    await user.type(input(), `${RIGHT}{Enter}`);
    await expect(answer).resolves.toBe(RIGHT);
    expect(input().value).toBe('');
    expect(openBtn().textContent).toBe('Comprobando…');
    expect(openBtn().disabled).toBe(true);
    expect(JSON.stringify(ref.current.prompt)).not.toContain(RIGHT);
    expect(Object.keys(ref.current.prompt).sort()).toEqual(['attempt', 'checking', 'fileName', 'reason']);
    act(() => ref.current.close());
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(ref.current.prompt).toBeNull();
  });

  it('Enter con la entrada vacía no envía (pdf.js trataría "" como «need»)', async () => {
    const { ref, user, ask } = setup();
    const submit = vi.spyOn(ref.current, 'submit');
    ask();
    await user.type(input(), '{Enter}');
    expect(submit).not.toHaveBeenCalled();
    expect(ref.current.prompt.checking).toBe(false);
    act(() => ref.current.submit(''));
    expect(ref.current.prompt.checking).toBe(false);
  });

  it('reintento: «Contraseña incorrecta» en el mismo diálogo, foco de vuelta y entrada vacía; luego la correcta', async () => {
    const { user, ask } = setup();
    const first = ask();
    await user.type(input(), 'mala{Enter}');
    await expect(first).resolves.toBe('mala');
    const second = ask({ reason: 'incorrect' });
    expect(screen.getByRole('alert').textContent).toBe('Contraseña incorrecta');
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().value).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(input()));
    await user.type(input(), 'otra{Enter}');
    await expect(second).resolves.toBe('otra');
    expect(screen.queryByRole('alert')).toBeNull();
    const third = ask({ reason: 'incorrect' });
    await waitFor(() => expect(document.activeElement).toBe(input()));
    await user.type(input(), `${RIGHT}{Enter}`);
    await expect(third).resolves.toBe(RIGHT);
  });

  it('Escape cancela: responde null y cierra', async () => {
    const { ref, user, ask } = setup();
    const answer = ask();
    await user.type(input(), 'a medias');
    await user.keyboard('{Escape}');
    await expect(answer).resolves.toBeNull();
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(ref.current.prompt).toBeNull();
  });

  it('el evento nativo «cancel» del <dialog> también cancela', async () => {
    const { ask } = setup();
    const answer = ask();
    act(() => { dialog().dispatchEvent(new Event('cancel', { cancelable: true })); });
    await expect(answer).resolves.toBeNull();
  });

  it('«Cancelar» responde null; borrado al cerrar: al reabrir la entrada está vacía', async () => {
    const { user, ask } = setup();
    const answer = ask();
    await user.type(input(), 'secreta');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await expect(answer).resolves.toBeNull();
    expect(dialog().querySelector('input')).toBeNull();
    const again = ask();
    expect(input().value).toBe('');
    expect(openBtn().disabled).toBe(true);
    act(() => { dialog().dispatchEvent(new Event('cancel', { cancelable: true })); });
    await expect(again).resolves.toBeNull();
  });

  it('cancelar el signal cierra el diálogo y responde null, también mientras dice «Comprobando…»', async () => {
    const { ref, user, ask } = setup();
    const controller = new AbortController();
    const answer = ask({ signal: controller.signal });
    act(() => controller.abort());
    await expect(answer).resolves.toBeNull();
    expect(dialog().hasAttribute('open')).toBe(false);

    const later = new AbortController();
    const typed = ask({ signal: later.signal });
    await user.type(input(), `${RIGHT}{Enter}`);
    await expect(typed).resolves.toBe(RIGHT);
    expect(ref.current.prompt.checking).toBe(true);
    act(() => later.abort());
    expect(ref.current.prompt).toBeNull();
    expect(dialog().hasAttribute('open')).toBe(false);

    const gone = new AbortController();
    gone.abort();
    await expect(ask({ signal: gone.signal })).resolves.toBeNull();
    expect(ref.current.prompt).toBeNull();
  });

  it('en «Comprobando…» Escape y «Cancelar» siguen cerrando (el usuario nunca queda atrapado)', async () => {
    const { ref, user, ask } = setup();
    const first = ask();
    await user.type(input(), `${RIGHT}{Enter}`);
    await expect(first).resolves.toBe(RIGHT);
    expect(screen.getByRole('button', { name: 'Cancelar' }).disabled).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' })));
    await user.keyboard('{Escape}');
    expect(ref.current.prompt).toBeNull();
    expect(dialog().hasAttribute('open')).toBe(false);

    const second = ask();
    await user.type(input(), `${RIGHT}{Enter}`);
    await expect(second).resolves.toBe(RIGHT);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(ref.current.prompt).toBeNull();
  });

  it('ids únicos: dos diálogos montados no comparten aria-describedby', () => {
    render(<><PasswordDialog prompt={{ fileName: 'a.pdf', reason: 'need', attempt: 1, checking: false }} onSubmit={() => {}} onCancel={() => {}} />
      <PasswordDialog prompt={{ fileName: 'b.pdf', reason: 'need', attempt: 1, checking: false }} onSubmit={() => {}} onCancel={() => {}} /></>);
    const [a, b] = [...document.querySelectorAll('dialog.pw-dialog')].map((d) => d.getAttribute('aria-describedby'));
    expect(a).not.toBe(b);
    for (const ids of [a, b]) for (const one of ids.split(' ')) expect(document.getElementById(one)).toBeTruthy();
  });

  it('una sola pregunta pendiente: una nueva responde null a la anterior', async () => {
    const { ref, ask } = setup();
    const first = ask({ fileName: 'uno.pdf' });
    const second = ask({ fileName: 'dos.pdf' });
    await expect(first).resolves.toBeNull();
    expect(screen.getByText('dos.pdf')).toBeTruthy();
    act(() => ref.current.cancel());
    await expect(second).resolves.toBeNull();
  });

  it('desmontar responde null a la pregunta pendiente', async () => {
    const { ask } = setup();
    const answer = ask();
    cleanup();
    await expect(answer).resolves.toBeNull();
  });

  it('usa showModal()/close() del navegador cuando existen', async () => {
    const proto = window.HTMLDialogElement.prototype;
    const hadShow = 'showModal' in proto;
    proto.showModal = vi.fn(function showModal() { this.setAttribute('open', ''); });
    proto.close = vi.fn(function close() { this.removeAttribute('open'); });
    try {
      const { ref, ask } = setup();
      ask();
      expect(proto.showModal).toHaveBeenCalledTimes(1);
      act(() => ref.current.cancel());
      expect(proto.close).toHaveBeenCalledTimes(1);
    } finally {
      if (!hadShow) { delete proto.showModal; delete proto.close; }
    }
  });

  it('con pdf.js real: mala y luego buena desde el diálogo abre el PDF; nada queda en almacenamiento, consola ni URL', async () => {
    const { readPdfPages } = await import('../src/model/expediente/pdfjs.js');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const logs = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m));
    const before = window.location.href;
    const { ref, user } = setup();
    let reading;
    act(() => { reading = readPdfPages(fixture('contrasena_usuario'), { askPassword: ref.current.askPassword, fileName: 'caso.pdf' }); });
    await waitFor(() => expect(dialog().hasAttribute('open')).toBe(true));
    await user.type(input(), 'mala{Enter}');
    await screen.findByRole('alert', {}, { timeout: 5000 });
    await waitFor(() => expect(document.activeElement).toBe(input()));
    await user.type(input(), `${RIGHT}{Enter}`);
    const pages = await reading;
    act(() => ref.current.close());
    expect(pages.length).toBeGreaterThan(0);
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(ref.current.prompt).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    for (const spy of logs) expect(spy.mock.calls.flat().join(' ')).not.toContain(RIGHT);
    expect(window.location.href).toBe(before);
  }, 20000);

  it('ADR-002 (grep): el hook y el diálogo no tocan almacenamiento, consola, URL ni red, ni guardan la contraseña', () => {
    for (const file of ['src/viewmodels/usePasswordPrompt.js', 'src/components/PasswordDialog.jsx']) {
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, `ADR-002: password code must not touch storage, logs or network (${file})`)
        .not.toMatch(/localStorage|sessionStorage|indexedDB|console\.|location|fetch\(|XMLHttpRequest|sendBeacon|innerHTML/);
      expect([...code.matchAll(/^(?:let|var|const)\s+(\w+)/gm)], file).toEqual([]);
      expect(code, file).not.toMatch(/\bpassword\w*\s*=(?!=)/i);
      expect(code, file).not.toMatch(/useState\([^)]*password/i);
    }
  });
});
