import { useEffect, useState } from "react";
import { api } from "./api";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Abaixo, Cubo, Enviar, Escudo, Parar } from "./icones";
import Modelos, { type Escolha } from "./Modelos";
import { c, mono, s } from "./tema";
import { type Anexo, CartaoAnexo } from "./Anexo";
import { Chip, Folha, Lista } from "./ui";

// Mesmos menus do desktop (Controls.tsx): permissão e esforço.
export const PERMISSOES = [
  { id: "auto", label: "Automático", hint: "O Forja decide: edições passam, o resto pergunta" },
  { id: "manual", label: "Manual", hint: "Sempre perguntar antes de qualquer alteração" },
  { id: "edits", label: "Aceitar edições", hint: "Aceita edições de arquivo; shell e navegador perguntam" },
  { id: "plan", label: "Plano", hint: "Só leitura: monta um plano antes de alterar" },
  { id: "bypass", label: "Ignorar permissões", hint: "Aceita tudo, inclusive shell. Cuidado." },
];
export const ESFORCOS = [
  { id: "baixo", rotulo: "Baixo", dica: "Direto ao ponto, sem pensar" },
  { id: "medio", rotulo: "Médio", dica: "Pensa um pouco antes de responder" },
  { id: "alto", rotulo: "Alto", dica: "Pensa mais nas partes difíceis" },
  { id: "maximo", rotulo: "Máximo", dica: "Pensa o quanto precisar" },
  { id: "extremo", rotulo: "Extremo", dica: "Delega à Maestro e revisa cada passo" },
];

export type { Anexo } from "./Anexo";
export type Ajustes = { provider: string; model: string; effort: string };
/** O que o popover do anel mostra no desktop (App.tsx, summary): contexto, partes, conversa, último turno. */
export type Contexto = {
  usado: number; max: number; partes?: { sistema: number; ferramentas: number; mensagens: number } | null;
  saida?: number | null; media?: number | null; sessao?: { turnos: number; passos: number; tokens: number; cache: number | null };
};

const fmt = (n: number) => n.toLocaleString("pt-BR");
const fmtK = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
const Linha = ({ k, v, cor }: { k: string; v: string; cor?: string }) => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 }}>
    {cor && <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: cor }} />}
    <Text style={[s.muted, { flex: 1 }]}>{k}</Text><Text style={[s.txt, { fontSize: 14 }]}>{v}</Text>
  </View>
);

/** Detalhe do anel (o popover do ContextRing do desktop), com as cotas de nuvem e o "Compactar agora". */
function DetalheContexto({ ctx, podeCompactar, onCompactar }: { ctx: Contexto; podeCompactar: boolean; onCompactar: () => void }) {
  const [cotas, setCotas] = useState<{ provider: string; name: string; limits: { name: string; usage: number }[] }[]>([]);
  useEffect(() => { api.get<{ providers: typeof cotas }>("/cloud-usage").then((r) => setCotas(r.providers)).catch(() => {}); }, []);
  const f = ctx.max ? Math.min(1, ctx.usado / ctx.max) : 0;
  const cor = f >= 0.9 ? c.red : f >= 0.7 ? c.amber : c.muted;
  const partes = ctx.partes ? [
    { nome: "System prompt", v: ctx.partes.sistema, cor: c.muted }, { nome: "Ferramentas", v: ctx.partes.ferramentas, cor: "#a78bfa" },
    { nome: "Mensagens", v: ctx.partes.mensagens, cor: "#60a5fa" },
  ].filter((x) => x.v > 0) : [];
  const total = partes.reduce((n, x) => n + x.v, 0);
  return (
    <>
      <Linha k="Contexto" v={`${fmt(ctx.usado)} / ${ctx.max ? fmt(ctx.max) : "?"}`} />
      {/* Barra empilhada: cada parte na proporção do que ocupa da janela. */}
      <View style={{ flexDirection: "row", height: 7, borderRadius: 4, overflow: "hidden", backgroundColor: c.raised }}>
        {partes.length ? partes.map((x) => <View key={x.nome} style={{ width: `${(x.v / (ctx.max || total)) * 100}%`, backgroundColor: x.cor }} />)
          : <View style={{ width: `${Math.round(f * 100)}%`, backgroundColor: cor }} />}
      </View>
      {partes.map((x) => <Linha key={x.nome} k={x.nome} v={`~${fmtK(x.v)}`} cor={x.cor} />)}
      <Linha k="Uso" v={`${Math.round(f * 100)}%`} />
      {!!ctx.sessao?.passos && (
        <View style={{ borderTopColor: c.line, borderTopWidth: 1, paddingTop: 8 }}>
          <Text style={s.secao}>Conversa</Text>
          <Linha k="Turnos · passos" v={`${ctx.sessao.turnos} · ${ctx.sessao.passos}`} />
          <Linha k="Tokens somados" v={fmtK(ctx.sessao.tokens)} />
          <Linha k="Acerto de cache" v={ctx.sessao.cache == null ? "—" : `${Math.round(ctx.sessao.cache * 100)}%`} />
        </View>
      )}
      {ctx.saida != null && <Linha k="Saída (último turno)" v={fmt(ctx.saida)} />}
      {ctx.media != null && <Linha k="Média" v={`${ctx.media.toFixed(1)} t/s`} />}
      {cotas.map((q) => (
        <View key={q.provider} style={{ borderTopColor: c.line, borderTopWidth: 1, paddingTop: 8, gap: 6 }}>
          <Text style={s.secao}>Cota · {q.name}</Text>
          {q.limits.map((l) => {
            const pct = Math.min(100, Math.round(l.usage * 100));
            return (
              <View key={l.name} style={{ gap: 3 }}>
                <Linha k={l.name} v={`${pct}%`} />
                <View style={{ height: 5, borderRadius: 3, backgroundColor: c.raised }}>
                  <View style={{ height: 5, borderRadius: 3, width: `${pct}%`, backgroundColor: pct >= 90 ? c.red : pct >= 70 ? c.amber : c.sky }} />
                </View>
              </View>
            );
          })}
        </View>
      ))}
      <Pressable style={[s.btnSec, { opacity: podeCompactar ? 1 : 0.4 }]} disabled={!podeCompactar} onPress={onCompactar}>
        <Text style={s.btnSecTxt}>Compactar agora</Text>
      </Pressable>
      <Text style={[s.faint, { fontSize: 12 }]}>Compactar resume o histórico antigo com o modelo, para liberar a janela.</Text>
    </>
  );
}

/** Anel de uso da janela de contexto, como o ContextRing do desktop (âmbar a 70%, vermelho a 90%). */
function Anel({ usado, max }: { usado: number; max: number }) {
  const f = max ? Math.min(1, usado / max) : 0;
  const r = 8, per = 2 * Math.PI * r;
  const cor = f >= 0.9 ? c.red : f >= 0.7 ? c.amber : c.muted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Svg width={20} height={20} viewBox="0 0 20 20">
        <Circle cx={10} cy={10} r={r} stroke={c.line} strokeWidth={2.5} fill="none" />
        <Circle cx={10} cy={10} r={r} stroke={cor} strokeWidth={2.5} fill="none" strokeDasharray={`${per * f} ${per}`}
                strokeLinecap="round" transform="rotate(-90 10 10)" />
      </Svg>
      <Text style={{ color: cor, fontSize: 11.5 }}>{Math.round(f * 100)}%</Text>
    </View>
  );
}

/** Caixa de prompt do chat/agente/maestro: texto em cima; anexo, permissão, esforço, modelo e contexto embaixo. */
export default function Entrada(p: {
  kind: string; teclado: boolean; rodando: boolean; perm: string; onPerm: (v: string) => void;
  ajustes: Ajustes; onAjustes: (a: Ajustes, gguf?: string) => void; ctx: Contexto | null; podeCompactar: boolean; onCompactar: () => void;
  anexos: Anexo[]; enviando: boolean; onAnexar: () => void; onTiraAnexo: (path: string) => void;
  onEnvia: (t: string) => unknown; /* false = recusou: o texto fica no campo */ onPara: () => void; conv?: number | null;
}) {
  const [t, setT] = useState("");
  // /skill:nome em qualquer ponto do texto (desktop App.tsx inlineQuery): o backend lê do conteúdo, aqui só completa.
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  useEffect(() => {
    api.get<{ skills: { name: string; kind: string; description: string }[] }>(`/conversations/${p.conv ?? 0}/skills`)
      .then((r) => setSkills(r.skills.filter((x) => x.kind === "prompt"))).catch(() => {});
  }, [p.conv]);
  const parcial = /(?:^|\s)\/skill:([\w.-]*)$/.exec(t)?.[1]?.toLowerCase();
  const sugestoes = parcial == null ? [] : skills.filter((x) => x.name.toLowerCase().startsWith(parcial)).slice(0, 6);
  const completa = (nome: string) => setT((x) => x.replace(/\/skill:[\w.-]*$/, `/skill:${nome} `));
  const [menu, setMenu] = useState<null | "perm" | "esforco" | "modelo" | "contexto">(null);
  const inset = useSafeAreaInsets();
  const agentica = p.kind === "agent" || p.kind === "maestro";
  const perm = PERMISSOES.find((x) => x.id === p.perm) ?? PERMISSOES[1];
  const esforcos = p.kind === "maestro" ? ESFORCOS.filter((e) => e.id !== "extremo") : ESFORCOS; // o desktop tira o extremo no Maestro
  const esforco = ESFORCOS.find((e) => e.id === p.ajustes.effort) ?? ESFORCOS[1];
  const pode = !!t.trim() || (!p.rodando && p.anexos.length > 0);
  const envia = () => { if (!pode) return; const v = t.trim(); if (p.onEnvia(v) !== false) setT(""); };
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: p.teclado ? 8 : Math.max(inset.bottom, 10) }}>
      <View style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 24, padding: 8, gap: 6 }}>
        {(p.anexos.length > 0 || p.enviando) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 4 }}>
            {p.anexos.map((a) => <CartaoAnexo key={a.path} a={a} onRemover={() => p.onTiraAnexo(a.path)} />)}
            {p.enviando && <Text style={[s.faint, { alignSelf: "center" }]}>enviando…</Text>}
          </ScrollView>
        )}
        {sugestoes.length > 0 && (
          <View style={{ borderColor: c.line, borderWidth: 1, borderRadius: 14, overflow: "hidden" }}>
            {sugestoes.map((x, i) => (
              <Pressable key={x.name} onPress={() => completa(x.name)}
                         style={{ paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                <Text style={{ color: c.fg, fontFamily: mono, fontSize: 13 }}>/skill:{x.name}</Text>
                {!!x.description && <Text style={[s.faint, { fontSize: 12 }]} numberOfLines={1}>{x.description}</Text>}
              </Pressable>
            ))}
          </View>
        )}
        <TextInput style={{ color: c.fg, fontSize: 15, maxHeight: 150, paddingHorizontal: 8, paddingTop: 6 }} value={t} onChangeText={setT}
                   multiline placeholder={p.rodando ? "Entra no próximo passo da IA…" : "Mensagem para o Forja"} placeholderTextColor={c.faint} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: "center" }} style={{ flex: 1 }}>
            <Chip rotulo="📎" onPress={p.onAnexar} />
            {agentica && (
              <Chip rotulo={perm.label} onPress={() => setMenu("perm")} cor={p.perm === "bypass" ? c.amber : undefined}
                    icone={<Escudo size={14} color={p.perm === "bypass" ? c.amber : c.muted} />} />
            )}
            <Chip rotulo={esforco.rotulo} onPress={() => setMenu("esforco")} icone={<Abaixo size={12} color={c.faint} />} />
            <Chip rotulo={p.ajustes.model || "Modelo"} onPress={() => setMenu("modelo")} icone={<Cubo size={13} color={c.muted} />} max={200} />
          </ScrollView>
          {p.ctx && p.ctx.max > 0 && (
            <Pressable onPress={() => setMenu("contexto")} hitSlop={8}><Anel usado={p.ctx.usado} max={p.ctx.max} /></Pressable>
          )}
          {p.rodando && !t.trim() ? (
            <Pressable onPress={p.onPara} style={redondo}><Parar size={16} color="#000" /></Pressable>
          ) : (
            <Pressable onPress={envia} disabled={!pode} style={[redondo, { opacity: pode ? 1 : 0.35 }]}><Enviar size={18} color="#000" /></Pressable>
          )}
        </View>
      </View>
      <Folha aberta={menu === "perm"} titulo={`Permissões${p.rodando ? " · vale já na próxima ferramenta" : ""}`} onFecha={() => setMenu(null)}>
        <Lista opcoes={PERMISSOES.filter((x) => !(p.rodando && x.id === "plan"))
                  .map((x) => ({ id: x.id, rotulo: x.label, dica: x.hint, cor: x.id === "bypass" ? c.amber : undefined }))}
               valor={p.perm} onEscolhe={(v) => { setMenu(null); p.onPerm(v); }} />
      </Folha>
      {p.ctx && (
        <Folha aberta={menu === "contexto"} titulo="Janela de contexto" onFecha={() => setMenu(null)}>
          <DetalheContexto ctx={p.ctx} podeCompactar={p.podeCompactar} onCompactar={() => { setMenu(null); p.onCompactar(); }} />
        </Folha>
      )}
      <Folha aberta={menu === "esforco"} titulo="Esforço" onFecha={() => setMenu(null)}>
        <Lista opcoes={esforcos} valor={p.ajustes.effort} onEscolhe={(v) => { setMenu(null); p.onAjustes({ ...p.ajustes, effort: v }); }} />
      </Folha>
      <Modelos aberto={menu === "modelo"} onFecha={() => setMenu(null)}
               onEscolhe={([e]: Escolha[]) => { setMenu(null); p.onAjustes({ ...p.ajustes, provider: e.provider ?? "local", model: e.model ?? e.nome }, e.path); }} />
    </View>
  );
}

const redondo = { width: 36, height: 36, borderRadius: 18, backgroundColor: c.fg, alignItems: "center" as const, justifyContent: "center" as const };
