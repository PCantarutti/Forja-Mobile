import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { api } from "./api";
import { Prancheta, X } from "./icones";
import { Text } from "./Texto";
import { c, mono, s } from "./tema";
import { Gira, Pulsa } from "./ui";

// Faixas acima do composer do Agente: o objetivo (GoalStrip do desktop) e as tarefas do update_tasks (TodosBar).
type Goal = { id: number; objective: string; status: string; armada: boolean; rodada: number; max: number; motivo: string };
export type Tarefa = { text?: string; content?: string; title?: string; status: string };
const feita = (t: Tarefa) => t.status === "done" || t.status === "completed";
const andando = (t: Tarefa) => t.status === "doing" || t.status === "in_progress";

/** Objetivo da conversa: pausar/retomar e descartar. Some sem goal ou com ela completa. `recarga` muda a cada turno. */
export function FaixaObjetivo({ conv, recarga }: { conv: number | null; recarga: unknown }) {
  const [dado, setDado] = useState<{ conv: number; goal: Goal | null } | null>(null);
  useEffect(() => {
    if (conv == null) return;
    const busca = () => api.get<{ goal: Goal | null }>(`/conversations/${conv}/goal`).then((r) => setDado({ conv, goal: r.goal })).catch(() => {});
    busca();
    const t = setInterval(busca, 5000); // o PC pode pausar ou descartar: acompanha ao vivo
    return () => clearInterval(t);
  }, [conv, recarga]);
  const goal = dado && dado.conv === conv ? dado.goal : null;
  if (!goal || goal.status === "completa" || conv == null) return null;
  const agir = (action: string) => api.post<{ goal: Goal | null }>(`/conversations/${conv}/goal`, { action })
    .then((r) => setDado({ conv, goal: r.goal })).catch(() => {});
  const girando = goal.status === "ativa" && goal.armada;
  const btn = { height: 28, borderRadius: 7, borderWidth: 1, borderColor: c.lineStrong, paddingHorizontal: 9, justifyContent: "center" as const };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.bg,
                   paddingVertical: 8, paddingRight: 10, paddingLeft: 12, marginBottom: 6 }}>
      <Text style={s.secao2}>OBJETIVO</Text>
      <Text style={{ color: c.fg, fontSize: 13, flex: 1 }} numberOfLines={1}>{goal.objective}</Text>
      <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11 }} numberOfLines={1}>{goal.status} · rodada {goal.rodada}</Text>
      <Pressable style={btn} onPress={() => agir(girando || goal.status === "bloqueada" ? "pause" : "resume")}>
        <Text style={{ color: c.fg2, fontSize: 12 }}>{girando || goal.status === "bloqueada" ? "Pausar" : "Retomar"}</Text>
      </Pressable>
      <Pressable hitSlop={8} onPress={() => agir("clear")}><X size={14} color={c.faint} /></Pressable>
    </View>
  );
}

/** Tarefas do agente: linha recolhível com o resumo e a barra; aberta, a lista com os pontos. */
export function FaixaTarefas({ tarefas }: { tarefas: Tarefa[] }) {
  const [aberta, setAberta] = useState(false);
  if (!tarefas.length) return null;
  const feitas = tarefas.filter(feita).length, rodando = tarefas.filter(andando).length;
  const resumo = [`${feitas} concluída${feitas === 1 ? "" : "s"}`, rodando ? `${rodando} em andamento` : ""].filter(Boolean).join(" · ");
  return (
    <View style={{ borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.bg, marginBottom: 6, overflow: "hidden" }}>
      <Pressable onPress={() => setAberta(!aberta)} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12 }}>
        <Prancheta size={14} color={c.muted} />
        <Text style={{ color: c.fg, fontSize: 13, fontWeight: "600" }}>Tarefas</Text>
        <Text style={{ color: c.muted, fontSize: 12.5, flex: 1 }} numberOfLines={1}>{resumo}</Text>
        <View style={{ width: 48, height: 3, borderRadius: 2, backgroundColor: c.line, overflow: "hidden" }}>
          <View style={{ height: 3, width: `${(feitas / tarefas.length) * 100}%`, backgroundColor: c.accent }} />
        </View>
        <Gira aberto={aberta} />
      </Pressable>
      {aberta && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 10, gap: 6 }}>
          {tarefas.map((t, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
              {andando(t) ? <Pulsa cor={c.info} lado={6} /> : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: feita(t) ? c.ok : c.faint }} />}
              <Text style={{ color: feita(t) ? c.faint : c.fg2, fontSize: 13, flex: 1, textDecorationLine: feita(t) ? "line-through" : "none" }}>
                {t.text ?? t.content ?? t.title ?? ""}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
