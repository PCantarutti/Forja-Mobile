import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Modal, PanResponder, Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, base, comToken } from "./api";
import { Abaixo, ArrowLeft, ArrowRight, Balao, Check, Code, Folder, More, Play, Plus, Raio, Refresh, Search, Sliders, Split, Terminal,
         Trocar, Undo, X } from "./icones";
import { useTeclado } from "./teclado";
import { Text, TextInput } from "./Texto";
import { c, mono, s } from "./tema";
import { Botao, BotaoIcone, Folha, Lista, Opcao, Pulsa, Quadrado, toast } from "./ui";

/** Board do projeto (BoardView.tsx do desktop): colunas em carrossel, triagem de Novo por gesto, detalhe em tela
 * cheia e as ações do desktop (varrer, varrer com IA, pedir à IA, pastas ligadas, executar backlog sozinho). */

type Evidencia = { arquivo?: string; linha?: number; trecho?: string; comando?: string; saida?: string; imagem?: string; conv?: number; rotulo?: string };
type Issue = {
  id: number; projeto: string; titulo: string; descricao: string; tipo: string; area: string; severidade: number; status: string;
  evidencias: Evidencia[]; prompt: string; verify_sugerido: string; origem: string; motivo_rejeicao: string | null; sumiu: boolean;
  conversa_id: number | null; commit: string | null; modo_sugerido: "agent" | "maestro"; historico: { quando: string; texto: string }[];
};
type Varredura = { rodando: boolean; etapa?: string; criados: number; encontrados: number; avisos: string[] } | null;
type VarreduraIA = { rodando: boolean; etapa?: string; total?: number; lidos?: number; criados?: number; descartados?: number; mais: number;
  parou?: string; avisos: string[] } | null;
type Auto = { ligado: boolean; travas: string[]; parado: string; feitos: number; por_dia: number; em_curso: number | null };
type Vinc = { projeto: string; vinculadas: string[]; sugestoes: string[] };

const COLUNAS = [
  { id: "novo", nome: "Novo", cor: c.amber, vazio: "A varredura e a IA põem os achados aqui para você triar." },
  { id: "backlog", nome: "Backlog", cor: c.muted, vazio: "Aceite um card de Novo, ou crie um." },
  { id: "andamento", nome: "Em andamento", cor: c.info, vazio: "Inicie um card do Backlog." },
  { id: "revisao", nome: "Revisão", cor: c.agent, vazio: "Cards cuja conversa terminou esperam você aqui." },
  { id: "concluido", nome: "Concluído", cor: c.ok, vazio: "Aprovados na revisão." },
];
const REJEITADO = { id: "rejeitado", nome: "Rejeitado", cor: c.err, vazio: "Nada rejeitado." };
const TODAS = [...COLUNAS, REJEITADO];
const TIPOS = ["bugfix", "feature", "improvement", "visual", "todo", "seguranca"];
const AREAS = ["frontend", "backend", "fullstack", "testes", "infra"];
const COR_TIPO: Record<string, string> = { bugfix: c.err, feature: c.info, improvement: c.ok, visual: c.agent, todo: c.amber, seguranca: "#fb923c" };
const NOME_TIPO: Record<string, string> = { bugfix: "Bug", feature: "Feature", improvement: "Melhoria", visual: "Visual", todo: "TODO", seguranca: "Segurança" };
const NOME_SEV: Record<number, string> = { 1: "Alta", 2: "Média", 3: "Baixa" };
const COR_SEV: Record<number, string> = { 1: c.err, 2: c.amber, 3: c.muted };
const NOME_ORIGEM: Record<string, string> = { manual: "manual", "varredura-deterministica": "varredura", "varredura-ia": "IA", visual: "visual" };
const MOTIVOS = [{ id: "nao_e_bug", nome: "Não é bug" }, { id: "nao_quero", nome: "Não quero" }, { id: "duplicado", nome: "Duplicado" }];
const FOCOS = [{ id: "tudo", nome: "Tudo" }, { id: "bugs", nome: "Bugs" }, { id: "melhorias", nome: "Melhorias" },
  { id: "features", nome: "Ideias de feature" }, { id: "visual", nome: "Visual" }];
const LARG = 326; // largura da coluna no carrossel
const nomePasta = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const ondeDe = (e?: Evidencia | null) => (e?.arquivo ? `${e.arquivo}${e.linha ? `:${e.linha}` : ""}` : "");
const evidenciaDe = (i: { evidencias?: Evidencia[] }) => (i.evidencias ?? []).find((e) => e.arquivo);
/** Resultado do verify que o Forja roda quando a conversa termina: está no histórico. */
const verifyDe = (i: Issue) => {
  const h = [...(i.historico ?? [])].reverse().find((x) => x.texto.startsWith("verify "));
  return !h ? null : h.texto.startsWith("verify passou") ? "ok" : "falhou";
};
const fotoDe = (e: Evidencia) => comToken(`${base()}/api/files?path=${encodeURIComponent(e.imagem!)}&conv=${e.conv ?? 0}`);

/** Prioridade em 3 barras crescentes (5/8/11 px): alta = as três acesas. */
export function Prioridade({ sev }: { sev: number }) {
  const acesas = 4 - sev;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2 }}>
      {[0, 1, 2].map((n) => <View key={n} style={{ width: 3, height: 5 + n * 3, borderRadius: 1, backgroundColor: n < acesas ? COR_SEV[sev] ?? c.muted : c.lineStrong }} />)}
    </View>
  );
}
const Ponto = ({ cor, lado = 6 }: { cor: string; lado?: number }) => <View style={{ width: lado, height: lado, borderRadius: lado / 2, backgroundColor: cor }} />;
function Tipo({ tipo }: { tipo: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <Ponto cor={COR_TIPO[tipo] ?? c.muted} />
      <Text style={{ color: COR_TIPO[tipo] ?? c.muted, fontSize: 11.5, fontWeight: "600" }}>{NOME_TIPO[tipo] ?? tipo}</Text>
    </View>
  );
}
const SeloB = ({ t, cor = c.faint, fundo = c.raised, emMono }: { t: string; cor?: string; fundo?: string; emMono?: boolean }) => (
  <Text style={{ color: cor, backgroundColor: fundo, fontSize: 11, fontFamily: emMono ? mono : undefined, borderRadius: 5, paddingHorizontal: 6,
                 paddingVertical: 2, overflow: "hidden" }}>{t}</Text>
);

/** Card que a IA criou (board_card) no fim da resposta dela, como no desktop (CardNoChat). Tocar abre o board nele. */
export type CardMini = { id: number; titulo: string; tipo: string; area: string; severidade: number; status: string;
  projeto: string; evidencia?: Evidencia | null };
const NOME_STATUS: Record<string, string> = Object.fromEntries(TODAS.map((k) => [k.id, k.nome]));

export function CardNoChat({ card, onAbre }: { card: CardMini; onAbre?: (c: CardMini) => void }) {
  const [k, setK] = useState(card);
  const [erro, setErro] = useState("");
  // O status muda depois (Iniciar, Revisão): o do meta é o do momento em que a IA criou.
  useEffect(() => { api.get<CardMini & { evidencias?: Evidencia[] }>(`/board/issues/${card.id}`)
    .then((x) => setK({ ...card, ...x, evidencia: card.evidencia ?? evidenciaDe(x) })).catch(() => {}); }, [card.id]);
  const iniciar = async () => {
    setErro("");
    try {
      if (k.status === "novo") await api.patch(`/board/issues/${k.id}`, { status: "backlog" });
      setK({ ...k, ...(await api.post<CardMini>(`/board/issues/${k.id}/iniciar`, {})) });
    } catch (e: any) { setErro(e.message); }
  };
  const ev = k.evidencia;
  return (
    <View style={{ gap: 4 }}>
      <Pressable onPress={() => onAbre?.(k)} style={{ backgroundColor: c.surface, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12, gap: 7,
                                                        borderWidth: 1, borderColor: c.line }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Tipo tipo={k.tipo} />
          <Text style={{ color: c.faint, fontSize: 11.5 }}>{k.area}</Text>
          <View style={{ flex: 1 }} />
          <Prioridade sev={k.severidade} />
          <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>#{k.id} · {NOME_STATUS[k.status] ?? k.status}</Text>
        </View>
        <Text style={{ color: c.fg, fontSize: 14.5, lineHeight: 20 }} numberOfLines={2}>{k.titulo}</Text>
        {!!ev?.arquivo && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Code size={12} color={c.muted} />
            <Text style={{ fontFamily: mono, fontSize: 11.5, color: c.muted, flex: 1 }} numberOfLines={1}>{ondeDe(ev)}</Text>
          </View>
        )}
        {["novo", "backlog"].includes(k.status) && (
          <Botao primario altura={32} rotulo="Iniciar" icone={<Play size={12} color={c.accentFg} />} onPress={iniciar} estilo={{ alignSelf: "flex-start" }} />
        )}
      </Pressable>
      {!!erro && <Text style={[s.muted, { color: c.err }]}>{erro}</Text>}
    </View>
  );
}

type Filtros = { tipo: string | null; sev: number | null; area: string | null; rejeitados: boolean };

export default function Board({ onAbreConversa, foco }: { onAbreConversa: (id: number, kind: string) => void;
  foco?: { id: number; projeto: string } | null }) {
  const [projetos, setProjetos] = useState<{ projeto: string; nome: string }[]>([]);
  const [projeto, setProjeto] = useState<string | null>(foco?.projeto ?? null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [varredura, setVarredura] = useState<Varredura>(null);
  const [ia, setIa] = useState<VarreduraIA>(null);
  const [iaCria, setIaCria] = useState(true);
  const [nVinc, setNVinc] = useState(0);
  const [auto, setAuto] = useState<Auto | null>(null);
  const [vinc, setVinc] = useState<Vinc | null>(null);
  const [pedido, setPedido] = useState<number | null>(null); // conversa da IA procurando
  const [vistos, setVistos] = useState({ varredura: false, ia: false });
  const [erro, setErro] = useState("");
  const [detalhe, setDetalhe] = useState<number | "novo" | null>(foco?.id ?? null);
  const [folha, setFolha] = useState<null | "projeto" | "acoes" | "filtros">(null);
  const [mover, setMover] = useState<Issue | null>(null);
  const [triagem, setTriagem] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtros, setFiltros] = useState<Filtros>({ tipo: null, sev: null, area: null, rejeitados: false });
  const [carimbo, setCarimbo] = useState("");
  const [pag, setPag] = useState(0);

  useEffect(() => {
    api.get<{ projeto: string; nome: string }[]>("/board/projetos")
      .then((l) => { setProjetos(l); setProjeto((p) => p ?? l[0]?.projeto ?? null); })
      .catch((e) => setErro(e.message));
  }, []);

  const carrega = () => {
    if (!projeto) return Promise.resolve();
    const q = encodeURIComponent(projeto);
    api.get<Auto>(`/board/auto?pasta=${q}`).then(setAuto).catch(() => {});
    return api.get<{ issues: Issue[]; varredura: Varredura; varredura_ia: VarreduraIA; board_card: boolean; vinculadas: number }>(`/board?pasta=${q}`)
      .then((r) => { setIssues(r.issues); setVarredura(r.varredura); setIa(r.varredura_ia); setIaCria(r.board_card); setNVinc(r.vinculadas); })
      .catch((e) => setErro(e.message));
  };
  const carregaVinc = () => projeto && api.get<Vinc>(`/board/vinculos?pasta=${encodeURIComponent(projeto)}`).then(setVinc).catch(() => {});
  useEffect(() => { carrega(); }, [projeto, carimbo]);
  useEffect(() => { if (folha === "acoes") carregaVinc(); }, [folha, projeto]);
  // Ao vivo com o PC: o carimbo do board no /activity muda quando um card muda em qualquer aparelho.
  const rodando = !!varredura?.rodando || !!ia?.rodando || pedido != null || !!auto?.em_curso;
  useEffect(() => {
    const t = setInterval(() => {
      api.get<{ board?: string }>("/activity").then((a) => a.board && setCarimbo(a.board)).catch(() => {});
      if (varredura?.rodando || ia?.rodando) carrega(); // o andamento da varredura não mexe no carimbo
    }, rodando ? 2000 : 4000);
    return () => clearInterval(t);
  }, [rodando, projeto, varredura?.rodando, ia?.rodando]);

  const acao = (fn: () => Promise<unknown>) => {
    setErro("");
    return fn().catch((e) => setErro(e.message)).finally(carrega);
  };
  /** Muda o status com o toast de Desfazer (volta o anterior pelo PATCH). */
  const moveComDesfazer = (i: Issue, fn: () => Promise<unknown>, texto: string) =>
    acao(fn).then(() => toast(texto, () => acao(() => api.patch(`/board/issues/${i.id}`, { status: i.status }))));
  const aceitar = (i: Issue) => moveComDesfazer(i, () => api.patch(`/board/issues/${i.id}`, { status: "backlog" }), `#${i.id} foi para o Backlog.`);
  const rejeitar = (i: Issue, motivo: string | null) =>
    moveComDesfazer(i, () => api.post(`/board/issues/${i.id}/rejeitar`, { motivo }), `#${i.id} rejeitado.`);
  const aprovar = (i: Issue) => moveComDesfazer(i, () => api.patch(`/board/issues/${i.id}`, { status: "concluido" }), `#${i.id} concluído.`);
  const moverPara = (i: Issue, status: string) => {
    if (status === i.status) return;
    if (status === "andamento") return moveComDesfazer(i, () => api.post(`/board/issues/${i.id}/iniciar`, {}), `#${i.id} iniciado.`);
    moveComDesfazer(i, () => api.patch(`/board/issues/${i.id}`, { status }), `#${i.id} em ${NOME_STATUS[status]}.`);
  };

  const q = busca.trim().toLowerCase();
  const passa = (i: Issue) => (!filtros.tipo || i.tipo === filtros.tipo) && (!filtros.sev || i.severidade === filtros.sev)
    && (!filtros.area || i.area === filtros.area)
    && (!q || i.titulo.toLowerCase().includes(q) || !!i.descricao?.toLowerCase().includes(q) || i.evidencias.some((e) => e.arquivo?.toLowerCase().includes(q)));
  const visiveis = issues.filter(passa);
  const colunas = filtros.rejeitados ? TODAS : COLUNAS;
  const nFiltros = [filtros.tipo, filtros.sev, filtros.area, filtros.rejeitados || null].filter(Boolean).length;
  const novos = visiveis.filter((i) => i.status === "novo");
  const atual = typeof detalhe === "number" ? issues.find((i) => i.id === detalhe) ?? null : null;
  const nomeProjeto = projetos.find((p) => p.projeto === projeto)?.nome ?? (projeto ? nomePasta(projeto) : "Projeto");

  const pilula = { height: 28, borderRadius: 999, paddingHorizontal: 10, flexDirection: "row" as const, alignItems: "center" as const, gap: 5,
                   backgroundColor: c.accentSoft };
  const tiraFiltro = (rot: string, fn: () => void) => (
    <Pressable key={rot} style={pilula} onPress={fn}><Text style={{ color: c.accentText, fontSize: 12.5 }}>{rot}</Text><X size={12} color={c.accentText} /></Pressable>
  );
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 12, gap: 8, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable onPress={() => setFolha("projeto")} style={{ flex: 1, height: 36, borderRadius: 999, backgroundColor: c.raised, flexDirection: "row",
                                                                   alignItems: "center", gap: 7, paddingHorizontal: 12 }}>
            <Folder size={14} color={c.muted} />
            <Text style={{ color: c.fg, fontSize: 13.5, fontWeight: "600", flexShrink: 1 }} numberOfLines={1}>{nomeProjeto}</Text>
            {nVinc > 0 && <Text style={{ color: c.muted, fontFamily: mono, fontSize: 11.5 }}>+{nVinc}</Text>}
            <View style={{ flex: 1 }} />
            <Abaixo size={13} color={c.muted} />
          </Pressable>
          <BotaoIcone onPress={() => setFolha("acoes")}><Raio size={16} color={rodando ? c.accentText : c.fg} /></BotaoIcone>
          <BotaoIcone fundo={c.accent} onPress={() => setDetalhe("novo")} desabilitado={!projeto}><Plus size={17} color={c.accentFg} /></BotaoIcone>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1, height: 36, borderRadius: 999, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, flexDirection: "row",
                         alignItems: "center", gap: 7, paddingHorizontal: 12 }}>
            <Search size={14} color={c.faint} />
            <TextInput style={{ flex: 1, color: c.fg, fontSize: 13.5, padding: 0 }} value={busca} onChangeText={setBusca}
                       placeholder="Buscar título ou arquivo" placeholderTextColor={c.faint} />
            {!!busca && <Pressable hitSlop={8} onPress={() => setBusca("")}><X size={13} color={c.faint} /></Pressable>}
          </View>
          <Pressable onPress={() => setFolha("filtros")}
                     style={{ height: 36, borderRadius: 999, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1,
                              borderColor: nFiltros ? c.accentLine : c.line, backgroundColor: nFiltros ? c.accentSoft : "transparent" }}>
            <Sliders size={14} color={nFiltros ? c.accentText : c.muted} />
            <Text style={{ color: nFiltros ? c.accentText : c.muted, fontSize: 13 }}>{nFiltros ? `Filtros · ${nFiltros}` : "Filtros"}</Text>
          </Pressable>
        </View>
        {nFiltros > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {filtros.tipo && tiraFiltro(NOME_TIPO[filtros.tipo], () => setFiltros({ ...filtros, tipo: null }))}
            {filtros.sev && tiraFiltro(NOME_SEV[filtros.sev], () => setFiltros({ ...filtros, sev: null }))}
            {filtros.area && tiraFiltro(filtros.area, () => setFiltros({ ...filtros, area: null }))}
            {filtros.rejeitados && tiraFiltro("Rejeitados", () => setFiltros({ ...filtros, rejeitados: false }))}
            <Pressable hitSlop={8} onPress={() => setFiltros({ tipo: null, sev: null, area: null, rejeitados: false })}>
              <Text style={{ color: c.muted, fontSize: 12.5, textDecorationLine: "underline" }}>limpar</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Avisos varredura={varredura} ia={ia} pedido={pedido} auto={auto} erro={erro} vistos={vistos}
              onVisto={(k) => setVistos({ ...vistos, [k]: true })} onErro={() => setErro("")} onPedidoFim={() => setPedido(null)}
              onVerPedido={() => pedido && onAbreConversa(pedido, "agent")}
              onMais={() => acao(() => api.post("/board/mais", { pasta: projeto }))}
              onForcar={() => acao(() => api.post("/board/varrer-ia", { pasta: projeto, forcar: true }))}
              onParar={() => acao(() => api.post("/board/auto", { pasta: projeto, ligado: false }))}
              onSeguir={() => acao(() => api.post("/board/auto", { pasta: projeto, ligado: true }))} />

      {!projeto ? (
        <Text style={[s.muted, { padding: 16, lineHeight: 20 }]}>Nenhum projeto ainda: abra uma conversa de Agente ou Maestro numa pasta.</Text>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={LARG + 10} decelerationRate="fast"
                      contentContainerStyle={{ paddingHorizontal: 12, gap: 10 }} style={{ flex: 1 }}
                      onMomentumScrollEnd={(e) => setPag(Math.round(e.nativeEvent.contentOffset.x / (LARG + 10)))}>
            {colunas.map((col) => {
              const itens = visiveis.filter((i) => i.status === col.id);
              return (
                <View key={col.id} style={{ width: LARG, backgroundColor: c.side, borderColor: c.line, borderWidth: 1, borderRadius: 14, overflow: "hidden" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10 }}>
                    <Ponto cor={col.cor} lado={8} />
                    <Text style={{ color: c.fg, fontSize: 14, fontWeight: "600" }}>{col.nome}</Text>
                    {col.id === "novo" && itens.length > 0 && <Text style={{ color: c.amber, fontSize: 11.5 }}>para triar</Text>}
                    <View style={{ flex: 1 }} />
                    <Text style={{ color: c.muted, fontFamily: mono, fontSize: 11.5, backgroundColor: c.raised, borderRadius: 999, paddingHorizontal: 8,
                                   paddingVertical: 1, overflow: "hidden" }}>{itens.length}</Text>
                  </View>
                  <ScrollView nestedScrollEnabled contentContainerStyle={{ padding: 10, paddingTop: 0, gap: 8 }}
                              refreshControl={<RefreshControl refreshing={false} onRefresh={carrega} tintColor={c.muted} colors={[c.accent]} progressBackgroundColor={c.raised} />}>
                    {col.id === "novo" && itens.length >= 2 && (
                      <Pressable onPress={() => setTriagem(true)} style={{ height: 44, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: c.amber,
                                                                         flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }}>
                        <Trocar size={15} color={c.amber} />
                        <Text style={{ color: c.amber, fontSize: 13.5 }}>Triar {itens.length} cards deslizando</Text>
                      </Pressable>
                    )}
                    {itens.map((i) => (
                      <CardBoard key={i.id} i={i} onAbre={() => setDetalhe(i.id)} onMais={() => setMover(i)}
                                 onAceitar={() => aceitar(i)} onRejeitar={() => rejeitar(i, null)} onIniciar={() => setDetalhe(i.id)} onAprovar={() => aprovar(i)} />
                    ))}
                    {!itens.length && (
                      <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: c.line, borderRadius: 12, padding: 16 }}>
                        <Text style={{ color: c.faint, fontSize: 12.5, textAlign: "center", lineHeight: 18 }}>
                          {nFiltros || q ? "Nada com esses filtros." : col.vazio}
                        </Text>
                      </View>
                    )}
                  </ScrollView>
                </View>
              );
            })}
          </ScrollView>
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 6, paddingVertical: 10 }}>
            {colunas.map((col, k) => <View key={col.id} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: col.cor, opacity: k === pag ? 1 : 0.35 }} />)}
          </View>
        </>
      )}

      <Folha aberta={folha === "projeto"} titulo="Projeto" onFecha={() => setFolha(null)}>
        <Lista opcoes={projetos.map((p) => ({ id: p.projeto, rotulo: p.nome, dica: p.projeto }))} valor={projeto ?? ""}
               onEscolhe={(p) => { setProjeto(p); setFolha(null); }} />
      </Folha>

      <FolhaFiltros aberta={folha === "filtros"} f={filtros} onMuda={setFiltros} onFecha={() => setFolha(null)}
                    total={issues.filter((i) => (!filtros.tipo || i.tipo === filtros.tipo) && (!filtros.sev || i.severidade === filtros.sev)
                      && (!filtros.area || i.area === filtros.area) && (filtros.rejeitados || i.status !== "rejeitado")).length} />

      {projeto && (
        <FolhaAcoes aberta={folha === "acoes"} onFecha={() => setFolha(null)} pasta={projeto} varredura={varredura} ia={ia} pedido={pedido}
                    iaCria={iaCria} auto={auto} vinc={vinc} acao={acao} onVinc={setVinc}
                    onIaCria={(v) => { setIaCria(v); acao(() => api.post("/board/ia", { pasta: projeto, ligado: v })); }}
                    onPedido={(id) => { setPedido(id); setFolha(null); }} />
      )}

      <Folha aberta={!!mover} titulo={mover ? `Mover #${mover.id}` : ""} onFecha={() => setMover(null)}>
        {mover && <ListaStatus atual={mover.status} onEscolhe={(st) => { const m = mover; setMover(null); moverPara(m, st); }} />}
      </Folha>

      <Triagem aberta={triagem} cards={novos} onFecha={() => setTriagem(false)}
               onAceitar={(i) => api.patch(`/board/issues/${i.id}`, { status: "backlog" }).catch((e) => setErro(e.message))}
               onRejeitar={(i, m) => api.post(`/board/issues/${i.id}/rejeitar`, { motivo: m }).catch((e) => setErro(e.message))}
               onFim={carrega} />

      {detalhe != null && projeto && (
        <Detalhe key={String(detalhe)} c0={detalhe === "novo" ? null : atual} pasta={projeto} nomeProjeto={nomeProjeto} acao={acao}
                 onFecha={() => setDetalhe(null)} onMover={(i) => setMover(i)} onCriado={(id) => setDetalhe(id)}
                 onAbreConversa={(id, k) => { setDetalhe(null); onAbreConversa(id, k); }}
                 onApagado={(i) => { setDetalhe(null); toast(`#${i.id} apagado.`, () => acao(() => api.post("/board/issues", {
                   pasta: projeto, titulo: i.titulo, descricao: i.descricao, tipo: i.tipo, area: i.area, severidade: i.severidade,
                   status: i.status, evidencias: i.evidencias, prompt: i.prompt, verify_sugerido: i.verify_sugerido }))); }} />
      )}
    </View>
  );
}

function CardBoard({ i, onAbre, onMais, onAceitar, onRejeitar, onIniciar, onAprovar }: {
  i: Issue; onAbre: () => void; onMais: () => void; onAceitar: () => void; onRejeitar: () => void; onIniciar: () => void; onAprovar: () => void;
}) {
  const ev = evidenciaDe(i);
  const v = verifyDe(i);
  return (
    <Pressable onPress={onAbre} style={({ pressed }) => ({ backgroundColor: pressed ? c.raised : c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 12,
                                                           paddingVertical: 11, paddingHorizontal: 12, gap: 7 })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Tipo tipo={i.tipo} />
        <Text style={{ color: c.faint, fontSize: 11.5 }}>{i.area}</Text>
        <View style={{ flex: 1 }} />
        <Prioridade sev={i.severidade} />
        <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>#{i.id}</Text>
      </View>
      <Text style={{ color: c.fg, fontSize: 14.5, lineHeight: 20 }} numberOfLines={2}>{i.titulo}</Text>
      {!!ev && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Code size={12} color={c.muted} />
          <Text style={{ color: c.muted, fontFamily: mono, fontSize: 11.5, flex: 1 }} numberOfLines={1}>{ondeDe(ev)}</Text>
        </View>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
          {!!NOME_ORIGEM[i.origem] && i.origem !== "manual" && <SeloB t={NOME_ORIGEM[i.origem]} />}
          {v === "ok" && <SeloB t="verify passou" cor={c.ok} fundo={c.okSoft} />}
          {v === "falhou" && <SeloB t="verify falhou" cor={c.err} fundo={c.errSoft} />}
          {!!i.commit && <SeloB t={i.commit.slice(0, 7)} emMono />}
          {i.status === "andamento" && <SeloB t="rodando" cor={c.info} />}
          {i.sumiu && <SeloB t="resolvido?" cor={c.ok} fundo={c.okSoft} />}
        </View>
        {i.status === "novo" && (
          <>
            <Botao altura={32} rotulo="Rejeitar" onPress={onRejeitar} />
            <Botao primario altura={32} rotulo="Aceitar" onPress={onAceitar} />
          </>
        )}
        {i.status === "backlog" && <Botao primario altura={32} rotulo="Iniciar" icone={<Play size={11} color={c.accentFg} />} onPress={onIniciar} />}
        {i.status === "revisao" && <Botao primario altura={32} rotulo="Aprovar" icone={<Check size={13} color={c.accentFg} />} onPress={onAprovar} />}
        <BotaoIcone lado={32} fundo="transparent" borda={c.line} onPress={onMais}><More size={15} color={c.muted} /></BotaoIcone>
      </View>
    </Pressable>
  );
}

function ListaStatus({ atual, onEscolhe }: { atual: string; onEscolhe: (s: string) => void }) {
  return (
    <View style={{ gap: 2, marginHorizontal: -8 }}>
      {TODAS.map((k) => (
        <Pressable key={k.id} onPress={() => onEscolhe(k.id)}
                   style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12,
                     backgroundColor: k.id === atual ? c.raised : pressed ? c.surface : "transparent" })}>
          <Ponto cor={k.cor} lado={8} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.fg, fontSize: 15 }}>{k.nome}</Text>
            {k.id === "andamento" && <Text style={[s.faint, { fontSize: 12.5 }]}>Inicia a conversa com o modo sugerido do card.</Text>}
          </View>
          {k.id === atual && <Check size={17} color={c.accentText} />}
        </Pressable>
      ))}
    </View>
  );
}

/** Faixas entre a barra e as colunas: varredura, IA, pedido, execução automática e erro. Texto vindo da API. */
function Avisos({ varredura, ia, pedido, auto, erro, vistos, onVisto, onErro, onPedidoFim, onVerPedido, onMais, onForcar, onParar, onSeguir }: {
  varredura: Varredura; ia: VarreduraIA; pedido: number | null; auto: Auto | null; erro: string; vistos: { varredura: boolean; ia: boolean };
  onVisto: (k: "varredura" | "ia") => void; onErro: () => void; onPedidoFim: () => void; onVerPedido: () => void; onMais: () => void;
  onForcar: () => void; onParar: () => void; onSeguir: () => void;
}) {
  const faixa = (chave: string, cor: string, pulsa: boolean, corpo: React.ReactNode, fecha?: () => void, borda?: string) => (
    <View key={chave} style={{ marginHorizontal: 12, marginBottom: 8, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12, flexDirection: "row",
                               alignItems: "center", gap: 9, backgroundColor: c.surface, borderWidth: 1, borderColor: borda ?? c.line }}>
      <Pulsa cor={cor} ativo={pulsa} />
      <View style={{ flex: 1 }}>{corpo}</View>
      {fecha && <Pressable hitSlop={10} onPress={fecha}><X size={14} color={c.faint} /></Pressable>}
    </View>
  );
  const txt = (t: string, cor = c.fg2) => <Text style={{ color: cor, fontSize: 12.5, lineHeight: 18 }}>{t}</Text>;
  const link = (t: string, fn: () => void) => <Text onPress={fn} style={{ color: c.accentText, fontSize: 12.5, textDecorationLine: "underline" }}>{t}</Text>;
  const out: React.ReactNode[] = [];
  if (erro) out.push(<Pressable key="erro" onPress={onErro}>{faixa("erro-f", c.err, false, txt(erro, c.err), undefined, c.err)}</Pressable>);
  if (varredura?.rodando)
    out.push(faixa("v", c.info, true, txt(`Varrendo${varredura.etapa ? ` · ${varredura.etapa}` : ""}… ${varredura.encontrados} achado${varredura.encontrados === 1 ? "" : "s"}`)));
  else if (varredura && varredura.avisos.length > 0 && !vistos.varredura)
    out.push(faixa("vf", c.ok, false, txt(`Varredura: ${varredura.criados} card${varredura.criados === 1 ? "" : "s"} novo${varredura.criados === 1 ? "" : "s"}. ${varredura.avisos.join(" ")}`),
                   () => onVisto("varredura")));
  if (ia?.rodando)
    out.push(faixa("ia", c.agent, true, txt(`IA: ${ia.etapa ?? "lendo"}${ia.total ? ` ${ia.lidos ?? 0}/${ia.total} arquivos mudados` : ""}`)));
  else if (ia && (ia.avisos.length > 0 || ia.parou || ia.mais > 0 || ia.criados != null) && !vistos.ia)
    out.push(faixa("iaf", c.agent, false, (
      <Text style={{ color: c.fg2, fontSize: 12.5, lineHeight: 18 }}>
        {ia.criados != null ? `Varredura com IA: ${ia.criados} card${ia.criados === 1 ? "" : "s"} em Novo${ia.descartados ? `, ${ia.descartados} achado(s) sem prova descartado(s)` : ""}. ` : ""}
        {ia.parou ? `Parou: ${ia.parou}. ` : ""}{ia.avisos.join(" ")}
        {ia.avisos.some((a) => a.includes("mesmo assim")) && <>{" "}{link("varrer mesmo assim", onForcar)}</>}
        {ia.mais > 0 && <>{" "}{link(`trazer mais ${Math.min(20, ia.mais)} de ${ia.mais} achado(s)`, onMais)}</>}
      </Text>
    ), () => onVisto("ia")));
  if (pedido != null)
    out.push(faixa("p", c.info, true, (
      <Text style={{ color: c.fg2, fontSize: 12.5, lineHeight: 18 }}>A IA está procurando. Os cards aparecem em Novo conforme ela confirma. {link("Ver conversa", onVerPedido)}</Text>
    ), onPedidoFim));
  if (auto?.ligado)
    out.push(faixa("a", c.ok, !!auto.em_curso, (
      <Text style={{ color: c.fg2, fontSize: 12.5, lineHeight: 18 }}>
        Executando backlog sozinho{auto.em_curso ? ` · rodando #${auto.em_curso}` : ""} · {auto.feitos}/{auto.por_dia} hoje {link("Parar", onParar)}
      </Text>
    )));
  else if (auto?.parado)
    out.push(faixa("ap", c.warn, false, <Text style={{ color: c.fg2, fontSize: 12.5, lineHeight: 18 }}>Parou: {auto.parado} · {link("seguir", onSeguir)}</Text>));
  return <>{out}</>;
}

function FolhaFiltros({ aberta, f, onMuda, onFecha, total }: { aberta: boolean; f: Filtros; onMuda: (f: Filtros) => void; onFecha: () => void; total: number }) {
  const pil = (on: boolean, rot: string, fn: () => void, cor?: string) => (
    <Pressable key={rot} onPress={fn} style={{ height: 34, borderRadius: 999, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6,
                                               borderWidth: 1, borderColor: on ? c.accentLine : c.line, backgroundColor: on ? c.accentSoft : "transparent" }}>
      {cor && <Ponto cor={cor} />}
      <Text style={{ color: on ? c.accentText : c.muted, fontSize: 13 }}>{rot}</Text>
    </Pressable>
  );
  const grupo = (titulo: string, itens: React.ReactNode[]) => (
    <View style={{ gap: 8 }}><Text style={s.muted}>{titulo}</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{itens}</View></View>
  );
  return (
    <Folha aberta={aberta} titulo="Filtros" onFecha={onFecha}>
      {grupo("Tipo", TIPOS.map((t) => pil(f.tipo === t, NOME_TIPO[t], () => onMuda({ ...f, tipo: f.tipo === t ? null : t }), COR_TIPO[t])))}
      {grupo("Prioridade", [1, 2, 3].map((n) => pil(f.sev === n, NOME_SEV[n], () => onMuda({ ...f, sev: f.sev === n ? null : n }), COR_SEV[n])))}
      {grupo("Área", AREAS.map((a) => pil(f.area === a, a, () => onMuda({ ...f, area: f.area === a ? null : a }))))}
      <Opcao rotulo="Mostrar Rejeitados" dica="Vira uma coluna a mais no fim." valor={f.rejeitados} onMuda={(v) => onMuda({ ...f, rejeitados: v })} />
      <Botao primario altura={48} rotulo={`Ver ${total} cards`} onPress={onFecha} />
    </Folha>
  );
}

function FolhaAcoes({ aberta, onFecha, pasta, varredura, ia, pedido, iaCria, auto, vinc, acao, onVinc, onIaCria, onPedido }: {
  aberta: boolean; onFecha: () => void; pasta: string; varredura: Varredura; ia: VarreduraIA; pedido: number | null; iaCria: boolean;
  auto: Auto | null; vinc: Vinc | null; acao: (fn: () => Promise<unknown>) => Promise<unknown>; onVinc: (v: Vinc) => void;
  onIaCria: (v: boolean) => void; onPedido: (id: number) => void;
}) {
  const [pedir, setPedir] = useState(false);
  const [foco, setFoco] = useState("tudo");
  const [subpasta, setSubpasta] = useState("");
  const [novaPasta, setNovaPasta] = useState("");
  const cartao = (Icone: typeof Refresh, titulo: string, dica: string, rodando: boolean, onPress: () => void) => (
    <Pressable onPress={onPress} disabled={rodando}
               style={({ pressed }) => ({ flexDirection: "row", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.line,
                 backgroundColor: pressed ? c.raised : c.surface, opacity: rodando ? 0.6 : 1 })}>
      <Quadrado><Icone size={17} color={c.fg} /></Quadrado>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: c.fg, fontSize: 15, fontWeight: "600" }}>{titulo}</Text>
          {rodando && <Pulsa cor={c.info} />}
        </View>
        <Text style={[s.faint, { fontSize: 12.5, lineHeight: 18 }]}>{dica}</Text>
      </View>
    </Pressable>
  );
  const travado = !auto?.ligado && !!auto?.travas.length;
  return (
    <Folha aberta={aberta} titulo="Ações do board" onFecha={onFecha}>
      <View style={{ gap: 8 }}>
        <Text style={s.secao2}>PROCURAR</Text>
        {cartao(Refresh, "Varrer", "TODOs, php artisan test, phpstan e auditoria de dependências (do FORJA.md).", !!varredura?.rodando,
                () => { acao(() => api.post("/board/varrer", { pasta })); onFecha(); })}
        {cartao(Raio, "Varrer com IA", "Lê o código mudado desde a última vez e sugere até 20 cards com arquivo, linha e trecho. Para sozinho se o agente precisar do modelo.",
                !!ia?.rodando, () => { acao(() => api.post("/board/varrer-ia", { pasta })); onFecha(); })}
        {cartao(Balao, "Pedir à IA", "A IA lê o projeto e cria os cards que confirmar.", pedido != null, () => setPedir(!pedir))}
        {pedir && (
          <View style={{ backgroundColor: c.accentSoft, borderRadius: 12, padding: 12, gap: 10 }}>
            <Text style={{ color: c.fg2, fontSize: 12.5, lineHeight: 18 }}>A IA só lê o projeto e cria os cards que confirmar, com arquivo e linha. Eles caem em Novo.</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {FOCOS.map((x) => (
                <Pressable key={x.id} onPress={() => setFoco(x.id)} style={{ height: 32, borderRadius: 999, paddingHorizontal: 12, justifyContent: "center",
                                                                            backgroundColor: foco === x.id ? c.accent : c.raised }}>
                  <Text style={{ color: foco === x.id ? c.accentFg : c.muted, fontSize: 13 }}>{x.nome}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput style={[s.input, { fontFamily: mono, fontSize: 13 }]} value={subpasta} onChangeText={setSubpasta}
                       placeholder="Só na subpasta (opcional)" placeholderTextColor={c.faint} autoCapitalize="none" />
            <Botao primario altura={44} rotulo="Começar" icone={<Raio size={14} color={c.accentFg} />} onPress={() => acao(async () => {
              const r = await api.post<{ conversa_id: number }>("/board/pedir", { pasta, foco, subpasta: subpasta.trim() || null });
              setPedir(false);
              onPedido(r.conversa_id);
            })} />
          </View>
        )}
      </View>
      <View style={{ gap: 14 }}>
        <Text style={s.secao2}>AUTOMAÇÃO</Text>
        <Opcao rotulo="IA cria cards sozinha" valor={iaCria} onMuda={onIaCria}
               dica="Em qualquer conversa deste projeto o agente pode criar cards, que caem em Novo. Desligado, a ferramenta nem aparece para o modelo." />
        {auto && (
          <View style={{ gap: 8 }}>
            <Opcao rotulo="Executar backlog sozinho" valor={auto.ligado} desabilitada={travado}
                   dica={travado ? auto.travas.join(" ") : `Pega os cards do Backlog, mais graves primeiro, um por vez, no modo Automático e no sandbox. Novo e segurança nunca rodam sozinhos. Até ${auto.por_dia} por dia; para na primeira falha. O resultado para em Revisão.`}
                   onMuda={(v) => acao(() => api.post("/board/auto", { pasta, ligado: v }))} />
            {auto.ligado && (
              <Text style={{ color: c.muted, fontFamily: mono, fontSize: 12, backgroundColor: c.code, borderRadius: 10, padding: 10, overflow: "hidden" }}>
                {auto.em_curso ? `rodando #${auto.em_curso} · ` : ""}{auto.feitos}/{auto.por_dia} hoje · sandbox Docker
              </Text>
            )}
          </View>
        )}
      </View>
      <View style={{ gap: 10 }}>
        <Text style={s.secao2}>PASTAS LIGADAS</Text>
        <Text style={[s.faint, { fontSize: 12.5, lineHeight: 18 }]}>
          Conversa aberta numa pasta ligada usa este board, e a varredura passa por todas. Serve para back-end e front-end em repositórios separados.
        </Text>
        {vinc?.vinculadas.map((v) => (
          <View key={v} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
            <Folder size={16} color={c.muted} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.fg, fontSize: 14 }}>{nomePasta(v)}</Text>
              <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11 }} numberOfLines={1}>{v}</Text>
            </View>
            <Pressable hitSlop={10} onPress={() => acao(async () => { await api.del(`/board/vinculos?pasta=${encodeURIComponent(v)}`);
              onVinc(await api.get<Vinc>(`/board/vinculos?pasta=${encodeURIComponent(pasta)}`)); })}>
              <X size={15} color={c.faint} />
            </Pressable>
          </View>
        ))}
        {!!vinc?.sugestoes.length && (
          <>
            <Text style={[s.muted, { fontSize: 12.5 }]}>Repositórios dentro do projeto:</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {vinc.sugestoes.map((v) => (
                <Pressable key={v} onPress={() => acao(async () => onVinc(await api.post<Vinc>("/board/vinculos", { pasta_board: pasta, pasta: v })))}
                           style={{ height: 32, borderRadius: 999, paddingHorizontal: 12, justifyContent: "center", borderWidth: 1, borderColor: c.line }}>
                  <Text style={{ color: c.fg2, fontSize: 13 }}>+ {nomePasta(v)}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput style={[s.input, { flex: 1, fontFamily: mono, fontSize: 13 }]} value={novaPasta} onChangeText={setNovaPasta} autoCapitalize="none"
                     placeholder="C:/caminho/de/outra/pasta" placeholderTextColor={c.faint} />
          <Botao rotulo="Vincular" altura={44} desabilitado={!novaPasta.trim()} onPress={() => acao(async () => {
            onVinc(await api.post<Vinc>("/board/vinculos", { pasta_board: pasta, pasta: novaPasta.trim() }));
            setNovaPasta("");
          })} />
        </View>
      </View>
    </Folha>
  );
}

/** Triagem de Novo em tela cheia: o card segue o dedo; soltar além de ±100 aceita (direita) ou rejeita sem motivo. */
function Triagem({ aberta, cards, onFecha, onAceitar, onRejeitar, onFim }: {
  aberta: boolean; cards: Issue[]; onFecha: () => void; onAceitar: (i: Issue) => Promise<unknown>; onRejeitar: (i: Issue, m: string | null) => Promise<unknown>;
  onFim: () => void;
}) {
  const inset = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [fila, setFila] = useState<Issue[]>([]);
  const [k, setK] = useState(0);
  const [placar, setPlacar] = useState({ a: 0, r: 0 });
  const dx = useRef(new Animated.Value(0)).current;
  const [dxv, setDxv] = useState(0);
  useEffect(() => { if (aberta) { setFila(cards); setK(0); setPlacar({ a: 0, r: 0 }); dx.setValue(0); setDxv(0); } }, [aberta]);
  const atual = fila[k];
  const st = useRef({ atual }); st.current = { atual };
  const decide = (tipo: "a" | "r" | "p", motivo: string | null = null) => {
    const i = st.current.atual;
    if (!i) return;
    if (tipo === "a") onAceitar(i);
    if (tipo === "r") onRejeitar(i, motivo);
    if (tipo !== "p") setPlacar((p) => ({ ...p, [tipo]: p[tipo] + 1 }));
    dx.setValue(0); setDxv(0);
    setK((n) => n + 1);
  };
  const sai = (lado: 1 | -1) => Animated.timing(dx, { toValue: lado * width * 1.2, duration: 180, useNativeDriver: true })
    .start(() => decide(lado > 0 ? "a" : "r"));
  const resp = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderMove: (_, g) => { dx.setValue(g.dx); setDxv(g.dx); },
    onPanResponderRelease: (_, g) => {
      if (g.dx > 100) sai(1);
      else if (g.dx < -100) sai(-1);
      else { setDxv(0); Animated.timing(dx, { toValue: 0, duration: 180, easing: Easing.bezier(0.2, 0, 0, 1), useNativeDriver: true }).start(); }
    },
  })).current;
  const fim = k >= fila.length;
  const fecha = () => { onFim(); onFecha(); };
  const ev = atual ? evidenciaDe(atual) : undefined;
  return (
    <Modal visible={aberta} animationType="fade" onRequestClose={fecha} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: inset.top, paddingBottom: inset.bottom + 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 6 }}>
          <BotaoIcone lado={44} fundo="transparent" onPress={fecha}><X size={22} color={c.fg} /></BotaoIcone>
          <Text style={{ color: c.fg, fontSize: 15, fontWeight: "600", flex: 1 }}>Triagem de Novo</Text>
          {!fim && <Text style={{ color: c.muted, fontFamily: mono, fontSize: 12.5, marginRight: 10 }}>{k + 1} de {fila.length}</Text>}
        </View>
        <View style={{ height: 3, backgroundColor: c.line, marginHorizontal: 16 }}>
          <View style={{ height: 3, backgroundColor: c.accent, width: `${fila.length ? (Math.min(k, fila.length) / fila.length) * 100 : 0}%` }} />
        </View>
        {fim ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 }}>
            <Check size={30} color={c.ok} />
            <Text style={{ color: c.fg, fontSize: 17, fontWeight: "600" }}>Novo está vazio</Text>
            <Text style={[s.muted, { textAlign: "center" }]}>{placar.a} aceito{placar.a === 1 ? "" : "s"} para o Backlog, {placar.r} rejeitado{placar.r === 1 ? "" : "s"}.</Text>
            <Botao rotulo="Voltar ao board" onPress={fecha} estilo={{ marginTop: 10 }} />
          </View>
        ) : atual && (
          <>
            <View style={{ flex: 1, padding: 16, justifyContent: "center" }}>
              {/* rótulos ao fundo: ganham opacidade com o arrasto */}
              <View style={{ position: "absolute", left: 24, right: 24, top: 0, bottom: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ alignItems: "center", gap: 4, opacity: Math.min(1, Math.max(0, -dxv / 100)) }}>
                  <X size={26} color={c.err} /><Text style={{ color: c.err, fontSize: 13, fontWeight: "600" }}>Rejeitar</Text>
                </View>
                <View style={{ alignItems: "center", gap: 4, opacity: Math.min(1, Math.max(0, dxv / 100)) }}>
                  <Check size={26} color={c.ok} /><Text style={{ color: c.ok, fontSize: 13, fontWeight: "600" }}>Aceitar</Text>
                </View>
              </View>
              <Animated.View {...resp.panHandlers}
                             style={{ backgroundColor: c.surface, borderRadius: 18, padding: 16, gap: 10, borderWidth: 1,
                                      borderColor: dxv > 60 ? c.ok : dxv < -60 ? c.err : c.line, elevation: 16, shadowColor: "#000",
                                      shadowOpacity: 0.45, shadowRadius: 25, shadowOffset: { width: 0, height: 20 },
                                      transform: [{ translateX: dx }, { rotate: dx.interpolate({ inputRange: [-220, 220], outputRange: ["-10deg", "10deg"] }) }] }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Tipo tipo={atual.tipo} />
                  <Text style={{ color: c.faint, fontSize: 11.5 }}>{atual.area}</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>#{atual.id} · {NOME_ORIGEM[atual.origem] ?? atual.origem}</Text>
                </View>
                <Text style={{ color: c.fg, fontSize: 18, lineHeight: 25, fontWeight: "600" }}>{atual.titulo}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                  <Prioridade sev={atual.severidade} />
                  <Text style={{ color: c.muted, fontSize: 12.5 }}>Prioridade {NOME_SEV[atual.severidade]?.toLowerCase()}</Text>
                </View>
                {!!atual.descricao && <Text style={{ color: c.fg2, fontSize: 14, lineHeight: 21 }} numberOfLines={6}>{atual.descricao}</Text>}
                {ev && <BlocoCodigo e={ev} />}
              </Animated.View>
            </View>
            <View style={{ paddingHorizontal: 16, gap: 10 }}>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <Botao flex altura={52} rotulo="Rejeitar" icone={<X size={16} color={c.fg} />} onPress={() => sai(-1)} />
                <BotaoIcone lado={52} fundo="transparent" borda={c.line} onPress={() => decide("p")}><ArrowRight size={20} color={c.fg} /></BotaoIcone>
                <Botao flex primario altura={52} rotulo="Aceitar" icone={<Check size={16} color={c.accentFg} />} onPress={() => sai(1)} />
              </View>
              <View style={{ flexDirection: "row", gap: 6, justifyContent: "center" }}>
                {MOTIVOS.map((m) => <Botao key={m.id} altura={32} rotulo={m.nome} onPress={() => decide("r", m.id)} />)}
              </View>
              <Text style={{ color: c.faint, fontSize: 11.5, textAlign: "center" }}>Deslize para a direita para aceitar, para a esquerda para rejeitar sem motivo.</Text>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

function BlocoCodigo({ e, onAbrir }: { e: Evidencia; onAbrir?: () => void }) {
  return (
    <View style={{ backgroundColor: c.code, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: c.line }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: c.line }}>
        <Code size={12} color={c.muted} />
        <Text style={{ color: c.muted, fontFamily: mono, fontSize: 11.5, flex: 1 }} numberOfLines={1}>{ondeDe(e)}</Text>
        {onAbrir && <Text onPress={onAbrir} style={{ color: c.accentText, fontSize: 12 }}>abrir no PC</Text>}
      </View>
      {!!e.trecho && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Text style={{ color: c.fg, fontFamily: mono, fontSize: 12, padding: 10, lineHeight: 18 }}>{e.trecho}</Text>
        </ScrollView>
      )}
    </View>
  );
}

/** Detalhe do card (ou novo card) em tela cheia: campos editáveis salvos com PATCH (600 ms), próximo passo e histórico. */
function Detalhe({ c0, pasta, nomeProjeto, acao, onFecha, onMover, onCriado, onAbreConversa, onApagado }: {
  c0: Issue | null; pasta: string; nomeProjeto: string; acao: (fn: () => Promise<unknown>) => Promise<unknown>; onFecha: () => void;
  onMover: (i: Issue) => void; onCriado: (id: number) => void; onAbreConversa: (id: number, kind: string) => void; onApagado: (i: Issue) => void;
}) {
  const inset = useSafeAreaInsets();
  const teclado = useTeclado();
  const inicial = { titulo: c0?.titulo ?? "", descricao: c0?.descricao ?? "", tipo: c0?.tipo ?? "bugfix", area: c0?.area ?? "backend",
                    severidade: c0?.severidade ?? 2, prompt: c0?.prompt ?? "", verify_sugerido: c0?.verify_sugerido ?? "" };
  const [f, setF] = useState(inicial);
  const [modo, setModo] = useState<"agent" | "maestro">(c0?.modo_sugerido ?? "agent");
  const [rejeitando, setRejeitando] = useState(false);
  const [apagar, setApagar] = useState(false);
  const [comentario, setComentario] = useState("");
  const [escolha, setEscolha] = useState<null | "tipo" | "area" | "sev">(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendente = useRef<Partial<typeof f>>({});
  // Card existente: cada mudança salva sozinha depois de 600 ms parado (sem botão Salvar).
  const muda = (x: Partial<typeof f>) => {
    setF((a) => ({ ...a, ...x }));
    if (!c0) return;
    pendente.current = { ...pendente.current, ...x };
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => { const p = pendente.current; pendente.current = {}; api.patch(`/board/issues/${c0.id}`, p).catch(() => {}); }, 600);
  };
  useEffect(() => () => {
    if (t.current) clearTimeout(t.current);
    if (c0 && Object.keys(pendente.current).length) api.patch(`/board/issues/${c0.id}`, pendente.current).catch(() => {}); // fechou antes dos 600 ms
  }, []);
  const status = (st: string) => acao(() => api.patch(`/board/issues/${c0!.id}`, { status: st }));
  const col = TODAS.find((k) => k.id === c0?.status);
  const secao = (titulo: string, corpo: React.ReactNode) => (
    <View style={{ gap: 8 }}><Text style={s.secao2}>{titulo}</Text>{corpo}</View>
  );
  const pilula = (cor: string | null, rot: string, fn: () => void) => (
    <Pressable onPress={fn} style={{ height: 32, borderRadius: 999, borderWidth: 1, borderColor: c.line, paddingHorizontal: 12, flexDirection: "row",
                                     alignItems: "center", gap: 6 }}>
      {cor && <Ponto cor={cor} />}
      <Text style={{ color: c.fg2, fontSize: 13 }}>{rot}</Text>
      <Abaixo size={12} color={c.faint} />
    </Pressable>
  );
  const campo = [s.input, { minHeight: 76, textAlignVertical: "top" as const, lineHeight: 21 }];
  return (
    <Modal visible animationType="slide" onRequestClose={onFecha} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: inset.top, paddingBottom: teclado }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 6 }}>
          <BotaoIcone lado={44} fundo="transparent" onPress={onFecha}><ArrowLeft size={21} color={c.fg} /></BotaoIcone>
          <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12.5, flex: 1 }} numberOfLines={1}>
            {c0 ? `#${c0.id} · ${NOME_ORIGEM[c0.origem] ?? c0.origem}` : `Novo card em ${nomeProjeto}`}
          </Text>
          {c0 && col && (
            <Pressable onPress={() => onMover(c0)} style={{ height: 32, borderRadius: 999, backgroundColor: c.raised, paddingHorizontal: 12, flexDirection: "row",
                                                            alignItems: "center", gap: 6, marginRight: 6 }}>
              <Ponto cor={col.cor} lado={7} />
              <Text style={{ color: c.fg, fontSize: 13 }}>{col.nome}</Text>
              <Abaixo size={12} color={c.muted} />
            </Pressable>
          )}
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 6, gap: 18, paddingBottom: inset.bottom + 24 }} keyboardShouldPersistTaps="handled">
          <TextInput style={{ color: c.fg, fontSize: 18, lineHeight: 25, fontWeight: "600", padding: 0 }} multiline value={f.titulo}
                     onChangeText={(x) => muda({ titulo: x })} placeholder="Título do card" placeholderTextColor={c.faint} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {pilula(COR_TIPO[f.tipo] ?? null, NOME_TIPO[f.tipo] ?? f.tipo, () => setEscolha("tipo"))}
            {pilula(null, f.area, () => setEscolha("area"))}
            {pilula(COR_SEV[f.severidade], `Prioridade ${NOME_SEV[f.severidade]?.toLowerCase()}`, () => setEscolha("sev"))}
          </View>

          {c0 && (
            <View style={{ backgroundColor: c.surface, borderRadius: 14, padding: 12, gap: 10 }}>
              <Text style={s.secao2}>PRÓXIMO PASSO</Text>
              {c0.status === "novo" && (
                <>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Botao flex primario altura={44} rotulo="Aceitar" icone={<Check size={15} color={c.accentFg} />} onPress={() => status("backlog")} />
                    <Botao altura={44} rotulo="Rejeitar" onPress={() => setRejeitando(!rejeitando)} />
                  </View>
                  {rejeitando && (
                    <View style={{ gap: 8 }}>
                      <Text style={[s.muted, { fontSize: 12.5 }]}>Por quê? A varredura não recria card rejeitado.</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                        {[...MOTIVOS, { id: "", nome: "Sem motivo" }].map((m) => (
                          <Botao key={m.id} altura={32} rotulo={m.nome} onPress={() => acao(() => api.post(`/board/issues/${c0.id}/rejeitar`, { motivo: m.id || null }))} />
                        ))}
                      </View>
                    </View>
                  )}
                </>
              )}
              {c0.status === "backlog" && (
                <>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {(["agent", "maestro"] as const).map((m) => (
                      <Pressable key={m} onPress={() => setModo(m)}
                                 style={{ flex: 1, height: 40, borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center",
                                          borderColor: modo === m ? c.accentLine : c.line, backgroundColor: modo === m ? c.accentSoft : "transparent" }}>
                        {m === "agent" ? <Code size={14} color={modo === m ? c.accentText : c.muted} /> : <Split size={14} color={modo === m ? c.accentText : c.muted} />}
                        <Text style={{ color: modo === m ? c.fg : c.muted, fontSize: 13.5, fontWeight: modo === m ? "600" : "400" }}>{m === "agent" ? "Agente" : "Maestro"}</Text>
                        {c0.modo_sugerido === m && <Text style={{ color: c.faint, fontSize: 11 }}>sugerido</Text>}
                      </Pressable>
                    ))}
                  </View>
                  <Botao primario altura={44} rotulo={modo === "agent" ? "Iniciar com o agente" : "Iniciar com o Maestro"} icone={<Play size={13} color={c.accentFg} />}
                         onPress={() => acao(() => api.post(`/board/issues/${c0.id}/iniciar`, { modo })).then(onFecha)} />
                </>
              )}
              {c0.status === "andamento" && c0.conversa_id && (
                <Botao primario altura={44} rotulo="Abrir conversa" icone={<Balao size={15} color={c.accentFg} />} onPress={() => onAbreConversa(c0.conversa_id!, c0.modo_sugerido)} />
              )}
              {c0.status === "revisao" && (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Botao flex primario altura={44} rotulo="Aprovar" icone={<Check size={15} color={c.accentFg} />} onPress={() => status("concluido")} />
                  {c0.conversa_id && <Botao altura={44} rotulo="Conversa" icone={<Balao size={15} color={c.fg} />} onPress={() => onAbreConversa(c0.conversa_id!, c0.modo_sugerido)} />}
                </View>
              )}
              {c0.status === "rejeitado" && (
                <>
                  <Botao altura={44} rotulo="Voltar ao backlog" onPress={() => status("backlog")} />
                  <Text style={[s.muted, { fontSize: 12.5 }]}>
                    Rejeitado{c0.motivo_rejeicao ? `: ${MOTIVOS.find((m) => m.id === c0.motivo_rejeicao)?.nome ?? c0.motivo_rejeicao}` : ""}. A varredura não recria.
                  </Text>
                </>
              )}
              {c0.status === "concluido" && <Text style={[s.muted, { fontSize: 13 }]}>Concluído{c0.commit ? ` no commit ${c0.commit.slice(0, 7)}` : ""}.</Text>}
            </View>
          )}

          {c0 && c0.evidencias.length > 0 && secao("ONDE", c0.evidencias.map((e, k) => e.arquivo ? (
            <BlocoCodigo key={k} e={e} onAbrir={() => api.post("/open", { path: `${c0.projeto}/${e.arquivo}`, line: e.linha ?? null })
              .then(() => toast("Aberto no editor do PC.")).catch((er) => toast(er.message))} />
          ) : e.imagem ? (
            <Image key={k} source={{ uri: fotoDe(e) }} style={{ width: "100%", aspectRatio: 16 / 10, borderRadius: 12, backgroundColor: c.code }} resizeMode="contain" />
          ) : e.saida || e.comando ? (
            <View key={k} style={{ backgroundColor: c.code, borderRadius: 10, borderWidth: 1, borderColor: c.line, overflow: "hidden" }}>
              {!!e.comando && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: c.line }}>
                  <Terminal size={12} color={c.muted} />
                  <Text style={{ color: c.muted, fontFamily: mono, fontSize: 11.5 }} numberOfLines={1}>$ {e.comando}</Text>
                </View>
              )}
              <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
                <Text style={{ color: c.muted, fontFamily: mono, fontSize: 12, padding: 10, lineHeight: 18 }}>{e.saida}</Text>
              </ScrollView>
            </View>
          ) : null))}

          {secao("DESCRIÇÃO", <TextInput style={campo} multiline value={f.descricao} onChangeText={(x) => muda({ descricao: x })}
                                         placeholder="O problema e o impacto" placeholderTextColor={c.faint} />)}
          {secao("PARA A IA", (
            <>
              <TextInput style={[...campo, { fontSize: 13.5 }]} multiline value={f.prompt} onChangeText={(x) => muda({ prompt: x })}
                         placeholder="Vazio: vai o título, a descrição e as evidências." placeholderTextColor={c.faint} />
              <Text style={[s.muted, { fontSize: 12.5 }]}>Como provar que ficou pronto</Text>
              <TextInput style={[s.input, { height: 44, fontFamily: mono, fontSize: 13, paddingVertical: 0 }]} value={f.verify_sugerido} autoCapitalize="none"
                         onChangeText={(x) => muda({ verify_sugerido: x })} placeholder="Comando de terminal, ex.: npm test" placeholderTextColor={c.faint} />
            </>
          ))}

          {c0?.status === "revisao" && secao("REVISÃO", (
            <>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {!!c0.commit && <SeloB t={`commit ${c0.commit.slice(0, 10)}`} emMono />}
                {verifyDe(c0) === "ok" && <SeloB t="verify passou" cor={c.ok} fundo={c.okSoft} />}
                {verifyDe(c0) === "falhou" && <SeloB t="verify falhou" cor={c.err} fundo={c.errSoft} />}
              </View>
              <TextInput style={campo} multiline value={comentario} onChangeText={setComentario}
                         placeholder="O que falta? Vira a próxima mensagem da mesma conversa." placeholderTextColor={c.faint} />
              <Botao altura={40} rotulo="Reabrir com o comentário" icone={<Undo size={14} color={c.fg} />} desabilitado={!comentario.trim()}
                     onPress={() => acao(() => api.post(`/board/issues/${c0.id}/reabrir`, { comentario })).then(onFecha)} />
            </>
          ))}

          {c0 && c0.historico.length > 0 && secao("HISTÓRICO", (
            <View style={{ borderLeftWidth: 1, borderLeftColor: c.line, marginLeft: 4, paddingLeft: 14, gap: 10 }}>
              {[...c0.historico].reverse().map((h, k) => (
                <View key={k}>
                  <View style={{ position: "absolute", left: -19, top: 5, width: 9, height: 9, borderRadius: 5, backgroundColor: k === 0 ? c.fg2 : c.lineStrong }} />
                  <Text style={{ color: c.fg2, fontSize: 13, lineHeight: 18 }}>{h.texto}</Text>
                  <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11 }}>{h.quando.replace("T", " ").slice(5, 16)}</Text>
                </View>
              ))}
            </View>
          ))}

          {c0 ? (
            <Text onPress={() => (apagar ? acao(async () => { await api.del(`/board/issues/${c0.id}`); onApagado(c0); }) : setApagar(true))}
                  style={{ color: apagar ? c.err : c.faint, fontSize: 13 }}>
              {apagar ? "Toque de novo para apagar de vez" : "Apagar card"}
            </Text>
          ) : (
            <Botao primario altura={48} rotulo="Criar card em Backlog" desabilitado={!f.titulo.trim()}
                   onPress={() => acao(async () => { const n = await api.post<Issue>("/board/issues", { ...f, pasta, status: "backlog" }); onCriado(n.id); })} />
          )}
        </ScrollView>

        <Folha aberta={escolha === "tipo"} titulo="Tipo" onFecha={() => setEscolha(null)}>
          <Lista opcoes={TIPOS.map((x) => ({ id: x, rotulo: NOME_TIPO[x], cor: COR_TIPO[x] }))} valor={f.tipo} onEscolhe={(x) => { setEscolha(null); muda({ tipo: x }); }} />
        </Folha>
        <Folha aberta={escolha === "area"} titulo="Área" onFecha={() => setEscolha(null)}>
          <Lista opcoes={AREAS.map((x) => ({ id: x, rotulo: x }))} valor={f.area} onEscolhe={(x) => { setEscolha(null); muda({ area: x }); }} />
        </Folha>
        <Folha aberta={escolha === "sev"} titulo="Prioridade" onFecha={() => setEscolha(null)}>
          <Lista opcoes={[1, 2, 3].map((n) => ({ id: String(n), rotulo: NOME_SEV[n], cor: COR_SEV[n] }))} valor={String(f.severidade)}
                 onEscolhe={(x) => { setEscolha(null); muda({ severidade: Number(x) }); }} />
        </Folha>
      </View>
    </Modal>
  );
}
