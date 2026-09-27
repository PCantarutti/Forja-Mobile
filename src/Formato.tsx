import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { api, lerAjustes, salvaAjustes } from "./api";
import { Cube, Trocar } from "./icones";
import ModelosFolha from "./Modelos";
import { c, mono, s } from "./tema";
import { Text, TextInput } from "./Texto";
import { Botao, CartaoProporcao, Campo, Chip, Contador, LinhaAjuste, Recolhivel, Seletor, toast } from "./ui";

// Formato.tsx / videoConta.ts do desktop, para Imagens e Vídeo.
export type Qualidade = { id: string; rotulo?: string; off?: boolean };
export const encaixa = (v: number, m: number) => Math.max(m, Math.round(v / m) * m);
const par = (f: string) => f.split(":").map(Number) as [number, number];

/** Razão simplificada de w×h: a fração mais perto com denominador até 32 (razaoSimples do desktop). */
export function razao(w: number, h: number): [number, number] {
  let melhor: [number, number] = [1, 1], erro = Infinity;
  for (let b = 1; b <= 32; b++) {
    const a = Math.max(1, Math.round((w / h) * b));
    const e = Math.abs(a / b - w / h);
    if (e < erro - 1e-9) { erro = e; melhor = [a, b]; }
  }
  return melhor;
}
/** Mantém o lado menor e muda a razão para a:b, no múltiplo que o modelo pede (tamanhoNaRazao). */
function naRazao(w: number, h: number, a: number, b: number, mult: number): [number, number] {
  const menor = Math.min(w, h), r = a / b;
  return r >= 1 ? [encaixa(menor * r, mult), encaixa(menor, mult)] : [encaixa(menor, mult), encaixa(menor / r, mult)];
}
/** A proporção fixa (em paisagem) a até 3% de w×h, em qualquer orientação. */
export function formaDe(formas: string[], w: number, h: number) {
  const r = Math.max(w, h) / Math.min(w, h);
  return formas.find((f) => { const [a, b] = par(f); return Math.abs(r - a / b) / (a / b) <= 0.03; });
}

/** Proporções só em paisagem (a de retrato sai do botão de girar), Livre com a:b, e o tamanho (lado menor). */
export function Formato({ formas, quals, tamanhoPara, w, h, mult, onMuda, dicaQual }: {
  formas: string[]; quals: Qualidade[]; tamanhoPara: (forma: string, q: string) => [number, number];
  w: number; h: number; mult: number; onMuda: (w: number, h: number) => void; dicaQual?: string;
}) {
  const retrato = h > w;
  const orienta = ([x, y]: [number, number]): [number, number] => (retrato ? [y, x] : [x, y]);
  const forma = formaDe(formas, w, h);
  const [livreClicado, setLivre] = useState(!forma);
  const livre = livreClicado || !forma;
  const qual = quals.find((q) => Math.min(...tamanhoPara(forma ?? formas[0], q.id)) === Math.min(w, h));
  const [a, b] = razao(w, h);
  // Rascunho só enquanto digita; fora disso os campos mostram a razão atual.
  const [rasc, setRasc] = useState<[string, string] | null>(null);
  const [ta, tb] = rasc ?? [String(a), String(b)];
  const aplica = (x: string, y: string) => {
    setRasc(null);
    const na = Math.min(64, Math.max(1, Number(x) || 1)), nb = Math.min(64, Math.max(1, Number(y) || 1));
    onMuda(...naRazao(w, h, na, nb, mult));
  };
  const mudaQual = (q: string) => {
    if (!livre && forma) return onMuda(...orienta(tamanhoPara(forma, q)));
    // Livre: o lado menor vem do tamanho escolhido e a razão fica a mesma.
    const menor = Math.min(...tamanhoPara(formas[0], q)), r = w / h;
    onMuda(...(r >= 1 ? [encaixa(menor * r, mult), menor] : [menor, encaixa(menor / r, mult)]) as [number, number]);
  };
  const campo = { width: 44, height: 38, borderRadius: 9, borderWidth: 1, borderColor: c.line, backgroundColor: c.bg, color: c.fg,
                  fontFamily: mono, fontSize: 14, textAlign: "center" as const, padding: 0 };
  return (
    <>
      <Campo rotulo="Proporção">
        <View style={{ flexDirection: "row", gap: 8 }}>
          {formas.map((f) => {
            const [fa, fb] = par(f);
            const [tw, th] = orienta(tamanhoPara(f, qual?.id ?? quals[0].id));
            return <CartaoProporcao key={f} cheio rotulo={retrato && fa !== fb ? `${fb}:${fa}` : f} w={tw} h={th} px={`${tw}×${th}`}
                                    on={!livre && forma === f} onPress={() => { setLivre(false); onMuda(tw, th); }} />;
          })}
          <CartaoProporcao cheio rotulo={livre ? `${a}:${b}` : "Livre"} w={w} h={h} px={livre ? `${w}×${h}` : "a:b"} on={livre}
                           onPress={() => setLivre(true)} />
          {/* Girar: paisagem ↔ retrato, para qualquer proporção (o "inverter" do Livre do desktop). */}
          <Pressable onPress={() => onMuda(h, w)} accessibilityLabel="Girar (retrato ↔ paisagem)"
                     style={{ width: 48, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface,
                              alignItems: "center", justifyContent: "center", gap: 6 }}>
            <Trocar size={18} color={c.fg} />
            <Text style={{ color: c.muted, fontSize: 11 }}>Girar</Text>
          </Pressable>
        </View>
        {livre && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.surface, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 }}>
            <Text style={s.muted}>Proporção</Text>
            <TextInput style={campo} keyboardType="number-pad" value={ta} onChangeText={(v) => setRasc([v, tb])} onEndEditing={() => aplica(ta, tb)} />
            <Text style={{ color: c.faint }}>:</Text>
            <TextInput style={campo} keyboardType="number-pad" value={tb} onChangeText={(v) => setRasc([ta, v])} onEndEditing={() => aplica(ta, tb)} />
            <Text style={{ flex: 1, textAlign: "right", color: c.faint, fontFamily: mono, fontSize: 11 }}>{w}×{h} px · múltiplos de {mult}</Text>
          </View>
        )}
      </Campo>
      <Campo rotulo="Tamanho" dica={qual?.off ? dicaQual : undefined}>
        <Seletor cheio mono opcoes={quals.map((q) => ({ id: q.id, rotulo: q.rotulo ?? q.id, off: q.off }))} valor={qual?.id ?? ""} onMuda={mudaQual} />
      </Campo>
    </>
  );
}

/** Modelo de texto do "Melhorar" de cada aba (o picker do desktop); sem escolha, o do Chat. */
export async function modeloMelhorar(aba: "imagem" | "video") {
  const p = await lerAjustes<{ provider: string; model: string }>(`${aba}.llm`, { provider: "", model: "" });
  if (p.model) return p;
  const m = await lerAjustes<{ provider: string; model: string }>("modelo", { provider: "", model: "" });
  return m.model ? m : (await api.get<{ defaults: { provider: string; model: string } }>("/mobile")).defaults;
}
export function CampoMelhorar({ aba }: { aba: "imagem" | "video" }) {
  const [m, setM] = useState<{ provider: string; model: string } | null>(null);
  const [abre, setAbre] = useState(false);
  useEffect(() => { lerAjustes(`${aba}.llm`, { provider: "", model: "" }).then(setM); }, [aba]);
  return (
    <Campo rotulo="Melhorar prompt" dica="O modelo de texto que reescreve o prompt. Sem escolha, usa o do Chat.">
      <View style={{ flexDirection: "row" }}>
        <Chip rotulo={m?.model || "o do Chat"} max={260} icone={<Cube size={14} color={c.muted} />} onPress={() => setAbre(true)} />
      </View>
      <ModelosFolha aberto={abre} desligar="o do Chat" onFecha={() => setAbre(false)} onEscolhe={([e]) => {
        const v = { provider: e.provider ?? "", model: e.model ?? "" };
        setAbre(false); setM(v); salvaAjustes(`${aba}.llm`, v);
      }} />
    </Campo>
  );
}

/** Rodapé do painel do desktop: a pasta no PC, quando as descartadas somem e esvaziar agora. */
export function ArquivosPC({ pasta, padrao, onPasta, dias, onDias }:
  { pasta: string; padrao?: string; onPasta: (p: string) => void; dias: number; onDias: (n: number) => void }) {
  const [rasc, setT] = useState<string | null>(null);
  const t = rasc ?? pasta;
  return (
    <Recolhivel titulo="Arquivos no PC" sub={pasta || padrao || ""}>
      <Campo rotulo="Salvar em" dica="Pasta no PC. Vazio = a pasta padrão.">
        <TextInput style={[s.input, { fontFamily: mono, fontSize: 12.5 }]} value={t} onChangeText={setT} placeholder={padrao}
                   placeholderTextColor={c.faint} autoCapitalize="none" autoCorrect={false} onEndEditing={() => { setT(null); if (t !== pasta) onPasta(t.trim()); }} />
      </Campo>
      <LinhaAjuste rotulo="Descartadas somem em" sub={dias ? undefined : "0 = nunca"}>
        <Contador valor={dias} min={0} max={365} sufixo={dias === 1 ? " dia" : " dias"} onMuda={onDias} />
      </LinhaAjuste>
      <Botao rotulo="Esvaziar descartadas agora" onPress={() =>
        api.post<{ apagados: number }>("/imagens/descartadas/limpar")
          .then((r) => toast(r.apagados ? `${r.apagados} ${r.apagados === 1 ? "arquivo apagado" : "arquivos apagados"}.` : "Nenhuma descartada."))
          .catch((e) => toast(e.message))} />
    </Recolhivel>
  );
}
