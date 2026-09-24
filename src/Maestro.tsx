import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type Msg } from "./api";
import Chat, { type Conv, Transcricao } from "./Chat";
import Markdown from "./Markdown";
import { pergunta } from "./Dialogo";
import { Deslizante } from "./ui";
import { c, mono, s } from "./tema";

// Board do Maestro (taskdb.board / MaestroView.tsx do desktop).
type Tentativa = { n: number; status: string; worker?: { level?: string; model?: string }; error?: string | null; seconds?: number;
                   tokens?: number; result?: { summary?: string }; has_transcript?: boolean; transcript?: Msg[] };
type Tarefa = { code: string; title: string; status: string; depends_on: string[]; model_slot?: string; attempt_count: number;
                max_attempts: number; blocked_reason?: string; contract?: Record<string, any>; attempts: Tentativa[] };
type Board = { features: { id: number; title: string; status: string; tasks: Tarefa[] }[]; counts: Record<string, number>;
               total: number; done: number; open: number };

// Mesmos símbolos e rótulos do desktop: a árvore é lida de relance.
const ESTADO: Record<string, [string, string, string]> = {
  pending: ["○", c.faint, "na fila"], queued: ["◔", c.muted, "aguardando"], loading_model: ["◑", c.amber, "carregando modelo"],
  implementing: ["⟳", c.sky, "implementando"], testing: ["⟳", c.sky, "testando"], reviewing: ["◆", "#a78bfa", "esperando revisão"],
  completed: ["✓", c.green, "concluída"], failed: ["✗", c.red, "falhou"], blocked: ["▣", c.amber, "bloqueada"],
  needs_human: ["?", c.amber, "precisa de você"], cancelled: ["—", c.faint, "cancelada"],
};
const ATIVOS = ["queued", "loading_model", "implementing", "testing", "reviewing"];

/** Maestro no celular: o chat com a Maestro, a árvore de tarefas e o Worker em ação, em abas. */
export default function Maestro(props: {
  conv: Conv | null; workspace?: string | null; onCriada: (c: Conv) => void; onTelaCheia: (b: boolean) => void;
  pasta?: string; onPasta: () => void; onTurno: () => void;
}) {
  const [aba, setAba] = useState<"chat" | "tarefas" | "worker">("chat");
  const [convId, setConvId] = useState<number | null>(props.conv?.id ?? null);
  const [board, setBoard] = useState<Board | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [doWorker, setDoWorker] = useState<string | null>(null); // tarefa escolhida na árvore; sem escolha, a ativa

  const buscaBoard = useCallback(() => {
    if (convId != null) api.get<Board>(`/maestro/${convId}/board`).then(setBoard).catch(() => {});
  }, [convId]);
  useEffect(() => {
    buscaBoard();
    const t = setInterval(buscaBoard, 2000); // o desktop também consulta o board a cada 2 s
    return () => clearInterval(t);
  }, [buscaBoard]);

  const tarefas = board?.features.flatMap((f) => f.tasks) ?? [];
  const ativa = tarefas.find((t) => ATIVOS.includes(t.status)) ?? null;

  return (
    <View style={{ flex: 1 }}>
      {convId != null && (
        <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingBottom: 8 }}>
          {([["chat", "Chat"], ["tarefas", board ? `Tarefas ${board.done}/${board.total}` : "Tarefas"],
             ["worker", ativa ? `Worker · ${ativa.code}` : "Worker"]] as const).map(([id, rotulo]) => (
            <Pressable key={id} onPress={() => { if (id === "worker") setDoWorker(null); setAba(id); }}
                       style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                                backgroundColor: aba === id ? c.raised : "transparent" }}>
              {id === "worker" && ativa && <ActivityIndicator size="small" color={c.sky} />}
              <Text style={{ color: aba === id ? c.fg : c.muted, fontSize: 14 }}>{rotulo}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={{ flex: 1, display: aba === "chat" ? "flex" : "none" }}>
        <Chat conv={props.conv} kind="maestro" workspace={props.workspace} onTelaCheia={props.onTelaCheia} pasta={props.pasta}
              onPasta={props.onPasta} onTurno={() => { props.onTurno(); buscaBoard(); }}
              onCriada={(nova) => { setConvId(nova.id); props.onCriada(nova); }} />
      </View>
      {aba === "tarefas" && <Arvore board={board} onAbre={setAberta} onWorker={(code) => { setDoWorker(code); setAba("worker"); }} />}
      {aba === "worker" && convId != null && (
        <Worker conv={convId} tarefas={tarefas} escolhida={doWorker} onEscolhe={setDoWorker}
                tarefa={tarefas.find((t) => t.code === doWorker) ?? ativa ?? tarefas[tarefas.length - 1] ?? null} />
      )}
      {convId != null && <DetalheTarefa conv={convId} code={aberta} onFecha={() => setAberta(null)} onMudou={buscaBoard} />}
    </View>
  );
}

function Arvore({ board, onAbre, onWorker }: { board: Board | null; onAbre: (code: string) => void; onWorker: (code: string) => void }) {
  if (!board) return <ActivityIndicator style={{ marginTop: 40 }} color={c.muted} />;
  if (!board.total)
    return <Text style={[s.muted, { padding: 20, lineHeight: 20 }]}>A Maestro ainda não planejou tarefas. Peça no chat o que você quer construir.</Text>;
  const pct = board.total ? board.done / board.total : 0;
  return (
    <ScrollView contentContainerStyle={{ padding: 14, gap: 16 }}>
      <View style={{ gap: 8 }}>
        <View style={{ height: 6, backgroundColor: c.raised, borderRadius: 3 }}>
          <View style={{ height: 6, width: `${Math.round(pct * 100)}%`, backgroundColor: c.green, borderRadius: 3 }} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {Object.entries(board.counts).map(([st, n]) => (
            <Text key={st} style={{ color: ESTADO[st]?.[1] ?? c.muted, fontSize: 12.5 }}>{ESTADO[st]?.[0]} {n} {ESTADO[st]?.[2] ?? st}</Text>
          ))}
        </View>
      </View>
      {board.features.map((f) => (
        <View key={f.id} style={{ gap: 4 }}>
          <Text style={s.secao}>{f.title}</Text>
          {f.tasks.map((t) => {
            const [marca, cor, rotulo] = ESTADO[t.status] ?? ["•", c.muted, t.status];
            return (
              <Pressable key={t.code} onPress={() => onAbre(t.code)}
                         style={({ pressed }) => ({ flexDirection: "row", gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12,
                           backgroundColor: pressed ? c.surface : "transparent", alignItems: "flex-start" })}>
                <Text style={{ color: cor, fontSize: 16, width: 18, textAlign: "center" }}>{marca}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[s.txt, { fontSize: 14.5 }]} numberOfLines={2}>{t.title}</Text>
                  <Text style={{ color: c.faint, fontSize: 12 }}>
                    <Text style={{ fontFamily: mono }}>{t.code}</Text> · <Text style={{ color: cor }}>{rotulo}</Text>
                    {t.attempt_count ? ` · tentativa ${t.attempt_count}/${t.max_attempts}` : ""}
                    {t.depends_on?.length ? ` · depois de ${t.depends_on.join(", ")}` : ""}
                  </Text>
                </View>
                {t.attempt_count > 0 && (
                  // O chat do Worker desta tarefa (a aba Worker sozinha só mostra a tarefa em andamento).
                  <Pressable onPress={() => onWorker(t.code)} hitSlop={8}
                             style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderColor: c.line, borderWidth: 1, alignSelf: "center" }}>
                    <Text style={{ color: c.muted, fontSize: 12 }}>Worker</Text>
                  </Pressable>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

/** Chat de um Worker: a tarefa escolhida na árvore (ou a em andamento), com a tentativa escolhida; atualiza a cada 2 s. */
function Worker({ conv, tarefa, tarefas, escolhida, onEscolhe }:
  { conv: number; tarefa: Tarefa | null; tarefas: Tarefa[]; escolhida: string | null; onEscolhe: (code: string | null) => void }) {
  const [det, setDet] = useState<Tarefa | null>(null);
  const [n, setN] = useState<number | null>(null); // tentativa; null = a última
  useEffect(() => {
    setN(null);
    if (!tarefa) return;
    const busca = () => api.get<Tarefa>(`/maestro/${conv}/task/${tarefa.code}`).then(setDet).catch(() => {});
    busca();
    if (!ATIVOS.includes(tarefa.status)) return;
    const t = setInterval(busca, 2000);
    return () => clearInterval(t);
  }, [conv, tarefa?.code, tarefa?.status]);
  if (!tarefa) return <Text style={[s.muted, { padding: 20 }]}>Nenhum Worker trabalhou ainda nesta conversa.</Text>;
  const tent = det?.code === tarefa.code ? det.attempts : [];
  const at = tent.find((a) => a.n === n) ?? tent[tent.length - 1];
  const [marca, cor, rotulo] = ESTADO[tarefa.status] ?? ["•", c.muted, tarefa.status];
  const comTentativa = tarefas.filter((t) => t.attempt_count > 0);
  return (
    <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
      {comTentativa.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {comTentativa.map((t) => (
            <Pressable key={t.code} onPress={() => onEscolhe(t.code)}
                       style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: t.code === tarefa.code ? c.raised : c.surface }}>
              <Text style={{ color: t.code === tarefa.code ? c.fg : c.muted, fontSize: 12.5, fontFamily: mono }}>{t.code}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Text style={[s.txt, { fontWeight: "600" }]}>{tarefa.title}</Text>
      <Text style={{ color: cor, fontSize: 13 }}>{marca} {rotulo}{at?.worker?.model ? ` · ${at.worker.model}` : ""}</Text>
      {tent.length > 1 && (
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {tent.map((a) => (
            <Pressable key={a.n} onPress={() => setN(a.n)}
                       style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: a.n === at?.n ? c.fg : c.raised }}>
              <Text style={{ color: a.n === at?.n ? "#000" : ESTADO[a.status]?.[1] ?? c.muted, fontSize: 12.5 }}>
                #{a.n} {ESTADO[a.status]?.[0] ?? ""}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {at?.transcript?.length ? <Transcricao msgs={at.transcript} /> : (
        <Text style={s.faint}>{ATIVOS.includes(tarefa.status) ? "O Worker está trabalhando; a transcrição aparece aqui ao fim da tentativa." : "Sem transcrição."}</Text>
      )}
      {!!at?.result?.summary && <Markdown texto={at.result.summary} />}
    </ScrollView>
  );
}

/** Folha da tarefa: contrato, tentativas e as ações do desktop (reenviar, desbloquear, assumir, cancelar). */
function DetalheTarefa({ conv, code, onFecha, onMudou }: { conv: number; code: string | null; onFecha: () => void; onMudou: () => void }) {
  const inset = useSafeAreaInsets();
  const [t, setT] = useState<Tarefa | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    setT(null);
    setErro("");
    if (code) api.get<Tarefa>(`/maestro/${conv}/task/${code}`).then(setT).catch((e) => setErro(e.message));
  }, [code]);

  async function muda(patch: Record<string, unknown>, avisaMaestro?: string) {
    try {
      const r = await api.post<{ task: Tarefa }>(`/maestro/${conv}/task/${code}`, patch);
      setT((x) => (x ? { ...x, ...r.task } : r.task));
      if (avisaMaestro) {
        // Como o "Reenviar ao Worker" do desktop: a Maestro é quem despacha (run_task), então ela recebe o pedido.
        const live = await api.get<{ run: { run_id: string } | null }>(`/conversations/${conv}/live`);
        if (live.run) await api.post(`/runs/${live.run.run_id}/queue`, { content: avisaMaestro });
        else {
          const { defaults } = await api.get<{ defaults: Record<string, string> }>("/mobile");
          if (!defaults.model) throw new Error("Rode um turno no desktop antes: o celular usa o mesmo modelo.");
          api.post(`/conversations/${conv}/run`, { ...defaults, content: avisaMaestro }).catch(() => {});
        }
      }
      onMudou();
    } catch (e: any) {
      setErro(e.message);
    }
  }
  const confirma = (titulo: string, msg: string, faz: () => void) =>
    pergunta(titulo, msg, [{ texto: "Voltar", estilo: "cancelar" }, { texto: titulo, acao: faz }]);

  const contrato = t?.contract ?? {};
  return (
    <Deslizante aberta={!!code} onFecha={onFecha}>
      <View style={{ height: "82%", backgroundColor: c.side, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderColor: c.line, borderWidth: 1 }}>
        {!t ? <View style={{ padding: 20 }}>{erro ? <Text style={{ color: c.red }}>{erro}</Text> : <ActivityIndicator color={c.muted} />}</View> : (
          <ScrollView contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: inset.bottom + 20 }}>
            <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12 }}>{t.code}</Text>
            <Text style={[s.txt, { fontSize: 17, fontWeight: "600" }]}>{t.title}</Text>
            <Text style={{ color: ESTADO[t.status]?.[1] ?? c.muted }}>{ESTADO[t.status]?.[0]} {ESTADO[t.status]?.[2] ?? t.status}
              {t.model_slot ? <Text style={s.faint}> · slot {t.model_slot}</Text> : null}</Text>
            {!!t.blocked_reason && <Text style={{ color: c.amber, fontSize: 13 }}>{t.blocked_reason}</Text>}
            {!!erro && <Text style={{ color: c.red, fontSize: 13 }}>{erro}</Text>}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {["failed", "blocked", "needs_human", "cancelled", "completed"].includes(t.status) && (
                <Pressable style={s.btn} onPress={() => confirma("Reenviar", "A tarefa volta para a fila e a Maestro manda um Worker de novo.",
                  () => muda({ status: "queued" }, `Reexecute a tarefa ${t.code} com run_task.`))}>
                  <Text style={s.btnTxt}>Reenviar ao Worker</Text>
                </Pressable>
              )}
              {["blocked", "needs_human"].includes(t.status) && (
                <Pressable style={s.btnSec} onPress={() => muda({ status: "pending" })}><Text style={s.btnSecTxt}>Devolver à Maestro</Text></Pressable>
              )}
              {!["completed", "cancelled", "needs_human"].includes(t.status) && (
                <Pressable style={s.btnSec} onPress={() => muda({ status: "needs_human", reason: "Assumida pelo usuário" })}>
                  <Text style={s.btnSecTxt}>Assumir</Text>
                </Pressable>
              )}
              {t.status !== "cancelled" && (
                <Pressable style={s.btnSec} onPress={() => confirma("Cancelar tarefa", "A Maestro deixa de despachar esta tarefa.",
                  () => muda({ status: "cancelled" }))}>
                  <Text style={[s.btnSecTxt, { color: c.red }]}>Cancelar tarefa</Text>
                </Pressable>
              )}
            </View>
            {!!contrato.goal && <><Text style={s.secao}>Objetivo</Text><Markdown texto={String(contrato.goal)} /></>}
            {Array.isArray(contrato.requirements) && contrato.requirements.length > 0 && (
              <><Text style={s.secao}>Requisitos</Text><Markdown texto={contrato.requirements.map((r: string) => `- ${r}`).join("\n")} /></>
            )}
            {Array.isArray(contrato.acceptance_criteria) && contrato.acceptance_criteria.length > 0 && (
              <><Text style={s.secao}>Critérios de aceite</Text>
                <Markdown texto={contrato.acceptance_criteria.map((r: any) => `- ${typeof r === "string" ? r : r.command ?? JSON.stringify(r)}`).join("\n")} /></>
            )}
            {Array.isArray(contrato.relevant_files) && contrato.relevant_files.length > 0 && (
              <><Text style={s.secao}>Arquivos</Text><Text style={[s.muted, { fontFamily: mono, fontSize: 12.5 }]}>{contrato.relevant_files.join("\n")}</Text></>
            )}
            {t.attempts.length > 0 && <Text style={s.secao}>Tentativas</Text>}
            {t.attempts.map((a) => (
              <View key={a.n} style={{ borderColor: c.line, borderWidth: 1, borderRadius: 12, padding: 10, gap: 4 }}>
                <Text style={{ color: ESTADO[a.status]?.[1] ?? c.muted, fontSize: 13 }}>
                  #{a.n} · {ESTADO[a.status]?.[2] ?? a.status}{a.worker?.model ? ` · ${a.worker.model}` : ""}
                  {a.seconds ? ` · ${Math.round(a.seconds)}s` : ""}{a.tokens ? ` · ${a.tokens} tokens` : ""}
                </Text>
                {!!a.error && <Text style={{ color: c.red, fontSize: 12.5 }}>{a.error}</Text>}
                {!!a.result?.summary && <Text style={[s.muted, { fontSize: 12.5 }]} numberOfLines={6}>{a.result.summary}</Text>}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Deslizante>
  );
}
