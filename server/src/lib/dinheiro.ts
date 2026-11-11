// Valores monetários trafegam como número em reais (ex.: 12.5) na API e como
// NUMERIC no banco. Aqui convertemos para centavos inteiros para fazer contas
// sem erro de ponto flutuante.

export const paraCentavos = (v: string | number): number => Math.round(Number(v) * 100);
export const paraReais = (c: number): string => (c / 100).toFixed(2);
export const num = (v: string | number | null | undefined): number => Number(v ?? 0);
