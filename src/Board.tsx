import { useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { api } from "./api";
import { pergunta } from "./Dialogo";
import { c, mono, s } from "./tema";
import { Chip, Folha, Lista } from "./ui";

/** Board do projeto (E15-A), para triar pelo celular: aceitar, rejeitar e iniciar. Mesma API do desktop. */

type Evidencia = { arquivo?: string; linha?: number; trecho?: string; comando?: string; saida?: string };
type Issue = {
  id: number; titulo: string; descricao: string; tipo: string; area: string; severidade: number; status: string;
  evidencias: Evidencia[]; origem: string; sumiu: boolean; conversa_id: number | null;
  modo_sugerido: "agent" | "maestro"; historico: { quando: string; texto: string }[];
};

const COLUNAS = [
  { id: "novo", nome: "Novo" }, { id: "backlog", nome: "Backlog" }, { id: "andamento", nome: "Em andamento" },
  { id: "revisao", nome: "Revisão" }, { id: "concluido", nome: "Concluído" },
];
const COR: Record<string, string> = { bugfix: c.red, feature: c.sky, improvement: c.green, visual: "#e879f9",
  todo: c.amber, seguranca: "#fb923c" };
const NOME: Record<string, string> = { bugfix: "bug", feature: "feature", improvement: "melhoria", visual: "visual",
  todo: "todo", seguranca: "segurança" };

/** Card que a IA criou (board_card) no fim da resposta dela, como no desktop (CardNoChat). Tocar abre o board nele. */
export type CardMini = { id: number; titulo: string; tipo: string; area: string; severidade: number; status: string;
  projeto: string; evidencia?: Evidencia | null };

const NOME_STATUS: Record<string, string> = Object.fromEntries(COLUNAS.map((k) => [k.id, k.nome]));

export function CardNoChat({ card, onAbre }: { card: CardMini; onAbre?: (c: CardMini) => void }) {
  const [k, setK] = useState(card);
  const [erro, setErro] = useState("");
  // O status muda depois (Iniciar, Revisão): o do meta é o do momento em que a IA criou.
  useEffect(() => { api.get<CardMini & { evidencias?: Evidencia[] }>(`/board/issues/${card.id}`)
    .then((x) => setK({ ...card, ...x, evidencia: card.evidencia ?? x.evidencias?.find((e) => e.arquivo) })).catch(() => {}); }, [card.id]);
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
      <Pressable onPress={() => onAbre?.(k)} style={{ backgroundColor: c.surface, borderRadius: 12, padding: 10, gap: 6,
                                                        borderWidth: 1, borderColor: c.line }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Text style={{ color: COR[k.tipo] ?? c.muted, fontSize: 12 }}>{NOME[k.tipo] ?? k.tipo}</Text>
          <Text style={s.faint}>{k.area}</Text>
          <View style={{ flex: 1 }} />
          <Text style={s.faint}>{"●".repeat(4 - k.severidade)} #{k.id} · {NOME_STATUS[k.status] ?? k.status}</Text>
        </View>
        <Text style={[s.txt, { fontSize: 14, lineHeight: 20 }]} numberOfLines={2}>{k.titulo}</Text>
        {!!ev?.arquivo && (
          <Text style={{ fontFamily: mono, fontSize: 12, color: c.muted }} numberOfLines={1}>
            {ev.arquivo}{ev.linha ? `:${ev.linha}` : ""}
          </Text>
        )}
        {["novo", "backlog"].includes(k.status) && (
          <Pressable style={[s.btn, { paddingVertical: 6, alignSelf: "flex-start" }]} onPress={iniciar}>
            <Text style={[s.btnTxt, { fontSize: 13 }]}>Iniciar</Text>
          </Pressable>
        )}
      </Pressable>
      {!!erro && <Text style={[s.muted, { color: c.red }]}>{erro}</Text>}
    </View>
  );
}

export default function Board({ onAbreConversa, foco }: { onAbreConversa: (id: number, kind: string) => void;
  foco?: { id: number; projeto: string } | null }) {
  const [projetos, setProjetos] = useState<{ projeto: string; nome: string }[]>([]);
  const [projeto, setProjeto] = useState<string | null>(foco?.projeto ?? null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState<number | null>(foco?.id ?? null);
  const [escolhe, setEscolhe] = useState(false);
  const [carimbo, setCarimbo] = useState("");

  useEffect(() => {
    api.get<{ projeto: string; nome: string }[]>("/board/projetos")
      .then((l) => { setProjetos(l); setProjeto((p) => p ?? l[0]?.projeto ?? null); })
      .catch((e) => setErro(e.message));
  }, []);

  const carrega = () => {
    if (!projeto) return;
    api.get<{ issues: Issue[]; varredura: { rodando: boolean } | null }>(`/board?pasta=${encodeURIComponent(projeto)}`)
      .then((r) => { setIssues(r.issues); setRodando(!!r.varredura?.rodando); })
      .catch((e) => setErro(e.message));
  };
  useEffect(carrega, [projeto, carimbo]);
  // Ao vivo com o PC: o carimbo do board no /activity muda quando um card muda em qualquer aparelho.
  useEffect(() => {
    const t = setInterval(() => {
      api.get<{ board?: string }>("/activity").then((a) => a.board && setCarimbo(a.board)).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, []);

  const acao = (fn: () => Promise<unknown>) => {
    setErro("");
    return fn().catch((e) => setErro(e.message)).finally(carrega);
  };
  const card = issues.find((i) => i.id === aberto);

  const rejeitar = (i: Issue) => pergunta("Rejeitar card?", i.titulo, [
    { texto: "Cancelar", estilo: "cancelar" },
    ...[["nao_e_bug", "Não é bug"], ["nao_quero", "Não quero"], ["duplicado", "Duplicado"]].map(([id, texto]) => ({
      texto, acao: () => acao(() => api.post(`/board/issues/${i.id}/rejeitar`, { motivo: id })) })),
  ]);
  const iniciar = (i: Issue) => pergunta("Iniciar card", i.titulo, [
    { texto: "Cancelar", estilo: "cancelar" },
    ...(["agent", "maestro"] as const).map((m) => ({
      texto: `${m === "agent" ? "Agente" : "Maestro"}${i.modo_sugerido === m ? " (sugerido)" : ""}`,
      acao: () => acao(() => api.post(`/board/issues/${i.id}/iniciar`, { modo: m })) })),
  ]);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 8, alignItems: "center" }}>
        <Chip rotulo={projetos.find((p) => p.projeto === projeto)?.nome ?? "Projeto"} onPress={() => setEscolhe(true)} />
        <View style={{ flex: 1 }} />
        <Chip rotulo={rodando ? "Varrendo…" : "Varrer agora"} onPress={() => !rodando && projeto
          && acao(() => api.post("/board/varrer", { pasta: projeto }))} />
      </View>
      {!!erro && <Text style={[s.muted, { color: c.red, paddingHorizontal: 12 }]}>{erro}</Text>}
      <ScrollView contentContainerStyle={{ padding: 12, paddingTop: 0, gap: 14 }}
                  refreshControl={<RefreshControl refreshing={false} onRefresh={carrega} />}>
        {!projeto && <Text style={s.muted}>Nenhum projeto ainda: abra uma conversa de Agente ou Maestro numa pasta.</Text>}
        {COLUNAS.map((col) => {
          const itens = issues.filter((i) => i.status === col.id);
          if (!itens.length) return null;
          return (
            <View key={col.id} style={{ gap: 6 }}>
              <Text style={s.secao}>{col.nome} · {itens.length}</Text>
              {itens.map((i) => (
                <Pressable key={i.id} onPress={() => setAberto(i.id)}
                           style={{ backgroundColor: c.surface, borderRadius: 12, padding: 10, gap: 6 }}>
                  <Text style={[s.txt, { fontSize: 14, lineHeight: 20 }]}>{i.titulo}</Text>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Text style={{ color: COR[i.tipo] ?? c.muted, fontSize: 12 }}>{NOME[i.tipo] ?? i.tipo}</Text>
                    <Text style={s.faint}>{i.area}</Text>
                    <Text style={s.faint}>{"●".repeat(4 - i.severidade)}</Text>
                    {i.sumiu && <Text style={{ color: c.green, fontSize: 12 }}>resolvido?</Text>}
                  </View>
                  {i.status === "novo" && (
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable style={[s.btn, { paddingVertical: 6 }]}
                                 onPress={() => acao(() => api.patch(`/board/issues/${i.id}`, { status: "backlog" }))}>
                        <Text style={[s.btnTxt, { fontSize: 13 }]}>Aceitar</Text>
                      </Pressable>
                      <Pressable style={[s.btnSec, { paddingVertical: 6 }]} onPress={() => rejeitar(i)}>
                        <Text style={[s.btnSecTxt, { fontSize: 13 }]}>Rejeitar</Text>
                      </Pressable>
                    </View>
                  )}
                  {i.status === "backlog" && (
                    <Pressable style={[s.btn, { paddingVertical: 6, alignSelf: "flex-start" }]} onPress={() => iniciar(i)}>
                      <Text style={[s.btnTxt, { fontSize: 13 }]}>Iniciar</Text>
                    </Pressable>
                  )}
                </Pressable>
              ))}
            </View>
          );
        })}
      </ScrollView>

      <Folha aberta={escolhe} titulo="Projeto" onFecha={() => setEscolhe(false)}>
        <Lista opcoes={projetos.map((p) => ({ id: p.projeto, rotulo: p.nome, dica: p.projeto }))} valor={projeto ?? ""}
               onEscolhe={(p) => { setProjeto(p); setEscolhe(false); }} />
      </Folha>

      <Folha aberta={!!card} titulo={card ? `#${card.id} · ${NOME[card.tipo] ?? card.tipo}` : ""} onFecha={() => setAberto(null)} altura="80%">
        {card && (
          <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 20 }}>
            <Text style={[s.txt, { fontWeight: "600" }]}>{card.titulo}</Text>
            {!!card.descricao && <Text style={s.muted}>{card.descricao}</Text>}
            {card.evidencias.map((e, k) => (
              <Text key={k} style={{ fontFamily: mono, fontSize: 12, color: c.muted, backgroundColor: c.raised, padding: 8, borderRadius: 8 }}
                    numberOfLines={8}>
                {e.arquivo ? `${e.arquivo}${e.linha ? `:${e.linha}` : ""}\n${e.trecho ?? ""}` : `${e.comando ? `$ ${e.comando}\n` : ""}${e.saida ?? ""}`}
              </Text>
            ))}
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {card.status === "revisao" && (
                <Pressable style={s.btn} onPress={() => acao(() => api.patch(`/board/issues/${card.id}`, { status: "concluido" }))}>
                  <Text style={s.btnTxt}>Aprovar</Text>
                </Pressable>
              )}
              {card.conversa_id && (
                <Pressable style={s.btnSec} onPress={() => { setAberto(null); onAbreConversa(card.conversa_id!, card.modo_sugerido); }}>
                  <Text style={s.btnSecTxt}>Abrir conversa</Text>
                </Pressable>
              )}
            </View>
            <Text style={s.secao}>Histórico</Text>
            {[...card.historico].reverse().map((h, k) => (
              <Text key={k} style={s.faint}>{h.quando.replace("T", " ").slice(5, 16)} · {h.texto}</Text>
            ))}
          </ScrollView>
        )}
      </Folha>
    </View>
  );
}
