// Tipos da tela Estudos (os mesmos do desktop, frontend/src/types.ts) e o contrato entre a casca (Estudos.tsx)
// e as abas (EstudosProva, EstudosDuvidas, EstudosRevisao, EstudosDesempenho).

export type Stats = {
  fontes: number; uteis: number; segundos: number; rodadas: number; tokens: number; tokens_entrada: number; gerando: number;
  chamadas: number; estimado: boolean; extrator: string; escritor: string; extrator_provider: string; escritor_provider: string;
};
export type Fonte = { id: string; rodada: number; titulo: string; status: "fila" | "lendo" | "util" | "vazia" | "erro"; url: string; dominio: string; erro: string; resumo: string; trecho: string };

export type EstudosPreferencias = {
  nivel: "iniciante" | "intermediario" | "avancado";
  objetivo: "vestibular" | "concurso" | "faculdade" | "entender";
  tom: "direto" | "didatico" | "formal";
  tamanho: "curto" | "medio" | "completo";
  extras: ("exemplos" | "mnemonicos" | "pegadinhas" | "quadro")[];
  observacoes: string;
};

export type EstudosMaterial = { id: number; n: number; nome: string; arquivo: string; chars: number; paginas: number; ocr: boolean; uso: "conteudo" | "prova";
  figuras?: number | null; gabarito?: boolean };   // recortadas do PDF (material de OCR não tem)
/** Figura do PDF que uma questão usa (o recorte sai de /api/estudos-figura/<conv>/<material>/<id>). */
export type EstudosFigura = { material: number; id: string; pagina: number; w?: number; h?: number; descricao?: string };
export type EstudosTopico = { titulo: string; objetivo: string; pontos: string[]; status: "fila" | "escrevendo" | "pronto" | "erro" };
export type Status = "rodando" | "aguardando" | "pronto" | "erro" | "cancelado";

export type EstudosEstado = {
  message_id: number;
  tipo: "resumo";
  tema: string;
  preferencias: EstudosPreferencias;
  web: boolean;
  profundidade: "rapida" | "normal" | "funda";
  motor: "forja" | "claude";
  status: Status;
  etapa: "material" | "web" | "plano" | "escrita" | "pronto";
  aviso: string;
  titulo: string;
  perfil: { banca?: string; formato?: string; estilo?: string; topicos?: string[]; questoes?: number };
  materiais: { id: number; nome: string; uso: string; pedacos: number; feitos: number }[];
  rodada: number;
  fontes: Fonte[];
  topicos: EstudosTopico[];
  texto: string;
  stats: Stats;
};

export type EstudosTipoQuestao = "me" | "vf" | "disc";
export type EstudosQuestao = {
  id: string; tipo: EstudosTipoQuestao; enunciado: string; pontos: number; topico: string; dificuldade: "facil" | "media" | "dificil";
  alternativas?: string[];
  // só depois da primeira entrega (a prova sai sem gabarito até lá)
  correta?: number | boolean; explicacao?: string; por_alternativa?: string[]; resposta_modelo?: string;
  rubrica?: { criterio: string; pontos: number }[]; pagina?: string; verificada?: boolean; figura?: EstudosFigura;
};
export type EstudosProvaConfig = {
  me: number; vf: number; disc: number; dificuldade: "facil" | "media" | "dificil" | "mista"; topicos: string[];
  estilo: boolean; tempo: number; instrucoes: string; alternativas: number; figuras?: number;
};
export type EstudosPlanejada = { id: string; tipo: EstudosTipoQuestao; topico: string; dificuldade: string; motivo: string; status: "fila" | "gerando" | "verificando" | "ok" | "descartada"; figura?: EstudosFigura };
export type EstudosProva = {
  message_id: number; tipo: "prova"; titulo: string; config: EstudosProvaConfig; motor: "forja" | "claude"; status: Status; etapa: string;
  aviso: string; planejadas: EstudosPlanejada[]; questoes: EstudosQuestao[]; revelada: boolean; stats: Stats;
  figuras_olhadas?: string;   // "12 de 80", na etapa "figuras"
};
export type EstudosCorrecao = {
  resposta: number | boolean | string | null; certa: boolean | null; pontos: number; max: number; feedback: string; pendente?: boolean;
  criterios?: { criterio: string; pontos: number; max: number }[];
};
export type EstudosTentativa = {
  message_id: number; tipo: "tentativa"; prova_id: number; titulo: string; segundos: number; modo?: "prova" | "treino";
  correcao: Record<string, EstudosCorrecao>; motor: "forja" | "claude"; status: Status; etapa: string; aviso: string;
  pontos: number; max: number; nota: number; acertos: number; por_topico: { topico: string; pontos: number; max: number }[];
  questoes: EstudosQuestao[]; stats: Stats;
};
export type EstudosProvaResumo = {
  message_id: number; titulo: string; status: string; n: number; config: EstudosProvaConfig; motor: "forja" | "claude"; criado: string;
  tentativas: { message_id: number; status: string; nota: number; pontos: number; max: number; acertos: number; segundos: number; criado: string; modo?: "prova" | "treino" }[];
};

export type EstudosLeitner = { caixa: number; proxima: string; acertos: number; erros: number; dominada: boolean; vence: boolean };
export type EstudosItemRevisao = EstudosLeitner & { chave: string; topico: string } & (
  | { tipo: "erro"; questao: EstudosQuestao; resposta: number | boolean | string | null; prova: string; tentativa_id: number }
  | { tipo: "cartao"; id: string; frente: string; verso: string; origem: "resumo" | "erro" });
export type EstudosTarefa = { id: string; tipo: "estudar" | "revisar" | "simulado"; texto: string; topico: string; minutos: number; feito: boolean };
export type EstudosPlano = { data: string; minutos: number; criado: string; dias: { dia: string; tarefas: EstudosTarefa[] }[] };
export type EstudosPainel = {
  hoje: string; itens: EstudosItemRevisao[]; vencem: number; plano: EstudosPlano | null;
  geracoes: { message_id: number; status: string; n: number; motor: "forja" | "claude"; aviso: string; criado: string }[];
};
export type EstudosFlashcards = {
  message_id: number; tipo: "flashcards"; quantos: number; motor: "forja" | "claude"; status: Status; aviso: string;
  partes: { id: string; topicos: string[]; n: number; status: "fila" | "gerando" | "ok" | "erro" }[];
  cartoes: { id: string; frente: string; verso: string; topico: string }[]; stats: Stats;
};
export type EstudosDesempenho = {
  entregas: { message_id: number; prova_id: number; titulo: string; nota: number; acertos: number; n: number; modo: "prova" | "treino"; segundos: number; criado: string }[];
  topicos: { topico: string; pontos: number; max: number; pct: number | null; ultima: number | null }[];
  fracos: string[]; lembrete: boolean;
  revisao: { erros: number; cartoes: number; vencem: number; dominados: number };
  plano: EstudosPlano | null;
};
export type EstudosDuvidaMsg = {
  id: number; role: "user" | "assistant"; texto: string; status: Status; trecho: string; motor: string; aviso: string; modelo: string; criado: string;
};

export type EstudosProjeto = {
  id: number; titulo: string; materiais: EstudosMaterial[];
  resumos: { message_id: number; titulo: string; status: string; criado: string }[];
  resumo: EstudosEstado | null; rodando: number | null; provas: EstudosProvaResumo[]; topicos: string[];
  duvidas: Record<string, number>; revisao: EstudosPainel;
  figuras?: { detectadas: number; uteis: number; olhadas: number };
  simulados?: EstudosSimuladoResumo[]; ranking?: EstudosRanking | null; busca?: EstudosBusca | null;
};

/** Simulados reais (o mesmo do PC, types.ts): a IA conferida com o gabarito oficial, o ranking e a busca na web. */
export type EstudosQuestaoReal = {
  numero: number; pagina: number; area: string; assunto: string; oficial: string; ia: string; certa: boolean | null;
  conta: string; motivo: string; inicio: string; figura: "" | "vista" | "faltou";
};
type Parte = { resolvidas: number; acertos: number };
export type EstudosPlacarSimulado = {
  questoes: number; com_gabarito: number; resolvidas: number; acertos: number; em_branco: number;
  so_texto: Parte; figura_vista: Parte; figura_faltou: Parte; por_area: { area: string; total: number; acertos: number }[];
};
export type EstudosRanking = { itens: { assunto: string; area: string; questoes: number; simulados: number; fracao: number }[]; simulados: number; questoes: number };
export type EstudosSimuladoResumo = {
  message_id: number; material_id: number; material: string; status: string; etapa: string; placar: Partial<EstudosPlacarSimulado>;
  gabarito: string; prova_id: number | null; criado: string;
};
export type EstudosSimulado = EstudosSimuladoResumo & {
  tipo: "simulado"; titulo: string; aviso: string; progresso: string; questoes: EstudosQuestaoReal[]; ranking: EstudosRanking | null; stats: Stats;
};
export type EstudosCandidato = {
  url: string; titulo: string; trecho: string; tipo: "prova" | "gabarito"; exame: string; status: "fila" | "baixando" | "anexado" | "rejeitado";
  motivo: string; material_id?: number;
};
export type EstudosBusca = {
  message_id: number; tipo: "busca"; titulo: string; pedido: string; status: Status; etapa: string; aviso: string; progresso: string;
  buscas: { busca: string; achados: number }[]; candidatos: EstudosCandidato[]; anexados: { material_id: number; nome: string; tipo: string; url: string }[];
  stats: Stats;
};

/** O retrato de uma execução viva (o que o SSE de /estudos/execucao/{id}/stream manda a cada 0,3 s). */
export type Exec = EstudosEstado | EstudosProva | EstudosTentativa | EstudosFlashcards | EstudosSimulado | EstudosBusca;

export type Aba = "resumo" | "provas" | "simulados" | "duvidas" | "revisao" | "desempenho";
/** O que vai no corpo de quem pede trabalho ao backend: escritor e, opcional, o modelo de leitura/conferência. */
export type Modelo = { provider: string; model: string; ex_provider: string; ex_model: string };
/** Pergunta que chega de fora na aba Dúvidas (o "explicar de outro jeito" de um trecho do resumo). */
export type Pendente = { pergunta: string; trecho: string };
/** Prova pedida de fora da aba Provas (a "prova dos pontos fracos" do Desempenho). */
export type ProvaPendente = { topicos: string[]; instrucoes: string };

/** O que a casca (Estudos.tsx) dá a cada aba. */
export type Casca = {
  conv: number | null;                               // id da conversa; null = ainda não criada
  garante: () => Promise<number>;                    // cria a conversa (kind estudos) se ainda não existe
  p: EstudosProjeto | null;                          // GET /estudos/{conv}
  exec: Exec | null;                                 // execução viva (resumo, prova, correção ou cartões), seja do PC ou daqui
  /** POST que responde em SSE (estudar, prova, entregar, flashcards) ou GET .../stream: a casca acompanha
   *  em `exec` e devolve o último retrato quando acaba (null se falhou). Recarrega o projeto no fim. */
  segue: (path: string, body?: unknown) => Promise<any>;
  recarrega: () => Promise<void>;
  modelo: Modelo | null;                             // null = nenhum modelo escolhido (a aba avisa)
  carimbo: string | undefined;                       // muda quando o PC (ou o Claude) mexe no estudo
  erro: (mensagem: string) => void;
  setAba: (a: Aba) => void;
  setImersao: (v: boolean) => void;                  // true = esconder a fila de abas (fazendo prova, revisando)
};

export const nota = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");
export const relogio = (seg: number) => `${Math.floor(seg / 60)}:${String(Math.floor(seg % 60)).padStart(2, "0")}`;
/** "1.234 tokens · 38 tok/s · 3:12", como no desktop. */
export function numeros(e: { stats?: Stats | null }): string {
  const s = e.stats;
  if (!s) return "";
  const tps = s.gerando > 0.5 ? Math.round(s.tokens / s.gerando) : 0;
  return [s.tokens ? `${String(s.tokens).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} tokens${s.estimado ? " (estim.)" : ""}` : "",
          tps ? `${tps} tok/s` : "", s.segundos ? relogio(s.segundos) : ""].filter(Boolean).join(" · ");
}
export const quando = (iso: string) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "");
export const LETRAS = "ABCDE";
export const TIPO_CURTO = { me: "múltipla escolha", vf: "verdadeiro ou falso", disc: "discursiva" } as const;
export const DIFICULDADE: Record<string, string> = { facil: "fácil", media: "média", dificil: "difícil", mista: "misturada" };
/** O texto do pedido ao Claude via MCP (igual ao desktop). */
export const PEDIDO_CLAUDE = "Atenda os pedidos da tela Estudos do Forja.";
