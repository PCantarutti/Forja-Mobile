import { type ReactNode, useEffect, useState } from "react";
import { api } from "./api";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Brain, Cube, Gauge, Paperclip, Parar, Shield } from "./icones";
import { BotaoEnviar } from "./Imagens";
import Modelos, { type Escolha } from "./Modelos";
import { Text, TextInput } from "./Texto";
import { c, mono, s } from "./tema";
import { type Anexo, CartaoAnexo } from "./Anexo";
import { Botao, Chip, Folha, Lista, Opcao } from "./ui";

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
/** O que o popover do anel mostra no desktop (ContextRing.tsx): contexto, slots, conversa, último turno. */
export type Contexto = {
  usado: number; max: number; partes?: { sistema: number; ferramentas: number; mensagens: number } | null;
  saida?: number | null; media?: number | null; ttft?: number | null; compartilhado?: { slots: number; total: number } | null;
  sessao?: { turnos: number; passos: number; tokens: number; cache: number | null };
};

const fmt = (n: number) => n.toLocaleString("pt-BR");
const fmtK = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)).replace(".", ",");
const Linha = ({ k, v, cor }: { k: string; v: string; cor?: string }) => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 }}>
    {cor && <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: cor }} />}
    <Text style={[s.muted, { flex: 1 }]}>{k}</Text><Text style={{ color: c.fg, fontSize: 13.5, fontFamily: mono }}>{v}</Text>
  </View>
);

/** Janela de contexto (o popover do ContextRing do desktop), com as cotas de nuvem e o "Compactar agora". */
function DetalheContexto({ ctx, podeCompactar, onCompactar }: { ctx: Contexto; podeCompactar: boolean; onCompactar: () => void }) {
  const [cotas, setCotas] = useState<{ provider: string; name: string; limits: { name: string; usage: number }[] }[]>([]);
  useEffect(() => { api.get<{ providers: typeof cotas }>("/cloud-usage").then((r) => setCotas(r.providers)).catch(() => {}); }, []);
  const f = ctx.max ? Math.min(1, ctx.usado / ctx.max) : 0;
  const cor = f >= 0.9 ? c.err : f >= 0.7 ? c.warn : c.accent;
  const partes = ctx.partes ? [
    { nome: "System prompt", v: ctx.partes.sistema, cor: c.muted }, { nome: "Ferramentas", v: ctx.partes.ferramentas, cor: c.agent },
    { nome: "Mensagens", v: ctx.partes.mensagens, cor: c.info },
  ].filter((x) => x.v > 0) : [];
  const total = partes.reduce((n, x) => n + x.v, 0);
  return (
    <>
      <View style={{ gap: 8 }}>
        <Text style={{ color: c.fg2, fontSize: 13 }}>Contexto · <Text style={{ fontFamily: mono }}>{fmt(ctx.usado)}</Text> de{" "}
          <Text style={{ fontFamily: mono }}>{ctx.max ? fmt(ctx.max) : "?"}</Text> tokens</Text>
        {/* Barra empilhada: cada parte na proporção do que ocupa da janela. */}
        <View style={{ flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: c.line }}>
          {partes.length ? partes.map((x) => <View key={x.nome} style={{ width: `${(x.v / (ctx.max || total)) * 100}%`, backgroundColor: x.cor }} />)
            : <View style={{ width: `${Math.round(f * 100)}%`, backgroundColor: cor }} />}
        </View>
        {partes.map((x) => <Linha key={x.nome} k={x.nome} v={`~${fmtK(x.v)}`} cor={x.cor} />)}
        {!!ctx.compartilhado?.slots && ctx.compartilhado.slots > 1 && (
          <Text style={[s.faint, { fontSize: 12.5 }]}>
            Compartilhado · {ctx.compartilhado.slots} slots · <Text style={{ fontFamily: mono }}>{fmt(Math.round(ctx.compartilhado.total / ctx.compartilhado.slots))}</Text> cada
          </Text>
        )}
      </View>
      <View style={{ gap: 2 }}>
        <Text style={s.secao2}>CONVERSA</Text>
        {!!ctx.sessao?.passos && <Linha k="Turnos · passos" v={`${ctx.sessao.turnos} · ${ctx.sessao.passos}`} />}
        {!!ctx.sessao?.passos && <Linha k="Tokens somados" v={fmtK(ctx.sessao.tokens)} />}
        {!!ctx.sessao?.passos && <Linha k="Acerto de cache" v={ctx.sessao.cache == null ? "—" : `${Math.round(ctx.sessao.cache * 100)}%`} />}
        {ctx.ttft != null && <Linha k="Tempo até o 1º token" v={`${ctx.ttft.toFixed(2).replace(".", ",")} s`} />}
        {ctx.saida != null && <Linha k="Saída (último turno)" v={fmt(ctx.saida)} />}
        {ctx.media != null && <Linha k="Média" v={`${ctx.media.toFixed(2).replace(".", ",")} t/s`} />}
      </View>
      {cotas.map((q) => (
        <View key={q.provider} style={{ gap: 6 }}>
          <Text style={s.secao2}>COTA · {q.name.toUpperCase()}</Text>
          {q.limits.map((l) => {
            const pct = Math.min(100, Math.round(l.usage * 100));
            return (
              <View key={l.name} style={{ gap: 3 }}>
                <Linha k={l.name} v={`${pct}%`} />
                <View style={{ height: 4, borderRadius: 2, backgroundColor: c.line }}>
                  <View style={{ height: 4, borderRadius: 2, width: `${pct}%`, backgroundColor: pct >= 90 ? c.err : pct >= 70 ? c.warn : c.accent }} />
                </View>
              </View>
            );
          })}
        </View>
      ))}
      <Text style={[s.faint, { fontSize: 12.5, lineHeight: 18 }]}>
        Compactar resume o histórico antigo agora (também: /compactar). A conversa continua; só o que o modelo lê fica menor.
      </Text>
      <Botao altura={44} rotulo="Compactar agora" desabilitado={!podeCompactar} onPress={onCompactar} />
    </>
  );
}

/** Caixa de prompt do chat/agente/maestro: texto em cima; anexo, permissão, esforço, modelo e contexto embaixo. */
export default function Entrada(p: {
  kind: string; teclado: boolean; rodando: boolean; perm: string; onPerm: (v: string) => void;
  ajustes: Ajustes; onAjustes: (a: Ajustes, gguf?: string) => void; ctx: Contexto | null; podeCompactar: boolean; onCompactar: () => void;
  anexos: Anexo[]; enviando: boolean; onAnexar: () => void; onTiraAnexo: (path: string) => void;
  onEnvia: (t: string) => unknown; /* false = recusou: o texto fica no campo */ onPara: () => void; conv?: number | null;
  autonomo?: boolean; onAutonomo?: (v: boolean) => void; // trabalho autônomo nesta conversa (o mesmo do menu Modo no PC)
  acima?: ReactNode; // faixas do Agente (objetivo, tarefas)
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
  const pct = p.ctx && p.ctx.max ? Math.min(100, Math.round((p.ctx.usado / p.ctx.max) * 100)) : null;
  const corCtx = pct == null ? c.muted : pct >= 90 ? c.err : pct >= 70 ? c.warn : c.muted;
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: p.teclado ? 8 : Math.max(inset.bottom, 10) }}>
      {p.acima}
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
            <Chip icone={<Paperclip size={15} color={c.muted} />} onPress={p.onAnexar} />
            {agentica && (
              <Chip rotulo={p.autonomo ? `${perm.label} · auto` : perm.label} onPress={() => setMenu("perm")} cor={p.perm === "bypass" ? c.warn : undefined}
                    icone={<Shield size={14} color={p.perm === "bypass" ? c.warn : c.muted} />} />
            )}
            <Chip rotulo={esforco.rotulo} onPress={() => setMenu("esforco")} icone={<Brain size={14} color={c.muted} />} />
            <Chip rotulo={p.ajustes.model || "Modelo"} onPress={() => setMenu("modelo")} icone={<Cube size={14} color={c.muted} />} />
            {pct != null && <Chip rotulo={`${pct}%`} cor={corCtx} onPress={() => setMenu("contexto")} icone={<Gauge size={14} color={corCtx} />} />}
          </ScrollView>
          {p.rodando && !t.trim() ? (
            <Pressable onPress={p.onPara} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}>
              <Parar size={15} color={c.accentFg} />
            </Pressable>
          ) : <BotaoEnviar pode={pode} onPress={envia} />}
        </View>
      </View>
      <Folha aberta={menu === "perm"} titulo={`Permissões${p.rodando ? " · vale já na próxima ferramenta" : ""}`} onFecha={() => setMenu(null)}>
        <Lista opcoes={PERMISSOES.filter((x) => !(p.rodando && x.id === "plan"))
                  .map((x) => ({ id: x.id, rotulo: x.label, dica: x.hint, cor: x.id === "bypass" ? c.warn : undefined }))}
               valor={p.perm} onEscolhe={(v) => { setMenu(null); p.onPerm(v); }} />
        {p.onAutonomo && (
          <View style={{ borderTopWidth: 1, borderTopColor: c.line, paddingTop: 14 }}>
            <Opcao rotulo="Trabalho autônomo nesta conversa" valor={!!p.autonomo} onMuda={p.onAutonomo}
                   dica="O agente segue sozinho até cumprir o objetivo: com progresso recente, o limite de passos vira checkpoint em vez de parar." />
          </View>
        )}
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
