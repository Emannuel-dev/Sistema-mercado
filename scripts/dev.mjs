// Sobe a API e a tela juntas, em qualquer sistema (Windows, Linux, macOS), sem dependências.
// Uso: npm run dev   (Ctrl+C encerra as duas)
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const filhos = [
  ['api ', ['run', 'dev', '-w', 'server']],
  ['tela', ['run', 'dev', '-w', 'web']],
].map(([nome, args]) => {
  const p = spawn(npm, args, { stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const prefixar = (dados) => String(dados).split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${nome}] ${l}`));
  p.stdout.on('data', prefixar);
  p.stderr.on('data', prefixar);
  p.on('exit', (code) => { console.log(`[${nome}] encerrou (código ${code})`); encerrar(code ?? 0); });
  return p;
});

let saindo = false;
function encerrar(code) {
  if (saindo) return;
  saindo = true;
  for (const f of filhos) if (f.exitCode === null) f.kill();
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => encerrar(0));
process.on('SIGTERM', () => encerrar(0));
