/** Erro de regra de negócio, com código estável para o front-end e para a sincronização. */
export class ErroNegocio extends Error {
  constructor(public codigo: string, mensagem: string, public status = 422, public detalhes?: unknown) {
    super(mensagem);
  }
}

export const naoEncontrado = (o: string) => new ErroNegocio('NAO_ENCONTRADO', `${o} não encontrado(a)`, 404);
export const semPermissao = () => new ErroNegocio('SEM_PERMISSAO', 'Você não tem permissão para esta operação', 403);
