/** Quem está executando a operação e de onde (RN-01, requisitos de autoria). */
export interface Contexto {
  usuarioId: string;
  permissoes: Set<string>;
  dispositivoId?: string | null;
  origem: 'online' | 'offline' | 'sistema';
  /** Data/hora real da operação (para operações vindas do modo offline). */
  dataHora?: Date;
}

export const pode = (ctx: Contexto, p: string) => ctx.permissoes.has(p);
