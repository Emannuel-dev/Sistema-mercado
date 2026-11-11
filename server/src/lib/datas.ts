// Datas no fuso do servidor (configure TZ=America/Sao_Paulo).

const pad = (n: number) => String(n).padStart(2, '0');

export const hojeISO = (agora = new Date()) =>
  `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}`;

export function somarDias(dataISO: string, dias: number): string {
  const [a, m, d] = dataISO.split('-').map(Number);
  const dt = new Date(a, m - 1, d + dias);
  return hojeISO(dt);
}

/**
 * Competência (AAAA-MM) do ciclo vigente de um cartão em uma data.
 * Se o dia de hoje já alcançou o dia de virada, o ciclo é o do mês corrente;
 * caso contrário, ainda vale o ciclo iniciado no mês anterior.
 */
export function competenciaVigente(agora: Date, diaVirada: number): string {
  let ano = agora.getFullYear();
  let mes = agora.getMonth() + 1;
  if (agora.getDate() < diaVirada) {
    mes -= 1;
    if (mes === 0) { mes = 12; ano -= 1; }
  }
  return `${ano}-${pad(mes)}`;
}

export function diasEntre(deISO: string, ateISO: string): number {
  const [a1, m1, d1] = deISO.split('-').map(Number);
  const [a2, m2, d2] = ateISO.split('-').map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}
