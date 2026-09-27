import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { Text } from "./Texto";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, type Msg } from "./api";
import Chat, { type Conv, Transcricao } from "./Chat";
import Markdown from "./Markdown";
import { pergunta } from "./Dialogo";
import { Balanca, Check, Cpu, Cubo, Divide, Lapis, Pulso, Refresh, Relogio, Seta, Undo, X } from "./icones";
import ModelosFolha from "./Modelos";
import { Campo, Deslizante, Folha, Pulsa, Seletor, toast } from "./ui";
import { c, mono, s } from "./tema";

// Board do Maestro (taskdb.board / MaestroView.tsx do desktop).
type Tentativa = { n: number; status: string; worker?: { level?: string; model?: string }; error?: string | null; seconds?: number;
                   tokens?: number; result?: { summary?: string }; has_transcript?: boolean; transcript?: Msg[] };
type Tarefa = { code: string; title: string; status: string; depends_on: string[]; model_slot?: string; attempt_count: number;
                max_attempts: number; blocked_reason?: string; contract?: Record<string, any>; attempts: Tentativa[] };
type Board = { features: { id: number; title: string; status: string; tasks: Tarefa[] }[]; counts: Record<string, number>;
               total: number; done: number; open: number; inicio?: string | null; ultima?: string | null };
type Par = { provider: string; model: string };
type Modelos = { running: boolean; alias: string | null; vram: number | null; vram_free: number | null; lifecycle: string; max_workers: number;
                 manageable: boolean; slots: Record<string, { provider: string; model: string }>; maestro_model?: { provider: string; model: string } | null };

// Rótulo e cor de cada estado (os do desktop); o ícone vem de `iconeEstado`.
const ESTADO: Record<string, [string, string]> = {
  pending: [c.faint, "na fila"], queued: [c.muted, "aguardando"], loading_model: [c.warn, "carregando modelo"],
  implementing: [c.info, "implementando"], testing: [c.info, "testando"], reviewing: [c.agent, "esperando revisão"],
  completed: [c.ok, "concluída"], failed: [c.err, "falhou"], blocked: [c.warn, "bloqueada"],
  needs_human: [c.warn, "precisa de você"], cancelled: [c.faint, "cancelada"],
};
const ATIVOS = ["queued", "loading_model", "implementing", "testing", "reviewing"];
const iconeEstado = (st: string, size = 15) => {
  const cor = ESTADO[st]?.[0] ?? c.muted;
  if (st === "completed") return <Check size={size} color={cor} />;
  if (ATIVOS.includes(st)) return <Pulso size={size} color={cor} />;
  if (st === "failed" || st === "cancelled") return <X size={size} color={cor} />;
  return <Relogio size={size} color={cor} />;
};
const relogio = (inicio: string, fim: number) => {
  const sg = Math.max(0, Math.round((fim - Date.parse(inicio)) / 1000));
  const h = Math.floor(sg / 3600);
  return h ? `${h}h${String(Math.floor((sg % 3600) / 60)).padStart(2, "0")}m` : `${Math.floor(sg / 60)}m${String(sg % 60).padStart(2, "0")}s`;
};

/** Maestro no celular: cabeçalho da execução, e o chat com a Maestro, a árvore de tarefas e o Worker em ação, em abas. */
export default function Maestro(props: {
  conv: Conv | null; workspace?: string | null; onCriada: (c: Conv) => void; onTelaCheia: (b: boolean) => void;
  pasta?: string; onPasta: () => void; onTurno: () => void; onTestarWorker?: (id: string, nome: string, spec?: Par) => void;
}) {
  const [aba, setAba] = useState<"chat" | "tarefas" | "worker">("chat");
  const [convId, setConvId] = useState<number | null>(props.conv?.id ?? null);
  const [board, setBoard] = useState<Board | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [doWorker, setDoWorker] = useState<string | null>(null); // tarefa escolhida na árvore; sem escolha, a ativa
  const [vivo, setVivo] = useState<{ running: boolean; paused: boolean }>({ running: false, paused: false });
  const [vram, setVram] = useState(false);

  const buscaBoard = useCallback(() => {
    if (convId == null) return;
    api.get<Board>(`/maestro/${convId}/board`).then(setBoard).catch(() => {});
    api.get<{ conversations: { id: number; running?: boolean; paused?: boolean }[] }>("/activity")
      .then((a) => { const x = a.conversations.find((k) => k.id === convId); setVivo({ running: !!x?.running, paused: !!x?.paused }); }).catch(() => {});
  }, [convId]);
  useEffect(() => {
    buscaBoard();
    const t = setInterval(buscaBoard, 2000); // o desktop também consulta o board a cada 2 s
    return () => clearInterval(t);
  }, [buscaBoard]);

  const tarefas = board?.features.flatMap((f) => f.tasks) ?? [];
  const ativa = tarefas.find((t) => ATIVOS.includes(t.status)) ?? null;
  async function pausar(sim: boolean) {
    if (convId == null) return;
    const live = await api.get<{ run: { run_id: string } | null }>(`/conversations/${convId}/live`).catch(() => null);
    if (!live?.run) return;
    setVivo((v) => ({ ...v, paused: sim }));
    api.post(`/runs/${live.run.run_id}/pause`, { paused: sim }).catch(() => setVivo((v) => ({ ...v, paused: !sim })));
  }

  return (
    <View style={{ flex: 1 }}>
      {convId != null && (
        <View style={{ paddingHorizontal: 12, gap: 8, paddingBottom: 8 }}>
          <Cabecalho board={board} ativa={ativa} vivo={vivo} onPausar={pausar} onVram={() => setVram(true)} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {([["chat", "Chat"], ["tarefas", board ? `Tarefas ${board.done}/${board.total}` : "Tarefas"],
               ["worker", ativa ? `Worker · ${ativa.code}` : "Worker"]] as const).map(([id, rotulo]) => (
              <Pressable key={id} onPress={() => { if (id === "worker") setDoWorker(null); setAba(id); }}
                         style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 999, flexShrink: 0,
                                  backgroundColor: aba === id ? c.raised : "transparent" }}>
                {id === "worker" && ativa && <Pulsa cor={c.info} lado={6} />}
                <Text style={{ color: aba === id ? c.fg : c.muted, fontSize: 14, fontWeight: aba === id ? "600" : "400" }} numberOfLines={1}>{rotulo}</Text>
              </Pressable>
            ))}
          </ScrollView>
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
      <FolhaVram aberta={vram} onFecha={() => setVram(false)} onTestar={(id, nome, spec) => props.onTestarWorker?.(id, nome, spec)} />
    </View>
  );
}

/** Cabeçalho do Maestro (Cabecalho do MaestroView): status, VRAM, pausar; barra das tarefas e o relógio da execução. */
function Cabecalho({ board, ativa, vivo, onPausar, onVram }: {
  board: Board | null; ativa: Tarefa | null; vivo: { running: boolean; paused: boolean }; onPausar: (sim: boolean) => void; onVram: () => void;
}) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    if (!vivo.running) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [vivo.running]);
  const [status, cor] = ativa ? [`${ativa.code} · ${ESTADO[ativa.status]?.[1] ?? ativa.status}`, ESTADO[ativa.status]?.[0] ?? c.info]
    : vivo.running ? [vivo.paused ? "pausado" : "pensando…", vivo.paused ? c.warn : c.info] : ["parado", c.faint];
  const b = board;
  const fim = vivo.running ? agora : Date.parse(b?.ultima ?? b?.inicio ?? "") || agora;
  const bt = { height: 28, borderRadius: 7, borderWidth: 1, borderColor: c.lineStrong, paddingHorizontal: 9, flexDirection: "row" as const,
               alignItems: "center" as const, gap: 5 };
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: 12, paddingVertical: 9, paddingRight: 10, paddingLeft: 12, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Divide size={15} color={c.agent} />
        <Text style={{ color: cor, fontSize: 13, flex: 1 }} numberOfLines={1}>{status}</Text>
        <Pressable style={bt} onPress={onVram}><Cpu size={12} color={c.muted} /><Text style={{ color: c.fg2, fontSize: 12 }}>VRAM</Text></Pressable>
        {vivo.running && (
          <Pressable style={bt} onPress={() => onPausar(!vivo.paused)}>
            <Text style={{ color: vivo.paused ? c.ok : c.fg2, fontSize: 12 }}>{vivo.paused ? "Retomar" : "Pausar"}</Text>
          </Pressable>
        )}
      </View>
      {!!b?.total && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: c.raised, overflow: "hidden" }}>
            <View style={{ height: 5, width: `${(b.done / b.total) * 100}%`, backgroundColor: c.ok }} />
          </View>
          <Text style={{ color: c.muted, fontSize: 12, fontFamily: mono }}>{b.done}/{b.total} tarefas</Text>
          {!!b.inicio && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Relogio size={12} color={c.faint} />
              <Text style={{ color: c.muted, fontSize: 12, fontFamily: mono }}>{relogio(b.inicio, fim)}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/** Modelo · VRAM (PainelModelos do desktop): a VRAM, os modelos dos Workers e especialistas, o ciclo de vida e a execução. */
const NOME_NIVEL: Record<string, string> = { rapido: "Rápido", capaz: "Capaz", nuvem: "Nuvem (reserva)" };
// O "?" de cada linha: o que faz um modelo ser bom naquele papel e quando o Forja o usa (textos do desktop).
const AJUDA_NIVEL: Record<string, string> = {
  rapido: "Modelo pequeno e veloz. O Forja manda para ele só texto e manutenção (documentação, ajustes simples) quando a Maestro não escolhe; se falhar, a tarefa sobe para o capaz.",
  capaz: "O generalista: resolve qualquer tarefa de código e é o padrão quando nenhum especialista se aplica. Bom capaz = segue o contrato à risca, roda os testes e não inventa API.",
  nuvem: "Reserva paga: só entra quando os outros não estão disponíveis ou falharam. Vazio = nunca gasta API.",
};
const AJUDA_ESPECIALIDADE: Record<string, string> = {
  logica: "Bom em lógica e back-end = acerta regra de negócio e casos de borda (valores zero, vazios, arredondamento), valida entradas e escreve código que passa nos testes. Recebe tarefas de funcionalidade, correção e refatoração.",
  frontend: "Bom em frontend e aparência = escreve HTML/CSS/JS que funciona e fica bonito: layout responsivo, acessibilidade (contraste, foco), consistência com o guia visual. Recebe tarefas de tela (tipo ui) e as que só mexem em arquivos de interface.",
  testes: "Bom em testes = escreve testes a partir do comportamento esperado (não do código), cobre os casos de borda e acha o bug que o teste expõe, sem inventar regra. Recebe tarefas do tipo test.",
  docs: "Bom em documentação = lê o material, resume sem perder o essencial e diz 'não consta' em vez de inventar. Recebe tarefas do tipo docs (README, guias).",
};
type Espec = { id: string; nome: string; quando?: string; provider: string; model: string };

function FolhaVram({ aberta, onFecha, onTestar }: { aberta: boolean; onFecha: () => void; onTestar: (id: string, nome: string, spec?: Par) => void }) {
  const [m, setM] = useState<(Modelos & { workers_do_maestro?: boolean; especialidades?: Espec[] }) | null>(null);
  const [escolhe, setEscolhe] = useState<string | null>(null); // "maestro" | nível | "esp:<id>"
  const [ajuda, setAjuda] = useState<string | null>(null);
  useEffect(() => { if (aberta) api.get<NonNullable<typeof m>>("/maestro/models").then(setM).catch(() => {}); }, [aberta]);
  const salva = (x: Record<string, unknown>) => api.put("/settings", x).then(() => toast("Salvo no PC.")).catch((e) => toast(e.message));
  const usado = m?.vram && m.vram_free != null ? 1 - m.vram_free / m.vram : null;
  const gb = (b: number) => `${(b / 2 ** 30).toFixed(1).replace(".", ",")} GB`;
  const caixa = (v: Par | null | undefined, onPress: () => void) => (
    <Pressable onPress={onPress} style={{ flex: 1, height: 42, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface,
                                          flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10 }}>
      <Cubo size={14} color={c.muted} />
      <Text style={{ color: v?.model ? c.fg : c.faint, fontFamily: mono, fontSize: 12.5, flex: 1 }} numberOfLines={1}>{v?.model || "escolher modelo"}</Text>
      <Seta size={14} color={c.faint} />
    </Pressable>
  );
  const mudaSlot = (id: string, v: Par) => {
    if (!m) return;
    if (id === "maestro") { setM({ ...m, maestro_model: v }); return salva({ maestro_model: v }); }
    if (id.startsWith("esp:")) {
      const lista = (m.especialidades ?? []).map((e) => (e.id === id.slice(4) ? { ...e, ...v } : e));
      setM({ ...m, especialidades: lista });
      return salva({ worker_especialidades: lista });
    }
    const slots = { ...m.slots, [id]: v };
    setM({ ...m, slots });
    salva({ subagents: slots });
  };
  const linhas = m ? [
    ...(["rapido", "capaz", "nuvem"] as const).map((k) => ({ id: k, nome: NOME_NIVEL[k], ajuda: AJUDA_NIVEL[k], spec: m.slots[k] })),
    ...(m.especialidades ?? []).map((e) => ({ id: `esp:${e.id}`, nome: e.nome, spec: e.model ? { provider: e.provider, model: e.model } : undefined,
      ajuda: (AJUDA_ESPECIALIDADE[e.id] ?? "Especialista criado por você.") + (e.quando ? ` Quando usar: ${e.quando}.` : "") })),
  ] : [];
  const semWorker = !!m && !Object.values(m.slots).some((x) => x?.model) && !m.workers_do_maestro;
  return (
    <Folha aberta={aberta} titulo="Modelo · VRAM" onFecha={onFecha}>
      {!m ? <ActivityIndicator color={c.muted} /> : (
        <>
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.running ? c.ok : c.faint }} />
              <Text style={{ color: c.fg, fontSize: 13.5, flex: 1 }} numberOfLines={1}>{m.running && m.alias ? m.alias : "nenhum modelo local carregado"}</Text>
            </View>
            {usado != null && (
              <>
                <View style={{ flexDirection: "row" }}>
                  <Text style={[s.muted, { flex: 1 }]}>VRAM</Text>
                  <Text style={{ color: c.fg, fontFamily: mono, fontSize: 12.5 }}>{gb(m.vram! - m.vram_free!)} de {gb(m.vram!)}</Text>
                </View>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: c.line, overflow: "hidden" }}>
                  <View style={{ height: 6, width: `${Math.round(usado * 100)}%`, backgroundColor: usado > 0.9 ? c.err : usado > 0.7 ? c.warn : c.accent }} />
                </View>
              </>
            )}
          </View>
          <View style={{ gap: 10 }}>
            <Text style={s.secao2}>MODELO DOS WORKERS</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[s.muted, { width: 112 }]}>Maestro</Text>
              {caixa(m.maestro_model, () => setEscolhe("maestro"))}
            </View>
            {/* Maestro e Workers no mesmo modelo: nada é descarregado para subir o modelo de um especialista. */}
            <Pressable onPress={() => { const v = !m.workers_do_maestro; setM({ ...m, workers_do_maestro: v }); salva({ workers_do_maestro: v }); }}
                       style={{ flexDirection: "row", gap: 10, borderRadius: 12, borderWidth: 1, borderColor: c.line, padding: 10 }}>
              <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, marginTop: 1, alignItems: "center", justifyContent: "center",
                             borderColor: m.workers_do_maestro ? c.accent : c.lineStrong, backgroundColor: m.workers_do_maestro ? c.accent : "transparent" }}>
                {m.workers_do_maestro && <Check size={14} color={c.accentFg} />}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: c.fg, fontSize: 14 }}>Workers usam o modelo da Maestro</Text>
                <Text style={[s.faint, { fontSize: 12, lineHeight: 17 }]}>
                  Ninguém troca de modelo: a Maestro não é descarregada para subir o modelo de um Worker. Com IA local, os Workers rodam em paralelo no mesmo servidor. Os modelos abaixo ficam guardados, sem uso.
                </Text>
              </View>
            </Pressable>
            <View style={{ gap: 8, opacity: m.workers_do_maestro ? 0.4 : 1 }} pointerEvents={m.workers_do_maestro ? "none" : "auto"}>
              {linhas.map((w) => (
                <View key={w.id} style={{ gap: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Pressable onPress={() => setAjuda(ajuda === w.id ? null : w.id)} style={{ width: 112, flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Text style={[s.muted, { flexShrink: 1 }]} numberOfLines={2}>{w.nome}</Text>
                      <View style={{ width: 15, height: 15, borderRadius: 8, borderWidth: 1, borderColor: c.line, alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ color: c.faint, fontSize: 9 }}>?</Text>
                      </View>
                    </Pressable>
                    {caixa(w.spec, () => setEscolhe(w.id))}
                    {!!w.spec?.model && (
                      <Pressable hitSlop={8} onPress={() => mudaSlot(w.id, { provider: "", model: "" })}><X size={13} color={c.faint} /></Pressable>
                    )}
                    <Pressable hitSlop={6} onPress={() => { onFecha(); onTestar(w.id.replace("esp:", ""), w.nome, w.spec); }}
                               style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 4 }}>
                      <Balanca size={13} color={c.faint} /><Text style={{ color: c.faint, fontSize: 12 }}>Testar</Text>
                    </Pressable>
                  </View>
                  {ajuda === w.id && <Text style={[s.faint, { fontSize: 12, lineHeight: 17 }]}>{w.ajuda}</Text>}
                </View>
              ))}
            </View>
            {semWorker && <Text style={{ color: c.warn, fontSize: 12.5 }}>Nenhum Worker configurado — sem isso a Maestro não tem a quem delegar.</Text>}
          </View>
          <Campo rotulo="Ao terminar uma tarefa" dica={m.lifecycle === "persistent" ? "Recarregar custa minutos: vale manter quando as tarefas usam o mesmo modelo."
            : "Libera a VRAM a cada tarefa. É o modo para máquina apertada ou modelos diferentes por tarefa."}>
            <Seletor cheio valor={m.lifecycle === "unload_clear" ? "unload_after_task" : m.lifecycle}
                     opcoes={[{ id: "persistent", rotulo: "Manter" }, { id: "unload_after_task", rotulo: "Descartar" }, { id: "restart_after_task", rotulo: "Reiniciar" }]}
                     onMuda={(v) => { setM({ ...m, lifecycle: v }); salva({ model_lifecycle: v }); }} />
          </Campo>
          <Campo rotulo="Execução dos Workers" dica={m.max_workers <= 1 ? "Sequencial: um Worker por vez, o modelo local troca só entre tarefas." : undefined}>
            <Seletor cheio valor={m.max_workers <= 1 ? "1" : "2"} opcoes={[{ id: "1", rotulo: "Sequencial" }, { id: "2", rotulo: "Paralelo" }]}
                     onMuda={(v) => { const n = v === "1" ? 1 : Math.max(2, m.max_workers); setM({ ...m, max_workers: n }); salva({ max_workers: n }); }} />
          </Campo>
          <ModelosFolha aberto={escolhe != null} soProvedor={escolhe === "nuvem"} onFecha={() => setEscolhe(null)} onEscolhe={([e]) => {
            const alvo = escolhe!;
            setEscolhe(null);
            mudaSlot(alvo, { provider: e.provider ?? "local", model: e.model ?? e.nome });
          }} />
        </>
      )}
    </Folha>
  );
}

function Arvore({ board, onAbre, onWorker }: { board: Board | null; onAbre: (code: string) => void; onWorker: (code: string) => void }) {
  if (!board) return <ActivityIndicator style={{ marginTop: 40 }} color={c.muted} />;
  if (!board.total)
    return <Text style={[s.muted, { padding: 20, lineHeight: 20 }]}>A Maestro ainda não planejou tarefas. Peça no chat o que você quer construir.</Text>;
  const tarefas = board.features.flatMap((f) => f.tasks);
  const n = (f: (t: Tarefa) => boolean) => tarefas.filter(f).length;
  const resumo = [`${n((t) => t.status === "completed")} concluídas`, `${n((t) => ATIVOS.includes(t.status))} rodando`,
    `${n((t) => !ATIVOS.includes(t.status) && t.status !== "completed")} pendentes`].join(" · ");
  return (
    <ScrollView contentContainerStyle={{ padding: 14, gap: 16 }}>
      <View style={{ gap: 8 }}>
        <View style={{ height: 5, backgroundColor: c.raised, borderRadius: 3, overflow: "hidden" }}>
          <View style={{ height: 5, width: `${(board.done / board.total) * 100}%`, backgroundColor: c.ok }} />
        </View>
        <Text style={{ color: c.muted, fontSize: 12.5 }}>{resumo}</Text>
      </View>
      {board.features.map((f) => (
        <View key={f.id} style={{ gap: 4 }}>
          <Text style={s.secao2}>{f.title.toUpperCase()}</Text>
          {f.tasks.map((t) => {
            const [cor, rotulo] = ESTADO[t.status] ?? [c.muted, t.status];
            return (
              <Pressable key={t.code} onPress={() => onAbre(t.code)}
                         style={({ pressed }) => ({ flexDirection: "row", gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12,
                           backgroundColor: pressed ? c.surface : "transparent", alignItems: "flex-start" })}>
                <View style={{ width: 18, alignItems: "center", paddingTop: 2 }}>{iconeEstado(t.status)}</View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: c.fg, fontSize: 14.5, lineHeight: 20 }} numberOfLines={2}>{t.title}</Text>
                  <Text style={{ color: c.faint, fontSize: 12 }}>
                    <Text style={{ fontFamily: mono }}>{t.code}</Text> · <Text style={{ color: cor }}>{rotulo}</Text>
                    {t.attempt_count ? ` · tentativa ${t.attempt_count}/${t.max_attempts}` : ""}
                    {t.depends_on?.length ? ` · depois de ${t.depends_on.join(", ")}` : ""}
                  </Text>
                </View>
                {t.attempt_count > 0 && (
                  // O chat do Worker desta tarefa (a aba Worker sozinha só mostra a tarefa em andamento).
                  <Pressable onPress={() => onWorker(t.code)} hitSlop={8}
                             style={{ paddingHorizontal: 10, height: 28, justifyContent: "center", borderRadius: 7, borderColor: c.line, borderWidth: 1, alignSelf: "center" }}>
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
  const [cor, rotulo] = ESTADO[tarefa.status] ?? [c.muted, tarefa.status];
  const comTentativa = tarefas.filter((t) => t.attempt_count > 0);
  return (
    <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
      {comTentativa.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {comTentativa.map((t) => (
            <Pressable key={t.code} onPress={() => onEscolhe(t.code)}
                       style={{ paddingHorizontal: 10, height: 30, justifyContent: "center", borderRadius: 999, backgroundColor: t.code === tarefa.code ? c.raised : c.surface }}>
              <Text style={{ color: t.code === tarefa.code ? c.fg : c.muted, fontSize: 12.5, fontFamily: mono }}>{t.code}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Text style={{ color: c.fg, fontSize: 15, fontWeight: "600" }}>{tarefa.title}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {iconeEstado(tarefa.status, 14)}
        <Text style={{ color: cor, fontSize: 13 }}>{rotulo}{at?.worker?.model ? ` · ${at.worker.model}` : ""}</Text>
      </View>
      {tent.length > 1 && (
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {tent.map((a) => (
            <Pressable key={a.n} onPress={() => setN(a.n)}
                       style={{ paddingHorizontal: 10, height: 30, flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999,
                                backgroundColor: a.n === at?.n ? c.accent : c.raised }}>
              <Text style={{ color: a.n === at?.n ? c.accentFg : ESTADO[a.status]?.[0] ?? c.muted, fontSize: 12.5, fontFamily: mono }}>#{a.n}</Text>
              {a.n !== at?.n && iconeEstado(a.status, 12)}
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

/** Folha da tarefa: contrato, execução, tentativas e as ações do PainelTarefa (despachar de novo, eu faço, desfazer tentativa). */
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
  async function desfaz(n: number) {
    try {
      const r = await api.post<{ restored: string[]; task: Tarefa }>(`/maestro/${conv}/task/${code}/attempt/${n}/rollback`, {});
      setT((x) => (x ? { ...x, ...r.task } : r.task));
      toast(`Tentativa #${n} desfeita: ${r.restored?.length ?? 0} arquivo(s) de volta.`);
      onMudou();
    } catch (e: any) { setErro(e.message); }
  }
  const confirma = (titulo: string, msg: string, faz: () => void) =>
    pergunta(titulo, msg, [{ texto: "Voltar", estilo: "cancelar" }, { texto: titulo, acao: faz }]);

  const contrato = t?.contract ?? {};
  const secao = (titulo: string) => <Text style={[s.secao2, { marginTop: 4 }]}>{titulo}</Text>;
  const linha = (k: string, v: string, emMono?: boolean) => (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <Text style={[s.muted, { width: 150 }]}>{k}</Text>
      <Text style={{ color: c.fg, fontSize: 13, flex: 1, fontFamily: emMono ? mono : undefined }}>{v}</Text>
    </View>
  );
  const acaoLinha = (Icone: typeof Refresh, titulo: string, dica: string, onPress: () => void, perigo?: boolean) => (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: "row", gap: 12, alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1,
                                                            borderColor: c.line, backgroundColor: pressed ? c.raised : c.surface })}>
      <Icone size={17} color={perigo ? c.err : c.fg} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: perigo ? c.err : c.fg, fontSize: 14.5 }}>{titulo}</Text>
        {!!dica && <Text style={[s.faint, { fontSize: 12.5 }]}>{dica}</Text>}
      </View>
    </Pressable>
  );
  return (
    <Deslizante aberta={!!code} onFecha={onFecha}>
      <View style={{ height: "82%", backgroundColor: c.side, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderColor: c.line, borderWidth: 1 }}>
        {!t ? <View style={{ padding: 20 }}>{erro ? <Text style={{ color: c.err }}>{erro}</Text> : <ActivityIndicator color={c.muted} />}</View> : (
          <ScrollView contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: inset.bottom + 20 }}>
            <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12 }}>{t.code}</Text>
            <Text style={{ color: c.fg, fontSize: 17, fontWeight: "600", lineHeight: 24 }}>{t.title}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {iconeEstado(t.status, 14)}
              <Text style={{ color: ESTADO[t.status]?.[0] ?? c.muted, fontSize: 13 }}>{ESTADO[t.status]?.[1] ?? t.status}</Text>
            </View>
            {!!t.blocked_reason && <Text style={{ color: c.warn, fontSize: 13 }}>{t.blocked_reason}</Text>}
            {!!erro && <Text style={{ color: c.err, fontSize: 13 }}>{erro}</Text>}
            <View style={{ gap: 8 }}>
              {["failed", "blocked", "needs_human", "cancelled", "completed"].includes(t.status) &&
                acaoLinha(Refresh, "Despachar de novo", "Volta para a fila e pede à Maestro para despachar de novo",
                  () => confirma("Despachar de novo", "A tarefa volta para a fila e a Maestro manda um Worker de novo.",
                    () => muda({ status: "queued" }, `Reexecute a tarefa ${t.code} com run_task.`)))}
              {["blocked", "needs_human"].includes(t.status) &&
                acaoLinha(Undo, "Devolver à Maestro", "A tarefa volta a ser dela para planejar e despachar", () => muda({ status: "pending" }))}
              {!["completed", "cancelled", "needs_human"].includes(t.status) &&
                acaoLinha(Lapis, "Eu faço esta tarefa", "Você faz esta tarefa; a Maestro não a despacha",
                  () => muda({ status: "needs_human", reason: "Assumida pelo usuário" }))}
              {t.status !== "cancelled" &&
                acaoLinha(X, "Cancelar tarefa", "A Maestro deixa de despachar esta tarefa",
                  () => confirma("Cancelar tarefa", "A Maestro deixa de despachar esta tarefa.", () => muda({ status: "cancelled" })), true)}
            </View>
            {!!contrato.goal && <>{secao("OBJETIVO")}<Markdown texto={String(contrato.goal)} /></>}
            {Array.isArray(contrato.requirements) && contrato.requirements.length > 0 && (
              <>{secao("REQUISITOS")}<Markdown texto={contrato.requirements.map((r: string) => `- ${r}`).join("\n")} /></>
            )}
            {Array.isArray(contrato.acceptance_criteria) && contrato.acceptance_criteria.length > 0 && (
              <>{secao("CRITÉRIOS DE ACEITE")}
                <Markdown texto={contrato.acceptance_criteria.map((r: any) => `- ${typeof r === "string" ? r : r.command ?? JSON.stringify(r)}`).join("\n")} /></>
            )}
            {Array.isArray(contrato.relevant_files) && contrato.relevant_files.length > 0 && (
              <>{secao("ARQUIVOS")}<Text style={[s.muted, { fontFamily: mono, fontSize: 12.5 }]}>{contrato.relevant_files.join("\n")}</Text></>
            )}
            {secao("EXECUÇÃO")}
            <View style={{ gap: 6 }}>
              {linha("Worker", t.model_slot ? `slot ${t.model_slot}` : "automático")}
              {!!contrato.verify_command && linha("Comando de verificação", String(contrato.verify_command), true)}
              {linha("Máx. de tentativas", String(t.max_attempts))}
            </View>
            {t.attempts.length > 0 && secao("TENTATIVAS")}
            {t.attempts.map((a) => (
              <View key={a.n} style={{ borderColor: c.line, borderWidth: 1, borderRadius: 12, padding: 10, gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  {iconeEstado(a.status, 13)}
                  <Text style={{ color: ESTADO[a.status]?.[0] ?? c.muted, fontSize: 13, flex: 1 }}>
                    #{a.n} · {ESTADO[a.status]?.[1] ?? a.status}{a.worker?.model ? ` · ${a.worker.model}` : ""}
                  </Text>
                  <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>
                    {a.seconds ? `${Math.round(a.seconds)}s` : ""}{a.tokens ? ` · ${a.tokens.toLocaleString("pt-BR")} tok` : ""}
                  </Text>
                </View>
                {!!a.error && <Text style={{ color: c.err, fontSize: 12.5 }}>{a.error}</Text>}
                {!!a.result?.summary && <Text style={[s.muted, { fontSize: 12.5 }]} numberOfLines={6}>{a.result.summary}</Text>}
                {a.status === "completed" && (
                  <Pressable onPress={() => confirma("Desfazer esta tentativa", "Os arquivos voltam a como estavam antes dela.", () => desfaz(a.n))}
                             style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", height: 28, paddingHorizontal: 9,
                                      borderRadius: 7, borderWidth: 1, borderColor: c.lineStrong }}>
                    <Undo size={13} color={c.fg2} /><Text style={{ color: c.fg2, fontSize: 12 }}>Desfazer esta tentativa</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Deslizante>
  );
}
