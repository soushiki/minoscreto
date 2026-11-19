// Pide la contraseña de un PDF en una ventana de Windows, fuera del chat: Claude nunca la ve y no se guarda en disco.
// La ventana es un PowerShell aparte (Windows Forms). La contraseña vuelve por su salida estándar, en base64 para
// no depender de la página de códigos, y solo vive en la variable que se le pasa a pdf.js (como en la página, ADR-002).
import { spawn } from 'node:child_process';

const WAIT_MS = 5 * 60 * 1000;

const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
# windowsHide (sin consola negra) hace que Windows oculte la PRIMERA ventana del proceso: se la lleva esta, invisible
# y fuera de la pantalla; si no, la de la contraseña quedaba abierta pero sin verse.
$d = New-Object System.Windows.Forms.Form
$d.Opacity = 0; $d.ShowInTaskbar = $false; $d.StartPosition = 'Manual'
$d.Location = New-Object System.Drawing.Point(-3000, -3000); $d.Size = New-Object System.Drawing.Size(1, 1)
$d.Show(); $d.Close(); $d.Dispose()
$f = New-Object System.Windows.Forms.Form
$f.Text = 'Minoscreto: contraseña del PDF'
$f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false
$f.StartPosition = 'CenterScreen'; $f.TopMost = $true; $f.ShowInTaskbar = $true
$f.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$f.ClientSize = New-Object System.Drawing.Size(440, 170)
$l = New-Object System.Windows.Forms.Label
$l.Location = New-Object System.Drawing.Point(14, 12); $l.Size = New-Object System.Drawing.Size(412, 62)
$l.Text = $env:MINOSCRETO_MSG
$t = New-Object System.Windows.Forms.TextBox
$t.Location = New-Object System.Drawing.Point(14, 80); $t.Size = New-Object System.Drawing.Size(412, 28)
$t.UseSystemPasswordChar = $true; $t.AccessibleName = 'Contraseña del PDF'
$ok = New-Object System.Windows.Forms.Button
$ok.Text = 'Abrir'; $ok.DialogResult = 'OK'
$ok.Location = New-Object System.Drawing.Point(236, 122); $ok.Size = New-Object System.Drawing.Size(92, 34)
$no = New-Object System.Windows.Forms.Button
$no.Text = 'Cancelar'; $no.DialogResult = 'Cancel'
$no.Location = New-Object System.Drawing.Point(334, 122); $no.Size = New-Object System.Drawing.Size(92, 34)
$f.AcceptButton = $ok; $f.CancelButton = $no
$f.Controls.AddRange(@($l, $t, $ok, $no))
$f.Add_Shown({ $f.Activate(); $t.Focus() })
if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write('ok:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t.Text)))
}
`;

const ENCODED = Buffer.from(SCRIPT, 'utf16le').toString('base64');

export const passwordMessage = ({ fileName, reason }) => (reason === 'incorrect'
  ? `La contraseña no es correcta. Escríbela de nuevo para abrir «${fileName}».`
  : `«${fileName}» tiene contraseña. Escríbela para que Minoscreto lo abra en este computador. No se guarda ni se envía a Claude.`);

/** Ventana de Windows → la contraseña, o null si la persona cancela, cierra la ventana o no responde en 5 minutos. */
export function askPasswordWindow(request) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', ENCODED], {
      env: { ...process.env, MINOSCRETO_MSG: passwordMessage(request) },
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    });
    let out = '';
    const timer = setTimeout(() => child.kill(), WAIT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => { clearTimeout(timer); reject(new Error('window')); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (out.startsWith('ok:')) { resolve(Buffer.from(out.slice(3).trim(), 'base64').toString('utf8')); return; }
      if (code === 0 || code === null) { resolve(null); return; }
      reject(new Error('window'));
    });
  });
}
