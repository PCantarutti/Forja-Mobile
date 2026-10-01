import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, TextInput } from "./Texto";
import * as DocumentPicker from "expo-document-picker";
import { api, enviaArquivos } from "./api";
import { pergunta } from "./Dialogo";
import { ArrowRight, Check, Refresh, Search, Trash, X } from "./icones";
import { useTeclado } from "./teclado";
import { c, mono, s } from "./tema";
import { Botao, Pulsa, Seletor, toast } from "./ui";
import { type Casca, type EstudosBusca, type EstudosPlacarSimulado, type EstudosQuestaoReal, type EstudosSimulado, numeros } from "./estudosTipos";

const cartao = (): ViewStyle => ({ backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.line, padding: 12, gap: 8 });
const ETAPA: Record<string, string> = {
  lendo: "Recortando as questões", classificando: "Classificando por assunto", resolvendo: "Resolvendo às cegas",
  ranking: "Juntando o que mais cai", buscando: "Buscando na web", escolhendo: "Escolhendo os PDFs", baixando: "Baixando e conferindo",
};
const pct = (a: number, t: number) => (t ? Math.round((a / t) * 100) : 0);
const corPct = (p: number) => (p >= 70 ? c.ok : p >= 50 ? c.warn : c.err);
type Fonte = "pdf" | "material" | "colar" | "imagem";

/** Aba Simulados (a do PC, EstudosSimulados): buscar provas reais na web, conferir a IA com o gabarito oficial,
 *  fazer o simulado como prova e ver o que mais cai. */
export default function Simulados({ casca, onProvas }: { casca: Casca; onProvas: () => void }) {
  const p = casca.p;
  const inset = useSafeAreaInsets();
  const teclado = useTeclado();
  const [pedido, setPedido] = useState("");
  const [form, setForm] = useState<{ material: number; fonte: Fonte; outro: number; texto: string } | null>(null);
  const [aberta, setAberta] = useState<number | null>(null);
  const [detalhe, setDetalhe] = useState<EstudosSimulado | null>(null);
  const [so, setSo] = useState<"div" | "todas">("div");
  const viva = casca.exec?.tipo === "simulado" || casca.exec?.tipo === "busca" ? casca.exec : null;
  const busca = viva?.tipo === "busca" ? viva : p?.busca ?? null;
  const analise = viva?.tipo === "simulado" ? viva : null;
  const ehGabarito = (m: { nome: string; gabarito?: boolean }) => !!m.gabarito || /^gabarito\b/i.test(m.nome);
  const provas = (p?.materiais ?? []).filter((m) => m.uso === "prova" && !ehGabarito(m));
  // gabarito anexado (a busca nomeia "Gabarito · ..."): já vem escolhido; senão, o do próprio PDF
  const novoForm = (material: number) => {
    // o de nome mais parecido, sem as palavras que todo nome tem ("pdf", "prova", "dia"…): "…_PV_…_CD12" casa com
    // "…_GB_…_CD12"; sem pelo menos 2 pedaços em comum, nenhum é sugerido (vale o do próprio PDF)
    const genericos = new Set(["pdf", "prova", "gabarito", "pv", "gb", "dia", "impresso", "caderno", "de", "da", "do", "fase"]);
    const pedacos = (t: string) => new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 1 && !genericos.has(x)));
    const nome = (p?.materiais ?? []).find((x) => x.id === material)?.nome ?? "";
    const meus = pedacos(nome);
    const gab = (p?.materiais ?? []).filter((x) => x.id !== material && /gabarito/i.test(x.nome))
      .map((x) => ({ x, n: [...pedacos(x.nome)].filter((t) => meus.has(t)).length }))
      .filter((g) => g.n >= 2).sort((a, b) => b.n - a.n)[0]?.x;
    return { material, fonte: (gab ? "material" : "pdf") as Fonte, outro: gab?.id ?? 0, texto: "" };
  };
  const simulados = p?.simulados ?? [];

  useEffect(() => {
    if (aberta == null) { setDetalhe(null); return; }
    api.get<EstudosSimulado>(`/estudos/execucao/${aberta}`).then(setDetalhe).catch((e) => casca.erro(e.message));
  }, [aberta, simulados.length, casca.carimbo]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function buscar() {
    const t = pedido.trim();
    if (t.length < 3) return;
    if (casca.exec) return toast("Espere terminar o que está rodando.");
    if (!casca.modelo) return toast("Escolha um modelo em Modelos (ou no chat) antes.");
    try {
      const id = await casca.garante();
      const u: EstudosBusca | null = await casca.segue(`/estudos/${id}/busca`, { pedido: t, ...casca.modelo });
      if (u?.status === "pronto") toast(`${u.anexados.length} PDF${u.anexados.length > 1 ? "s" : ""} anexado${u.anexados.length > 1 ? "s" : ""}.`);
      else if (u?.aviso) casca.erro(u.aviso);
    } catch (e: any) { casca.erro(e.message); }
  }

  async function conferir() {
    if (!form) return;
    if (casca.exec) return toast("Espere terminar o que está rodando.");
    if (!casca.modelo) return toast("Escolha um modelo em Modelos (ou no chat) antes.");
    const f = form;
    setForm(null);
    setAberta(null);
    try {
      const u: EstudosSimulado | null = await casca.segue(`/estudos/${casca.conv}/simulado`, {
        material_id: f.material, gabarito: f.fonte === "colar" ? f.texto : "", gabarito_material: f.fonte === "material" ? f.outro : 0, ...casca.modelo });
      if (u?.status === "pronto") setAberta(u.message_id);
      else if (u?.aviso) casca.erro(u.aviso);
    } catch (e: any) { casca.erro(e.message); }
  }

  async function parar() {
    if (viva) await api.post(`/estudos/execucao/${viva.message_id}/cancelar`).catch(() => {});
  }

  // Gabarito por imagem (o do PC): prints → um modelo que enxerga anota em texto, numa chamada só dele → material
  const [lendoImagem, setLendoImagem] = useState("");
  async function lerImagens() {
    if (!form || !casca.modelo) return toast("Escolha um modelo que enxerga em Modelos antes.");
    const r = await DocumentPicker.getDocumentAsync({ type: "image/*", multiple: true, copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.length) return;
    setLendoImagem(`lendo ${r.assets.length} imagem${r.assets.length === 1 ? "" : "ns"}…`);
    try {
      const j = await enviaArquivos<{ material: { id: number }; questoes: number; modelo: string; blocos: { rotulo: string; n: number }[] }>(
        `/estudos/${casca.conv}/gabarito/imagem`, r.assets.map((x) => ({ uri: x.uri, name: x.name })), { provider: casca.modelo.provider, model: casca.modelo.model });
      await casca.recarrega();
      setForm((f) => f && { ...f, fonte: "material", outro: j.material.id });
      setLendoImagem(`${j.questoes} respostas lidas por ${j.modelo}: ${j.blocos.map((b) => `${b.rotulo} (${b.n})`).join(", ")}`);
    } catch (e: any) { setLendoImagem(""); casca.erro(e.message); }
  }

  async function trocarBloco(id: number, bloco: string) {
    try { setDetalhe(await api.post<EstudosSimulado>(`/estudos/simulado/${id}/gabarito`, { bloco })); await casca.recarrega(); }
    catch (e: any) { casca.erro(e.message); }
  }

  async function virarProva(d: EstudosSimulado) {
    if (d.prova_id) return onProvas();
    try {
      await api.post(`/estudos/simulado/${d.message_id}/prova`, {});
      await casca.recarrega();
      onProvas();
    } catch (e: any) { casca.erro(e.message); }
  }

  function apagar(d: EstudosSimulado) {
    pergunta("Apagar esta conferência?", "A prova que saiu dela fica.", [
      { texto: "Cancelar", estilo: "cancelar" },
      { texto: "Apagar", estilo: "perigo", acao: () => api.del(`/estudos/simulado/${d.message_id}`).then(() => { setAberta(null); casca.recarrega(); }).catch((e) => casca.erro(e.message)) },
    ]);
  }

  return (
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: Math.max(inset.bottom, 14) + teclado }}>
      <View style={cartao()}>
        <Text style={{ color: c.fg, fontSize: 15, fontWeight: "600" }}>Buscar provas reais na web</Text>
        <Text style={[s.faint, { fontSize: 12.5, lineHeight: 18 }]}>O modelo procura o caderno e o gabarito oficial, baixa só PDF e anexa o que confere.</Text>
        <TextInput value={pedido} onChangeText={setPedido} placeholder="Ex.: ENEM 2023 2º dia, FUVEST 2024" placeholderTextColor={c.faint}
                   onSubmitEditing={buscar} returnKeyType="search" editable={!viva}
                   style={{ color: c.fg, fontSize: 15, borderWidth: 1, borderColor: c.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: c.raised }} />
        {viva?.tipo === "busca"
          ? <Botao rotulo="Parar" icone={<X size={15} color={c.fg} />} onPress={parar} />
          : <Botao primario rotulo="Buscar" icone={<Search size={15} color={c.accentFg} />} desabilitado={pedido.trim().length < 3 || !!casca.exec} onPress={buscar} />}
        {busca && <Busca b={busca} viva={viva?.tipo === "busca"} />}
      </View>

      <View style={cartao()}>
        <Text style={{ color: c.fg, fontSize: 15, fontWeight: "600" }}>Gabarito oficial × IA</Text>
        <Text style={[s.faint, { fontSize: 12.5, lineHeight: 18 }]}>A IA resolve as questões reais sem ver a resposta; o Forja compara com o gabarito oficial.</Text>
        {!provas.length && <Text style={[s.faint, { fontSize: 13 }]}>Anexe uma prova (ou busque acima) e marque como Prova.</Text>}
        {provas.map((m) => {
          const ultima = [...simulados].reverse().find((x) => x.material_id === m.id);
          const pl = ultima?.placar;
          return (
            <View key={m.id} style={{ gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.line }}>
              <Text style={{ color: c.fg, fontSize: 14 }} numberOfLines={2}>{m.nome}</Text>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                {!!pl?.resolvidas && (
                  <Pressable onPress={() => setAberta(aberta === ultima!.message_id ? null : ultima!.message_id)} hitSlop={6} style={{ flex: 1 }}>
                    <Text style={{ color: c.fg, fontFamily: mono, fontSize: 13 }}>IA {pl.acertos}/{pl.resolvidas} · {pct(pl.acertos ?? 0, pl.resolvidas)}%  ›</Text>
                  </Pressable>
                )}
                {!pl?.resolvidas && <View style={{ flex: 1 }} />}
                <Botao rotulo={ultima ? "Conferir de novo" : "Conferir a IA"} icone={ultima ? <Refresh size={14} color={c.fg} /> : undefined}
                       desabilitado={!!casca.exec} onPress={() => setForm(form?.material === m.id ? null : novoForm(m.id))} />
              </View>
              {form?.material === m.id && (
                <View style={{ gap: 8, backgroundColor: c.raised, borderRadius: 12, padding: 10 }}>
                  <Text style={s.secao2}>DE ONDE VEM O GABARITO</Text>
                  <Seletor cheio valor={form.fonte} onMuda={(fonte) => setForm({ ...form, fonte })}
                           opcoes={[{ id: "pdf", rotulo: "Do PDF" }, { id: "material", rotulo: "Material" }, { id: "colar", rotulo: "Colar" }, { id: "imagem", rotulo: "Imagem" }]} />
                  {form.fonte === "imagem" && (
                    <View style={{ gap: 6 }}>
                      <Botao rotulo="Escolher as imagens do gabarito" onPress={lerImagens} />
                      <Text style={[s.faint, { fontSize: 12.5, lineHeight: 18 }]}>
                        {lendoImagem || "Pode ser o gabarito inteiro, com vários cargos e versões: um modelo que enxerga anota em texto, separado da prova."}
                      </Text>
                    </View>
                  )}
                  {form.fonte === "material" && (provas.length < 2 && (p?.materiais.length ?? 0) < 2
                    ? <Text style={[s.faint, { fontSize: 13 }]}>Não há outro material no estudo.</Text>
                    : (p?.materiais ?? []).filter((x) => x.id !== m.id).map((x) => (
                      <Pressable key={x.id} onPress={() => setForm({ ...form, outro: x.id })} style={{ flexDirection: "row", gap: 8, alignItems: "center", paddingVertical: 4 }}>
                        <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: form.outro === x.id ? c.accent : c.lineStrong,
                                       backgroundColor: form.outro === x.id ? c.accent : "transparent" }} />
                        <Text style={{ color: c.fg, fontSize: 13.5, flex: 1 }} numberOfLines={1}>{x.nome}</Text>
                      </Pressable>
                    )))}
                  {form.fonte === "colar" && (
                    <TextInput value={form.texto} onChangeText={(texto) => setForm({ ...form, texto })} multiline placeholder="91 C  92 A  93 D …"
                               placeholderTextColor={c.faint}
                               style={{ color: c.fg, fontFamily: mono, fontSize: 13, minHeight: 70, borderWidth: 1, borderColor: c.line, borderRadius: 10, padding: 8 }} />
                  )}
                  <Botao primario rotulo="Conferir" onPress={conferir}
                         desabilitado={!!casca.exec || form.fonte === "imagem" || (form.fonte === "material" && !form.outro) || (form.fonte === "colar" && form.texto.trim().length < 3)} />
                </View>
              )}
              {analise?.material_id === m.id && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Pulsa cor={c.info} />
                  <Text style={{ color: c.fg, fontSize: 13.5, flex: 1 }}>{ETAPA[analise.etapa] ?? analise.etapa}{analise.progresso ? ` · ${analise.progresso}` : ""}</Text>
                  {!!analise.placar?.resolvidas && <Text style={{ color: c.muted, fontFamily: mono, fontSize: 12 }}>{analise.placar.acertos}/{analise.placar.resolvidas}</Text>}
                  <Pressable onPress={parar} hitSlop={8}><X size={16} color={c.muted} /></Pressable>
                </View>
              )}
              {ultima && aberta === ultima.message_id && detalhe?.message_id === ultima.message_id && (
                <Resultado d={detalhe} so={so} onSo={setSo} onProva={() => virarProva(detalhe)} onApagar={() => apagar(detalhe)}
                           onBloco={(b) => trocarBloco(detalhe.message_id, b)} />
              )}
            </View>
          );
        })}
      </View>

      {!!p?.ranking?.itens.length && (
        <View style={cartao()}>
          <Text style={{ color: c.fg, fontSize: 15, fontWeight: "600" }}>O que mais cai</Text>
          <Text style={[s.faint, { fontSize: 12.5 }]}>
            {p.ranking.questoes} questões de {p.ranking.simulados} simulado{p.ranking.simulados > 1 ? "s" : ""}, por assunto
          </Text>
          {p.ranking.itens.slice(0, 15).map((i) => {
            const max = Math.max(...p.ranking!.itens.map((x) => x.questoes), 1);
            return (
              <View key={i.assunto} style={{ gap: 3 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Text style={{ color: c.fg, fontSize: 13.5, flex: 1 }} numberOfLines={1}>{i.assunto}</Text>
                  <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12 }}>
                    {i.questoes} · {Math.round(i.fracao * 100)}%{p.ranking!.simulados > 1 ? ` · ${i.simulados}/${p.ranking!.simulados}` : ""}
                  </Text>
                </View>
                <View style={{ height: 5, borderRadius: 3, backgroundColor: c.raised }}>
                  <View style={{ height: 5, borderRadius: 3, backgroundColor: c.accent, width: `${(i.questoes / max) * 100}%` }} />
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

function Busca({ b, viva }: { b: EstudosBusca; viva: boolean }) {
  const COR: Record<string, string> = { anexado: c.ok, rejeitado: c.err, baixando: c.info, fila: c.faint };
  return (
    <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {viva && <Pulsa cor={c.info} />}
        <Text style={{ color: c.fg, fontSize: 13.5, flex: 1 }} numberOfLines={1}>
          {viva ? `${ETAPA[b.etapa] ?? b.etapa}${b.progresso ? ` · ${b.progresso}` : ""}` : `“${b.pedido}” · ${b.anexados.length ? `${b.anexados.length} anexado(s)` : "nada anexado"}`}
        </Text>
      </View>
      {b.candidatos.map((x, i) => (
        <Pressable key={`${i}:${x.url}`} onPress={() => Linking.openURL(x.url)} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Text style={{ color: COR[x.status], fontFamily: mono, fontSize: 11.5, width: 70 }}>{x.status}</Text>
          <Text style={{ color: c.fg, fontSize: 13, flex: 1 }} numberOfLines={2}>{x.tipo === "gabarito" ? "Gabarito · " : ""}{x.exame || x.titulo}{x.motivo && x.status === "rejeitado" ? ` — ${x.motivo}` : ""}</Text>
        </Pressable>
      ))}
      {!viva && !!b.aviso && <Text style={{ color: c.warn, fontSize: 12.5 }}>{b.aviso}</Text>}
      {!!numeros(b) && <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11 }}>{numeros(b)}</Text>}
    </View>
  );
}

function Barra({ nome, a, t }: { nome: string; a: number; t: number }) {
  if (!t) return null;
  return (
    <View style={{ gap: 3 }}>
      <View style={{ flexDirection: "row" }}>
        <Text style={{ color: c.muted, fontSize: 13, flex: 1 }}>{nome}</Text>
        <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12 }}>{a}/{t} · {pct(a, t)}%</Text>
      </View>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: c.raised }}>
        <View style={{ height: 5, borderRadius: 3, backgroundColor: corPct(pct(a, t)), width: `${pct(a, t)}%` }} />
      </View>
    </View>
  );
}

function Resultado({ d, so, onSo, onProva, onApagar, onBloco }: { d: EstudosSimulado; so: "div" | "todas"; onSo: (v: "div" | "todas") => void;
                                                       onProva: () => void; onApagar: () => void; onBloco: (id: string) => void }) {
  const [trocando, setTrocando] = useState(false);
  // conferência que parou no meio (erro, cancelada) não tem placar inteiro: tudo com valor padrão
  const pl: EstudosPlacarSimulado = { questoes: 0, com_gabarito: 0, resolvidas: 0, acertos: 0, em_branco: 0, por_area: [],
    so_texto: { resolvidas: 0, acertos: 0 }, figura_vista: { resolvidas: 0, acertos: 0 }, figura_faltou: { resolvidas: 0, acertos: 0 },
    ...(d.placar as Partial<EstudosPlacarSimulado>) };
  const pronta = d.status === "pronto";
  const qs = d.questoes.filter((q) => (so === "todas" ? true : q.certa === false));
  return (
    <View style={{ gap: 10, backgroundColor: c.raised, borderRadius: 12, padding: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={{ color: c.fg, fontSize: 26, fontWeight: "700" }}>{pct(pl.acertos, pl.resolvidas)}%</Text>
        <Text style={{ color: c.muted, fontSize: 13, flex: 1 }}>a IA acertou {pl.acertos} de {pl.resolvidas} · {d.stats.escritor}</Text>
      </View>
      {!!d.bloco && (
        // gabarito com vários cargos/versões: o bloco que valeu, por quê, e trocar sem resolver de novo
        <View style={{ gap: 6, borderWidth: 1, borderColor: c.line, borderRadius: 10, padding: 8 }}>
          <Pressable onPress={() => setTrocando((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ color: c.fg, fontSize: 13.5, flex: 1 }}>Gabarito: {d.bloco.rotulo || "escolha o bloco da sua prova"}</Text>
            <Text style={{ color: c.accentText, fontSize: 13 }}>{trocando ? "fechar" : "trocar"}</Text>
          </Pressable>
          {!!d.bloco.motivo && <Text style={[s.faint, { fontSize: 12 }]}>{d.bloco.motivo}</Text>}
          {trocando && d.bloco.opcoes.map((o) => (
            <Pressable key={o.id} onPress={() => { setTrocando(false); onBloco(o.id); }} style={{ flexDirection: "row", gap: 8, paddingVertical: 4 }}>
              <Text style={{ color: o.id === d.bloco!.id ? c.accentText : c.fg, fontSize: 13, flex: 1 }} numberOfLines={1}>{o.rotulo}</Text>
              {!!o.de && <Text style={{ color: c.faint, fontFamily: mono, fontSize: 12 }}>{o.iguais}/{o.de}</Text>}
            </Pressable>
          ))}
        </View>
      )}
      <Barra nome="Só texto" a={pl.so_texto?.acertos ?? 0} t={pl.so_texto?.resolvidas ?? 0} />
      <Barra nome="Com a figura (vista)" a={pl.figura_vista?.acertos ?? 0} t={pl.figura_vista?.resolvidas ?? 0} />
      <Barra nome="Faltou a figura" a={pl.figura_faltou?.acertos ?? 0} t={pl.figura_faltou?.resolvidas ?? 0} />
      {pl.por_area.map((a) => <Barra key={a.area} nome={a.area} a={a.acertos} t={a.total} />)}
      {!!pl.em_branco && <Text style={[s.faint, { fontSize: 12.5 }]}>{pl.em_branco} em branco (faltou dado, a IA não chutou)</Text>}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Botao primario flex rotulo={d.prova_id ? "Abrir a prova" : "Fazer o simulado"} icone={<ArrowRight size={15} color={c.accentFg} />}
               desabilitado={!pronta || !pl.com_gabarito} onPress={onProva} />
        <Botao rotulo="" icone={<Trash size={15} color={c.fg} />} onPress={onApagar} />
      </View>
      <Seletor cheio valor={so} onMuda={onSo}
               opcoes={[{ id: "div", rotulo: `Divergências · ${d.questoes.filter((q) => q.certa === false).length}` }, { id: "todas", rotulo: `Todas · ${d.questoes.length}` }]} />
      {qs.map((q) => <Linha key={q.numero} q={q} />)}
      {!qs.length && <Text style={[s.faint, { fontSize: 13 }]}>{so === "div" ? "Nenhuma divergência." : "—"}</Text>}
    </View>
  );
}

function Linha({ q }: { q: EstudosQuestaoReal }) {
  const [abre, setAbre] = useState(false);
  const cor = q.certa === false ? c.err : q.certa ? c.ok : c.faint;
  return (
    <Pressable onPress={() => setAbre((v) => !v)} style={{ gap: 4, paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.line }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Text style={{ color: c.muted, fontFamily: mono, fontSize: 12.5, width: 30 }}>{q.numero}</Text>
        <Text style={{ color: cor, fontFamily: mono, fontSize: 12.5, width: 84 }}>{q.ia ? `IA ${q.ia}` : "branco"} · {q.oficial || "?"}</Text>
        <Text style={{ color: c.fg, fontSize: 13, flex: 1 }} numberOfLines={1}>{q.assunto || q.area}</Text>
        {q.figura === "faltou" && <Text style={{ color: c.warn, fontSize: 11 }}>sem figura</Text>}
        {q.certa && <Check size={14} color={c.ok} />}
      </View>
      {abre && (
        <View style={{ gap: 3, paddingLeft: 38 }}>
          <Text style={[s.faint, { fontSize: 12.5 }]}>{q.inicio}…</Text>
          {!!q.conta && <Text style={{ color: c.muted, fontSize: 12.5 }}>IA: {q.conta}</Text>}
          {!!q.motivo && <Text style={[s.faint, { fontSize: 12 }]}>{q.motivo}</Text>}
        </View>
      )}
    </Pressable>
  );
}
