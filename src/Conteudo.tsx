import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { Text } from "./Texto";
import { api } from "./api";
import type { Conv } from "./Chat";
import { Check, Copy, Externo, Filme, Play, Refresh, Square, Star, X } from "./icones";
import { c, mono, s } from "./tema";
import { Botao, Selo, toast } from "./ui";
import ConteudoVideo, { type ProducaoVideo } from "./ConteudoVideo";

// Tela Conteúdo do Forja Desktop (E18), no celular: ver os roteiros que a pesquisa escreveu, aprovar o do vídeo
// da noite, descartar, mandar produzir agora e acompanhar a produção. Mesmas rotas /api/conteudo do PC; o
// carimbo `lista` do /activity mantém os dois lados iguais, ao vivo.

type Spec = { id: number; nome: string; estilo: string; formato: "vertical" | "horizontal"; automacao: { modo: string } };
type Roteiro = {
  id: string; status: "novo" | "aprovado" | "descartado" | "produzido"; titulo: string; titulo_youtube: string; ideia: string;
  noticia: { resumo: string; data: string; fontes: { titulo: string; url: string }[] };
  cenas: { id: string; texto: string }[]; confianca: number; motivo_confianca: string; segundos: number; repetido?: string;
  nota?: { total: number; fatos: number; comentario: string };
};
type Rodada = { id: number; criado: string | null; status: string; fase: string; aviso: string; roteiros: Roteiro[];
  stats?: { uteis?: number }; fontes?: unknown[] };
type Producao = { id: number; criado: string | null; status: string; titulo: string; aviso: string; log: string[]; segundos: number;
  entregue: string; formato?: "vertical" | "horizontal"; versao?: number;
  voz?: string; voz_final?: string };   // voz_final "pendente": versão de validação com o Edge, esperando o ElevenLabs
type Perdido = { trilha: "r" | "p"; slot: string };
type Pronto = { rodada: number; roteiro: string; titulo: string };
type Agenda = { modo: string; proximas: { r?: string; p?: string }; perdido?: Perdido | null; pronto?: Pronto | null };
type AgendaItem = Agenda & { id: number; nome: string };

const MODOS: Record<string, string> = { desligada: "manual", aprovacao: "aprovação", automatico: "automático" };
const FASES: Record<string, string> = {
  planejando: "planejando buscas", buscando: "buscando novidades", lendo: "lendo fontes", escrevendo: "escrevendo roteiros",
  aguardando: "esperando o Claude", pronto: "pronto",
};
const CONFIANCA = ["", "muito baixa", "baixa", "média", "boa", "alta"];

const dataCurta = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso.endsWith("Z") || iso.length < 17 ? iso : iso + "Z");
  return `${d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" })} ${d.toTimeString().slice(0, 5)}`;
};
const quando = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso), hoje = new Date(), amanha = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
  const dia = d.toDateString() === hoje.toDateString() ? "hoje" : d.toDateString() === amanha.toDateString() ? "amanhã" : dataCurta(iso).slice(0, 5);
  return `${dia} ${d.toTimeString().slice(0, 5)}`;
};
const relogio = (seg: number) => `${Math.floor(seg / 60)}:${String(Math.floor(seg % 60)).padStart(2, "0")}`;
const card = { backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.line, padding: 12, gap: 8 } as const;

export default function Conteudo({ conv, onAbre }: { conv: Conv | null; onAbre: (c: Conv) => void }) {
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [rodadas, setRodadas] = useState<Rodada[]>([]);
  const [producoes, setProducoes] = useState<Producao[]>([]);
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [perdidos, setPerdidos] = useState<AgendaItem[]>([]);
  const [erro, setErro] = useState("");
  const [atualizando, setAtualizando] = useState(false);
  const [assistindo, setAssistindo] = useState<ProducaoVideo | null>(null);
  const convId = conv?.id ?? null;

  const carrega = useCallback(async () => {
    try {
      const lista = await api.get<Spec[]>("/conteudo/especificacoes");
      setSpecs(lista);
      if (convId == null) {
        setPerdidos((await api.get<AgendaItem[]>("/conteudo/agenda")).filter((a) => a.perdido || a.pronto));
        return;
      }
      const [r, p, a] = await Promise.all([
        api.get<Rodada[]>(`/conteudo/especificacoes/${convId}/roteiros`),
        api.get<Producao[]>(`/conteudo/especificacoes/${convId}/producao`),
        api.get<Agenda>(`/conteudo/especificacoes/${convId}/agenda`),
      ]);
      setRodadas(r.slice(0, 4));
      setProducoes(p.slice(0, 3));
      setAgenda(a);
      setErro("");
    } catch (e: any) {
      setErro(e.message);
    }
  }, [convId]);

  useEffect(() => { carrega(); }, [carrega]);

  // Ao vivo com o PC: o carimbo `lista` muda quando um roteiro é aprovado/gerado em qualquer aparelho. Com
  // pesquisa ou produção rodando, recarrega a cada 3 s (o log e a fase andam sem mexer no carimbo).
  const carimbo = useRef<string | undefined>(undefined);
  const vivo = rodadas.some((r) => r.status === "rodando") || producoes.some((p) => p.status === "rodando");
  useEffect(() => {
    const olha = () => api.get<{ lista?: string }>("/activity").then((a) => {
      if ((carimbo.current !== undefined && a.lista && a.lista !== carimbo.current) || vivo) carrega();
      carimbo.current = a.lista;
    }).catch(() => {});
    const t = setInterval(olha, 3000);
    return () => clearInterval(t);
  }, [carrega, vivo]);

  async function acao(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      if (ok) toast(ok);
      await carrega();
    } catch (e: any) {
      setErro(e.message);
    }
  }

  const atualiza = () => { setAtualizando(true); carrega().finally(() => setAtualizando(false)); };
  const refresh = <RefreshControl refreshing={atualizando} onRefresh={atualiza} tintColor={c.muted} />;

  if (convId == null) {
    return (
      <ScrollView style={s.tela} contentContainerStyle={{ padding: 16, gap: 10 }} refreshControl={refresh}>
        {perdidos.map((a) => a.perdido ? (
          <AvisoPerdido key={a.id} nome={a.nome} perdido={a.perdido}
            onResponder={(acao_, ok) => acao(() => api.post(`/conteudo/especificacoes/${a.id}/agenda/perdido`, { acao: acao_ }), ok)} />
        ) : (
          <AvisoPronto key={a.id} nome={a.nome} pronto={a.pronto!}
            onGerar={() => acao(() => api.post(`/conteudo/especificacoes/${a.id}/producao`, { message_id: a.pronto!.rodada, roteiro_id: a.pronto!.roteiro }), "O Claude começou o vídeo")} />
        ))}
        <Text style={s.secao}>ESPECIFICAÇÕES · {specs.length}</Text>
        {specs.map((sp) => (
          <Pressable key={sp.id} onPress={() => onAbre({ id: sp.id, title: sp.nome, kind: "conteudo" })} style={card}>
            <Text style={[s.txt, { fontWeight: "600" }]}>{sp.nome}</Text>
            <Text style={s.muted}>{sp.estilo || "sem estilo"} · {sp.formato === "horizontal" ? "16:9" : "9:16"} · automação {MODOS[sp.automacao.modo]}</Text>
          </Pressable>
        ))}
        {specs.length === 0 && <Text style={s.muted}>Nenhuma especificação ainda. Crie no Forja do PC, na seção Conteúdo.</Text>}
        {!!erro && <Text style={[s.muted, { color: c.err }]} onPress={() => setErro("")}>{erro}</Text>}
      </ScrollView>
    );
  }

  const spec = specs.find((x) => x.id === convId);
  const ocupado = rodadas.some((r) => r.status === "rodando" || r.status === "aguardando");
  const produzindo = producoes.some((p) => p.status === "rodando");

  return (
    <ScrollView style={s.tela} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} refreshControl={refresh}>
      {spec && (
        <Text style={s.muted}>
          {spec.estilo} · {spec.formato === "horizontal" ? "horizontal 16:9" : "vertical 9:16"} · automação {MODOS[spec.automacao.modo]}
          {agenda?.proximas.r ? ` · roteiros ${quando(agenda.proximas.r)}` : ""}{agenda?.proximas.p ? ` · vídeo ${quando(agenda.proximas.p)}` : ""}
        </Text>
      )}
      {agenda?.pronto && (
        <AvisoPronto pronto={agenda.pronto}
          onGerar={() => acao(() => api.post(`/conteudo/especificacoes/${convId}/producao`, { message_id: agenda.pronto!.rodada, roteiro_id: agenda.pronto!.roteiro }), "O Claude começou o vídeo")} />
      )}
      {agenda?.perdido && (
        <AvisoPerdido perdido={agenda.perdido}
          onResponder={(acao_, ok) => acao(() => api.post(`/conteudo/especificacoes/${convId}/agenda/perdido`, { acao: acao_ }), ok)} />
      )}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Botao rotulo="Gerar roteiros" icone={<Refresh size={16} color={c.fg} />} flex desabilitado={ocupado}
               onPress={() => acao(() => api.post(`/conteudo/especificacoes/${convId}/roteiros`, {}), "Pesquisa começou no PC")} />
        <Botao rotulo="Produzir aprovado" icone={<Play size={16} color={c.accentFg} />} primario flex desabilitado={produzindo}
               onPress={() => acao(() => api.post(`/conteudo/especificacoes/${convId}/producao`, {}), "O Claude começou o vídeo")} />
      </View>
      {!!erro && <Text style={[s.muted, { color: c.err }]} onPress={() => setErro("")}>{erro}</Text>}

      {producoes.length > 0 && <Text style={s.secao}>PRODUÇÃO</Text>}
      {producoes.map((p) => <CardProducao key={p.id} p={p} onAssistir={() => setAssistindo(p)} livre={!produzindo}
        onCancelar={() => acao(() => api.post(`/conteudo/producao/${p.id}/cancelar`, {}), "Cancelando…")}
        onVozFinal={() => acao(() => api.post(`/conteudo/producao/${p.id}/voz-final`, {}), "O Claude está trocando a voz")} />)}
      <ConteudoVideo p={assistindo} onFecha={() => setAssistindo(null)} onEnviado={() => { setAssistindo(null); carrega(); }} />

      <Text style={s.secao}>ROTEIROS</Text>
      {rodadas.length === 0 && <Text style={s.muted}>Nenhum roteiro ainda. "Gerar roteiros" pesquisa as novidades do tema.</Text>}
      {rodadas.map((r) => (
        <View key={r.id} style={{ gap: 8 }}>
          <Text style={s.faint}>
            {dataCurta(r.criado)} · {r.status === "rodando" || r.status === "aguardando" ? FASES[r.fase] ?? r.fase
              : r.status === "ok" ? `${r.roteiros.length} roteiro(s)` : r.status === "cancelado" ? "cancelada" : "erro"}
          </Text>
          {!!r.aviso && <Text style={[s.muted, { color: c.warn }]}>{r.aviso}</Text>}
          {r.roteiros.map((x) => (
            <CardRoteiro key={x.id} x={x} produzindo={produzindo}
              onStatus={(st, ok) => acao(() => api.post(`/conteudo/roteiros/${r.id}/${x.id}/status`, { status: st }), ok)}
              onProduzir={() => acao(() => api.post(`/conteudo/especificacoes/${convId}/producao`, { message_id: r.id, roteiro_id: x.id }),
                                     "O Claude começou o vídeo")} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

/** Horário perdido (o Forja do PC estava desligado): rodar agora ou pular. O push que chegou leva até aqui. */
function AvisoPerdido({ nome, perdido, onResponder }: {
  nome?: string; perdido: Perdido; onResponder: (acao: "rodar" | "pular", ok: string) => void;
}) {
  return (
    <View style={[card, { borderColor: c.warn }]}>
      <Text style={s.txt}>
        {nome ? `${nome}: ` : ""}o Forja estava desligado às {perdido.slot.slice(11, 16)} e {perdido.trilha === "r" ? "a pesquisa" : "o vídeo"} de hoje não rodou.
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Botao rotulo="Pular" flex onPress={() => onResponder("pular", "Pulado")} />
        <Botao rotulo="Rodar agora" icone={<Play size={16} color={c.accentFg} />} primario flex
               onPress={() => onResponder("rodar", "Começou no PC")} />
      </View>
    </View>
  );
}

/** O automático escolheu o roteiro e parou ("Deixa pronto"): um toque e o Claude faz o vídeo. */
function AvisoPronto({ nome, pronto, onGerar }: { nome?: string; pronto: Pronto; onGerar: () => void }) {
  return (
    <View style={[card, { borderColor: c.accent }]}>
      <Text style={s.txt}>{nome ? `${nome}: ` : ""}roteiro pronto — {pronto.titulo}</Text>
      <Botao rotulo="Gerar o vídeo" icone={<Play size={16} color={c.accentFg} />} primario onPress={onGerar} />
    </View>
  );
}

function CardProducao({ p, onCancelar, onAssistir, onVozFinal, livre }:
  { p: Producao; onCancelar: () => void; onAssistir: () => void; onVozFinal: () => void; livre: boolean }) {
  const [confirmando, setConfirmando] = useState(false);   // gasta créditos do ElevenLabs: dois toques
  const cor = p.status === "ok" ? c.ok : p.status === "rodando" ? c.info : p.status === "erro" ? c.err : c.muted;
  const rotulo = { rodando: "produzindo", ok: "vídeo pronto", erro: "não terminou", cancelado: "cancelada" }[p.status] ?? p.status;
  return (
    <View style={card}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Filme size={16} color={c.muted} />
        <Text style={[s.txt, { flex: 1, fontWeight: "600" }]} numberOfLines={2}>{(p.versao ?? 1) > 1 ? `v${p.versao} · ` : ""}{p.titulo}</Text>
      </View>
      <Text style={[s.muted, { color: cor }]}>{rotulo} · {relogio(p.segundos)} · {dataCurta(p.criado)}</Text>
      {!!p.aviso && <Text style={[s.muted, { color: c.warn }]}>{p.aviso}</Text>}
      {!!p.entregue && <Text style={[s.faint, { fontFamily: mono }]} numberOfLines={2}>{p.entregue}</Text>}
      {p.status === "rodando" && p.log.slice(-3).map((l, i) => (
        <Text key={i} style={[s.faint, { fontFamily: mono, fontSize: 11 }]} numberOfLines={1}>{l}</Text>
      ))}
      {p.status === "rodando" && <Botao rotulo="Cancelar" icone={<Square size={14} color={c.fg} />} altura={32} onPress={onCancelar} />}
      {p.status === "ok" && !!p.entregue && (
        <Botao primario rotulo="Assistir, salvar ou pedir mudanças" icone={<Play size={16} color={c.accentFg} />} onPress={onAssistir} />
      )}
      {p.status === "ok" && p.voz_final === "pendente" && (
        <View style={{ gap: 6 }}>
          <Text style={s.muted}>Versão de validação com o Edge. Aprovou? Troque só a voz pela do ElevenLabs.</Text>
          <Botao primario rotulo={confirmando ? "Toque de novo: gasta créditos" : "Gerar voz final (ElevenLabs)"} desabilitado={!livre}
                 onPress={() => { if (!confirmando) { setConfirmando(true); return; } setConfirmando(false); onVozFinal(); }} />
        </View>
      )}
      {p.status === "ok" && <ParaYoutube id={p.id} />}
    </View>
  );
}

/** Título e descrição prontos para colar no app do YouTube: um toque copia. */
function ParaYoutube({ id }: { id: number }) {
  const [pub, setPub] = useState<{ titulo: string; descricao: string; titulos?: string[] } | null>(null);
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    api.get<{ titulo: string; descricao: string; titulos?: string[] }>(`/conteudo/producao/${id}/publicacao`).then(setPub).catch(() => setPub(null));
  }, [id]);
  if (!pub) return null;
  const copia = (texto: string, ok: string) => Clipboard.setStringAsync(texto).then(() => toast(ok));
  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10 }}>
      <Text style={s.secao}>PARA O YOUTUBE</Text>
      <Pressable onPress={() => copia(pub.titulo, "Título copiado")} style={{ gap: 2 }}>
        <Text style={[s.txt, { fontWeight: "600" }]}>{pub.titulo}</Text>
        <Text style={s.faint}>toque para copiar o título</Text>
      </Pressable>
      {(pub.titulos ?? []).map((t) => (
        <Pressable key={t} onPress={() => copia(t, "Título copiado")}>
          <Text style={s.muted}>outra opção: {t}</Text>
        </Pressable>
      ))}
      <Pressable onPress={() => setAberto(!aberto)}>
        <Text style={[s.muted, { fontSize: 13, lineHeight: 19 }]} numberOfLines={aberto ? undefined : 4}>{pub.descricao}</Text>
        <Text style={[s.faint, { marginTop: 2 }]}>{aberto ? "recolher" : "ver a descrição inteira"}</Text>
      </Pressable>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Botao flex rotulo="Copiar título" icone={<Copy size={15} color={c.fg} />} onPress={() => copia(pub.titulo, "Título copiado")} />
        <Botao flex rotulo="Copiar descrição" icone={<Copy size={15} color={c.fg} />} onPress={() => copia(pub.descricao, "Descrição copiada")} />
      </View>
    </View>
  );
}

function CardRoteiro({ x, produzindo, onStatus, onProduzir }: {
  x: Roteiro; produzindo: boolean; onStatus: (st: Roteiro["status"], ok?: string) => void; onProduzir: () => void;
}) {
  const [aberto, setAberto] = useState(x.status === "aprovado");
  const travado = x.status === "produzido";
  const corConf = x.confianca >= 4 ? c.ok : x.confianca <= 2 ? c.err : c.warn;
  const borda = x.status === "aprovado" ? c.ok : x.status === "produzido" ? c.info : c.line;
  return (
    <View style={[card, { borderColor: borda, opacity: x.status === "descartado" ? 0.55 : 1 }]}>
      <Pressable onPress={() => setAberto(!aberto)} style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {x.status === "aprovado" && <Selo t="aprovado" cor={c.ok} fundo={c.okSoft} />}
          {x.status === "produzido" && <Selo t="virou vídeo" cor={c.info} />}
          {!!x.repetido && <Selo t="repete vídeo já feito" cor={c.warn} />}
          {!!x.nota && <Selo t={`editor ${x.nota.total.toLocaleString("pt-BR")}${x.nota.fatos <= 2 ? " · fatos fracos" : ""}`}
                             cor={x.nota.fatos <= 2 ? c.err : c.muted} />}
          <Selo t={`confiança ${CONFIANCA[x.confianca]}`} cor={corConf} />
          <Selo t={`~${x.segundos}s`} />
        </View>
        <Text style={[s.txt, { fontWeight: "600" }]}>{x.titulo_youtube || x.titulo}</Text>
        <Text style={s.muted}>{x.ideia}</Text>
      </Pressable>
      {aberto && (
        <View style={{ gap: 8 }}>
          <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: 10, padding: 10, gap: 6 }}>
            <Text style={s.faint}>A NOTÍCIA{x.noticia.data ? ` · ${x.noticia.data}` : ""}</Text>
            <Text style={s.txt}>{x.noticia.resumo}</Text>
            {x.noticia.fontes.map((f) => (
              <Pressable key={f.url} onPress={() => Linking.openURL(f.url)} style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <Externo size={13} color={c.accentText} />
                <Text style={{ color: c.accentText, fontSize: 12.5, flex: 1 }} numberOfLines={1}>{f.titulo}</Text>
              </Pressable>
            ))}
            {!!x.motivo_confianca && <Text style={s.faint}>{x.motivo_confianca}</Text>}
          </View>
          {x.cenas.map((ce) => (
            <View key={ce.id} style={{ flexDirection: "row", gap: 8 }}>
              <Text style={[s.faint, { fontFamily: mono, width: 64, fontSize: 11 }]} numberOfLines={1}>{ce.id}</Text>
              <Text style={[s.txt, { flex: 1 }]}>{ce.texto}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        {x.status !== "aprovado" ? (
          <Botao rotulo="Aprovar" icone={<Check size={14} color={c.fg} />} altura={32} desabilitado={travado}
                 onPress={() => onStatus("aprovado", "Aprovado para o vídeo")} />
        ) : (
          <Botao rotulo="Tirar aprovação" altura={32} onPress={() => onStatus("novo")} />
        )}
        {x.status !== "descartado" ? (
          <Botao rotulo="Descartar" icone={<X size={14} color={c.fg} />} altura={32} desabilitado={travado} onPress={() => onStatus("descartado")} />
        ) : (
          <Botao rotulo="Recuperar" altura={32} onPress={() => onStatus("novo")} />
        )}
        <Botao rotulo="Produzir agora" icone={<Star size={14} color={c.fg} />} altura={32}
               desabilitado={travado || produzindo || x.status === "descartado"} onPress={onProduzir} />
      </View>
    </View>
  );
}
