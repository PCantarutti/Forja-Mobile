import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "./api";
import { ArrowLeft, Brain, Code, Cpu, Cube, Divide, Download, Globo, Seta, Shield, Sliders, Split, Trash, Wrench } from "./icones";
import Modelos from "./Modelos";
import { useTeclado } from "./teclado";
import { Text, TextInput } from "./Texto";
import { aplicaFonte, aplicaTema, c, FONTES, fonteAtual, mono, s, TEMAS, temaAtual } from "./tema";
import { Area, Botao, Campo, Contador, LinhaAjuste, Opcao, Quadrado, Radio, Seletor, toast } from "./ui";

// Configurações do PC no celular (Settings.tsx do desktop): as 9 abas que cabem no celular. Tudo salva no PC pelo
// PUT /settings, menos o tema e a fonte, que valem por aparelho.
type Par = { provider: string; model: string };
type Provedor = { id: string; name: string; type: string; url: string; has_api_key?: boolean; api_key_hint?: string };
type Cfg = {
  providers: Provedor[]; enabled_models: Record<string, string[] | undefined>; disabled_tools: string[];
  auto_approve_commands: string[]; auto_approve_tools: string[]; trusted_hooks: string[]; auto_review: boolean;
  subagents: Record<"rapido" | "capaz" | "nuvem", Par>; subagent_max_iterations: number; nuvem_por_papel?: Record<string, boolean>;
  maestro_model: Par; maestro_visual: Par; max_workers: number; revisao: string; model_lifecycle: string; maestro_browser: boolean;
  maestro_max_attempts: number; maestro_max_iterations: number; personal_memory: boolean; project_memory: boolean; project_memory_file: string;
};
type Aba = "tema" | "provedores" | "subagentes" | "maestro" | "ferramentas" | "skills" | "permissoes" | "memoria" | "runtime";
const ABAS: { grupo: string; itens: { id: Aba; titulo: string; dica: string; Icone: typeof Cube }[] }[] = [
  { grupo: "APP", itens: [{ id: "tema", titulo: "Tema e fonte", dica: "Cores, destaque e fonte", Icone: Sliders }] },
  { grupo: "MODELOS", itens: [
    { id: "provedores", titulo: "Provedores", dica: "Onde os modelos rodam", Icone: Globo },
    { id: "subagentes", titulo: "Subagentes", dica: "delegate_task: o agente escolhe o nível", Icone: Split }] },
  { grupo: "AGENTE", itens: [
    { id: "maestro", titulo: "Maestro", dica: "Planeja, despacha e valida", Icone: Divide },
    { id: "ferramentas", titulo: "Ferramentas", dica: "O que está desligado não vai no prompt", Icone: Wrench },
    { id: "skills", titulo: "Skills", dica: "Comandos / seus, do projeto e do Forja", Icone: Code },
    { id: "permissoes", titulo: "Permissões", dica: "O que roda sem pedir aprovação", Icone: Shield },
    { id: "memoria", titulo: "Memória", dica: "Pessoal e do projeto", Icone: Brain }] },
  { grupo: "MÁQUINA", itens: [{ id: "runtime", titulo: "Runtime", dica: "llama.cpp e stable-diffusion.cpp", Icone: Cpu }] },
];
const SLOTS = [
  { key: "rapido", title: "Rápido", hint: "Modelo menor e rápido para tarefas simples: buscar, listar, resumir, edições óbvias." },
  { key: "capaz", title: "Capaz", hint: "Modelo maior e mais lento para raciocínio difícil: depurar, projetar, código complexo." },
  { key: "nuvem", title: "Nuvem", hint: "Rede de segurança: entra quando o slot escolhido não roda nesta máquina ou falha (ex.: Ollama Cloud). O modelo nunca escolhe este slot sozinho." },
] as const;
const CICLOS: [string, string, string][] = [
  ["persistent", "Persistente", "O modelo fica carregado entre tarefas. Mais rápido quando o mesmo modelo faz várias."],
  ["unload_after_task", "Descarregar após a tarefa", "Libera VRAM/RAM ao fim de cada tarefa. Para quem troca de modelo com pouca memória."],
  ["unload_clear", "Descarregar e esperar a memória voltar", "Descarrega e só segue quando a VRAM livre para de subir: o driver devolve a memória depois do processo morrer, e o próximo modelo carregado antes disso cairia para a CPU."],
  ["restart_after_task", "Reiniciar o modelo após a tarefa", "Processo novo com o mesmo modelo, cache zerado. Para modelo que fica lento ou instável depois de muitas tarefas."],
];
const REVISAO: Record<string, string> = {
  off: "Desligada: a tarefa vai para o commit assim que o teste passa.",
  avisa: "Depois de o teste passar, o modelo da Maestro confere cada critério de aceite contra o diff e aponta o que não foi atendido; a Maestro decide.",
  bloqueia: "Depois de o teste passar, o modelo confere cada critério contra o diff; faltou algo, a tarefa volta ao Worker uma vez e, persistindo, a tentativa falha.",
};
const PAPEIS = [["explorador", "Explorador (explore)", "Varre o código só lendo e devolve um relatório."],
  ["revisor", "Revisão do diff", "O parecer sobre o que a delegação mudou."],
  ["visual", "Revisão visual", "Julga os prints das telas. Sem modelo com visão carregado, é pulada."]] as const;
const ORIGEM: Record<string, string> = { usuario: "seu", projeto: "do projeto", forja: "do Forja" };

/** Nota com borda à esquerda (âmbar para aviso). */
const Nota = ({ t, ambar, icone }: { t: string; ambar?: boolean; icone?: React.ReactNode }) => (
  <View style={{ flexDirection: "row", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: ambar ? "rgba(252,211,77,0.3)" : c.line,
                 backgroundColor: ambar ? "rgba(252,211,77,0.06)" : c.surface, padding: 12 }}>
    {icone}
    <Text style={{ color: ambar ? "#fde68a" : c.muted, fontSize: 12.5, lineHeight: 18, flex: 1 }}>{t}</Text>
  </View>
);
/** Caixa de seleção de modelo (altura 46): Cube, o nome mono e o chevron. */
const CaixaModelo = ({ v, onPress }: { v?: Par | null; onPress: () => void }) => (
  <Pressable onPress={onPress} style={{ height: 46, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface,
                                        flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 }}>
    <Cube size={15} color={c.muted} />
    <Text style={{ color: v?.model ? c.fg : c.faint, fontFamily: mono, fontSize: 13, flex: 1 }} numberOfLines={1}>{v?.model || "(desligado)"}</Text>
    <Seta size={15} color={c.faint} />
  </Pressable>
);

export default function Configuracoes({ aberta, onFecha, onAparencia }: { aberta: boolean; onFecha: () => void; onAparencia: () => void }) {
  const inset = useSafeAreaInsets();
  const teclado = useTeclado();
  const [aba, setAba] = useState<Aba | null>(null);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState("");
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (aberta) api.get<Cfg>("/settings").then(setCfg).catch((e) => setErro(e.message)); else setAba(null); }, [aberta]);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => (aberta && aba ? (setAba(null), true) : false));
    return () => sub.remove();
  }, [aberta, aba]);
  /** PUT /settings com o pedaço mudado; o "✓ salvo no PC" aparece por 1,6 s. */
  const salva = (patch: Partial<Cfg>) => {
    setCfg((x) => (x ? { ...x, ...patch } : x));
    api.put<Cfg>("/settings", patch).then((n) => {
      setCfg(n);
      setSalvo(true);
      if (t.current) clearTimeout(t.current);
      t.current = setTimeout(() => setSalvo(false), 1600);
    }).catch((e) => { setErro(e.message); api.get<Cfg>("/settings").then(setCfg).catch(() => {}); });
  };
  const atual = ABAS.flatMap((g) => g.itens).find((x) => x.id === aba);
  const valor: Partial<Record<Aba, string>> = cfg ? {
    tema: TEMAS.find((x) => x.id === temaAtual)?.nome, provedores: String(cfg.providers.length),
    ferramentas: cfg.disabled_tools.length ? `${cfg.disabled_tools.length} off` : undefined,
    permissoes: String(cfg.auto_approve_commands.length + cfg.auto_approve_tools.length),
  } : {};
  return (
    <Modal visible={aberta} animationType="slide" onRequestClose={() => (aba ? setAba(null) : onFecha())} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: inset.top, paddingBottom: teclado }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, height: 60 }}>
          <Pressable hitSlop={8} onPress={() => (aba ? setAba(null) : onFecha())} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <ArrowLeft size={21} color={c.fg} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.fg, fontSize: 16, fontWeight: "600" }}>{atual?.titulo ?? "Configurações"}</Text>
            <Text style={{ color: c.faint, fontSize: 12 }} numberOfLines={1}>{atual?.dica ?? "O que vale no PC, mexido daqui"}</Text>
          </View>
          {salvo && <Text style={{ color: c.ok, fontSize: 12, marginRight: 8 }}>✓ salvo no PC</Text>}
        </View>
        {!!erro && <Text style={{ color: c.err, fontSize: 13, paddingHorizontal: 16, paddingBottom: 6 }} onPress={() => setErro("")}>{erro}</Text>}
        {!cfg ? <ActivityIndicator style={{ marginTop: 40 }} color={c.muted} /> : !aba ? (
          <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 8, paddingBottom: inset.bottom + 24 }}>
            {ABAS.map((g) => (
              <View key={g.grupo} style={{ gap: 8, marginTop: 10 }}>
                <Text style={s.secao2}>{g.grupo}</Text>
                {g.itens.map(({ id, titulo, dica, Icone }) => (
                  <Pressable key={id} onPress={() => setAba(id)}
                             style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12,
                               backgroundColor: pressed ? c.raised : c.surface })}>
                    <Quadrado><Icone size={17} color={c.fg} /></Quadrado>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.fg, fontSize: 15 }}>{titulo}</Text>
                      <Text style={{ color: c.faint, fontSize: 12.5 }} numberOfLines={1}>{dica}</Text>
                    </View>
                    {!!valor[id] && <Text style={{ color: c.muted, fontFamily: mono, fontSize: 12 }}>{valor[id]}</Text>}
                    <Seta size={16} color={c.faint} />
                  </Pressable>
                ))}
              </View>
            ))}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 18, paddingBottom: inset.bottom + 24 }} keyboardShouldPersistTaps="handled">
            {aba === "tema" && <AbaTema onMuda={onAparencia} />}
            {aba === "provedores" && <AbaProvedores cfg={cfg} salva={salva} />}
            {aba === "subagentes" && <AbaSubagentes cfg={cfg} salva={salva} />}
            {aba === "maestro" && <AbaMaestro cfg={cfg} salva={salva} />}
            {aba === "ferramentas" && <AbaFerramentas cfg={cfg} salva={salva} onErro={setErro} />}
            {aba === "skills" && <AbaSkills onErro={setErro} />}
            {aba === "permissoes" && <AbaPermissoes cfg={cfg} salva={salva} />}
            {aba === "memoria" && <AbaMemoria cfg={cfg} salva={salva} onErro={setErro} />}
            {aba === "runtime" && <AbaRuntime onErro={setErro} />}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function AbaTema({ onMuda }: { onMuda: () => void }) {
  const [tema, setTema] = useState(temaAtual);
  const [fonte, setFonte] = useState(fonteAtual);
  return (
    <>
      <Nota t="O tema vale neste celular. O desktop guarda o dele em separado." />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {TEMAS.map((x) => (
          <Pressable key={x.id} onPress={() => { setTema(x.id); aplicaTema(x.id); onMuda(); }}
                     style={{ width: "31.5%", borderRadius: 12, borderWidth: tema === x.id ? 2 : 1, borderColor: tema === x.id ? x.v.accent : c.line,
                              backgroundColor: x.v.surface, padding: 10, gap: 8, alignItems: "center" }}>
            <View style={{ flexDirection: "row", gap: 4 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: x.v.bg, borderWidth: 1, borderColor: x.v.lineStrong }} />
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: x.v.accent }} />
            </View>
            <Text style={{ color: x.v.fg, fontSize: 13 }}>{x.nome}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ gap: 8 }}>
        <Text style={s.secao2}>FONTE</Text>
        {FONTES.map((f) => (
          <Radio key={f.id} on={fonte === f.id} onPress={() => { setFonte(f.id); aplicaFonte(f.id); onMuda(); }}>
            <Text style={{ color: c.fg, fontSize: 14.5, fontFamily: f.sans }}>{f.nome}</Text>
            <Text style={{ color: c.faint, fontSize: 12, fontFamily: f.mono }}>0123 · caminho/arquivo.ts</Text>
          </Radio>
        ))}
      </View>
    </>
  );
}

function AbaProvedores({ cfg, salva }: { cfg: Cfg; salva: (p: Partial<Cfg>) => void }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const [modelos, setModelos] = useState<Record<string, string[] | string>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  useEffect(() => {
    api.get<{ id: string; error?: string; models: string[] }[]>("/catalog")
      .then((l) => setErros(Object.fromEntries(l.filter((p) => !p.models.length && p.error).map((p) => [p.id, p.error!])))).catch(() => {});
  }, []);
  const abre = (id: string) => {
    setAberto(aberto === id ? null : id);
    if (modelos[id]) return;
    api.get<{ models: string[] }>(`/models?provider=${encodeURIComponent(id)}&all=1`)
      .then((r) => setModelos((m) => ({ ...m, [id]: r.models }))).catch((e) => setModelos((m) => ({ ...m, [id]: e.message })));
  };
  return (
    <>
      {cfg.providers.map((p) => {
        const todos = modelos[p.id];
        const escolhidos = cfg.enabled_models[p.id];
        const ligado = (m: string) => !escolhidos || escolhidos.includes(m);
        const alterna = (m: string) => {
          const lista = Array.isArray(todos) ? todos : [];
          const base = escolhidos ?? lista;
          const prox = ligado(m) ? base.filter((x) => x !== m) : [...base, m];
          salva({ enabled_models: { ...cfg.enabled_models, [p.id]: lista.length && prox.length === lista.length ? undefined : prox } });
        };
        return (
          <View key={p.id} style={{ backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.line, overflow: "hidden" }}>
            <Pressable onPress={() => abre(p.id)} style={{ padding: 12, gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: erros[p.id] ? c.err : c.ok }} />
                <Text style={{ color: c.fg, fontSize: 15, fontWeight: "600", flex: 1 }} numberOfLines={1}>{p.name}</Text>
                <Text style={{ color: c.faint, fontSize: 11, backgroundColor: c.raised, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" }}>{p.type}</Text>
              </View>
              <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }} numberOfLines={1}>{p.url}</Text>
              <Text style={{ color: c.muted, fontSize: 12.5 }}>{escolhidos ? `${escolhidos.length} ativos` : "todos ativos"}{p.api_key_hint ? ` · chave ${p.api_key_hint}` : ""}</Text>
            </Pressable>
            {aberto === p.id && (
              <View style={{ borderTopWidth: 1, borderTopColor: c.line, padding: 12, gap: 12 }}>
                {!!p.api_key_hint && <Nota ambar t={`Chave salva no PC (${p.api_key_hint}). Ela não volta para o celular.`} />}
                <Text style={s.secao2}>MODELOS HABILITADOS</Text>
                {!todos ? <ActivityIndicator color={c.muted} /> : typeof todos === "string" ? <Text style={{ color: c.err, fontSize: 12.5 }}>{todos}</Text> :
                  todos.map((m) => <Opcao key={m} rotulo={m} valor={ligado(m)} onMuda={() => alterna(m)} />)}
              </View>
            )}
          </View>
        );
      })}
      <Nota t="Adicionar um provedor novo (URL e chave) continua no desktop: é onde dá para testar a conexão." />
    </>
  );
}

function AbaSubagentes({ cfg, salva }: { cfg: Cfg; salva: (p: Partial<Cfg>) => void }) {
  const [escolhe, setEscolhe] = useState<"rapido" | "capaz" | "nuvem" | null>(null);
  const semNuvem = !cfg.subagents.nuvem?.model;
  return (
    <>
      <Text style={[s.muted, { lineHeight: 19 }]}>
        O agente principal pode delegar uma subtarefa com delegate_task e escolhe o nível pela dificuldade. O subagente usa as mesmas ferramentas,
        aprovações e pasta de trabalho; só o relatório final dele volta para a conversa. Sem nenhum slot configurado, a ferramenta não é oferecida ao modelo.
      </Text>
      {SLOTS.map((sl) => (
        <Campo key={sl.key} rotulo={sl.title} dica={sl.hint}>
          <CaixaModelo v={cfg.subagents[sl.key]} onPress={() => setEscolhe(sl.key)} />
        </Campo>
      ))}
      <View style={{ gap: 12 }}>
        <Text style={s.secao2}>PAPÉIS QUE PODEM USAR A NUVEM</Text>
        {PAPEIS.map(([k, rot, dica]) => (
          <Opcao key={k} rotulo={rot} dica={dica} desabilitada={semNuvem} valor={!!cfg.nuvem_por_papel?.[k]}
                 onMuda={(v) => salva({ nuvem_por_papel: { explorador: false, revisor: false, visual: false, ...cfg.nuvem_por_papel, [k]: v } })} />
        ))}
        <Nota ambar t={semNuvem ? "Configure o slot Nuvem acima para liberar. O código desses papéis sai da máquina quando vão para a nuvem."
                                 : "O código desses papéis sai da máquina quando vão para a nuvem."} />
      </View>
      <LinhaAjuste rotulo="Máximo de passos por subagente" sub="Evita que um subagente fique rodando sem fim.">
        <Contador valor={cfg.subagent_max_iterations} min={5} max={200} passo={5} onMuda={(n) => salva({ subagent_max_iterations: n })} />
      </LinhaAjuste>
      <Modelos aberto={escolhe != null} desligar soProvedor={escolhe === "nuvem"} onFecha={() => setEscolhe(null)} onEscolhe={([e]) => {
        const k = escolhe!;
        setEscolhe(null);
        salva({ subagents: { ...cfg.subagents, [k]: e.nome ? { provider: e.provider ?? "local", model: e.model ?? e.nome } : { provider: "", model: "" } } });
      }} />
    </>
  );
}

function AbaMaestro({ cfg, salva }: { cfg: Cfg; salva: (p: Partial<Cfg>) => void }) {
  const [escolhe, setEscolhe] = useState<"maestro" | "rapido" | "capaz" | "visual" | null>(null);
  const paralelo = cfg.max_workers > 1;
  return (
    <>
      <Campo rotulo="Modelo padrão" dica="Usado na seção Maestro. Separado do modelo do chat e do agente. Vazio = o modelo escolhido no chat.">
        <CaixaModelo v={cfg.maestro_model} onPress={() => setEscolhe("maestro")} />
      </Campo>
      <Campo rotulo="Worker rápido" dica="Tarefas simples. A Maestro escolhe o nível por tarefa.">
        <CaixaModelo v={cfg.subagents.rapido} onPress={() => setEscolhe("rapido")} />
      </Campo>
      <Campo rotulo="Worker capaz" dica="Tarefas difíceis, e o padrão quando a tarefa não diz.">
        <CaixaModelo v={cfg.subagents.capaz} onPress={() => setEscolhe("capaz")} />
      </Campo>
      <Campo rotulo="Execução dos Workers" dica="Sequencial: um por vez, o único modo que troca de modelo local entre tarefas. Paralelo: tarefas independentes e sem arquivo em comum rodam juntas.">
        <Seletor cheio valor={paralelo ? "p" : "s"} opcoes={[{ id: "s", rotulo: "Sequencial" }, { id: "p", rotulo: "Paralelo" }]}
                 onMuda={(v) => salva({ max_workers: v === "p" ? Math.max(2, cfg.max_workers) : 1 })} />
      </Campo>
      {paralelo && (
        <LinhaAjuste rotulo="Até quantos Workers">
          <Contador valor={cfg.max_workers} min={2} max={8} onMuda={(n) => salva({ max_workers: n })} />
        </LinhaAjuste>
      )}
      <Campo rotulo="Revisão de código" dica={REVISAO[cfg.revisao ?? "avisa"]}>
        <Seletor cheio valor={cfg.revisao ?? "avisa"} opcoes={[{ id: "off", rotulo: "Desligada" }, { id: "avisa", rotulo: "Avisa" }, { id: "bloqueia", rotulo: "Bloqueia" }]}
                 onMuda={(v) => salva({ revisao: v })} />
      </Campo>
      <View style={{ gap: 8 }}>
        <Text style={s.secao2}>CICLO DE VIDA DO MODELO LOCAL</Text>
        {CICLOS.map(([id, rot, dica]) => (
          <Radio key={id} on={cfg.model_lifecycle === id} onPress={() => salva({ model_lifecycle: id })}>
            <Text style={{ color: c.fg, fontSize: 14.5 }}>{rot}</Text>
            <Text style={{ color: c.muted, fontSize: 12.5, lineHeight: 18 }}>{dica}</Text>
          </Radio>
        ))}
      </View>
      <Opcao rotulo="Validar entregas no navegador" valor={cfg.maestro_browser} onMuda={(v) => salva({ maestro_browser: v })}
             dica="A Maestro abre a tela no navegador para conferir estrutura e erros de console. Desligado, ela valida só por testes e comandos, e o prompt fica menor." />
      {cfg.maestro_browser && (
        <Campo rotulo="Revisão visual" dica="Julga os prints desktop e mobile de cada entrega com tela. Precisa enxergar imagem: em IA local, um GGUF com projetor mmproj.">
          <CaixaModelo v={cfg.maestro_visual} onPress={() => setEscolhe("visual")} />
        </Campo>
      )}
      <LinhaAjuste rotulo="Tentativas por tarefa">
        <Contador valor={cfg.maestro_max_attempts} min={1} max={10} onMuda={(n) => salva({ maestro_max_attempts: n })} />
      </LinhaAjuste>
      <LinhaAjuste rotulo="Passos da Maestro">
        <Contador valor={cfg.maestro_max_iterations} min={20} max={1000} passo={20} onMuda={(n) => salva({ maestro_max_iterations: n })} />
      </LinhaAjuste>
      <Modelos aberto={escolhe != null} desligar onFecha={() => setEscolhe(null)} onEscolhe={([e]) => {
        const k = escolhe!;
        setEscolhe(null);
        const v = e.nome ? { provider: e.provider ?? "local", model: e.model ?? e.nome } : { provider: "", model: "" };
        if (k === "maestro") salva({ maestro_model: v });
        else if (k === "visual") salva({ maestro_visual: v });
        else salva({ subagents: { ...cfg.subagents, [k]: v } });
      }} />
    </>
  );
}

function AbaFerramentas({ cfg, salva, onErro }: { cfg: Cfg; salva: (p: Partial<Cfg>) => void; onErro: (e: string) => void }) {
  const [tools, setTools] = useState<{ name: string; description: string; always_ask?: boolean; source?: string }[] | null>(null);
  useEffect(() => { api.get<typeof tools>("/tools").then(setTools).catch((e) => onErro(e.message)); }, []);
  if (!tools) return <ActivityIndicator color={c.muted} />;
  const grupos = new Map<string, typeof tools>();
  for (const t of tools) {
    const g = t.source?.startsWith("mcp:") ? `MCP · ${t.source.slice(4)}` : "NATIVAS";
    grupos.set(g, [...(grupos.get(g) ?? []), t]);
  }
  const off = new Set(cfg.disabled_tools);
  return (
    <>
      <Nota t="Ferramentas desligadas não são enviadas ao modelo nem podem ser chamadas." />
      {[...grupos].map(([g, lista]) => (
        <View key={g} style={{ gap: 8 }}>
          <Text style={s.secao2}>{g.toUpperCase()}</Text>
          {lista!.map((t) => (
            <View key={t.name} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: c.surface, borderRadius: 12, padding: 12 }}>
              <View style={{ paddingTop: 3 }}><Wrench size={14} color={c.faint} /></View>
              <View style={{ flex: 1 }}>
                <Opcao rotulo={t.name} valor={!off.has(t.name)} sub={t.always_ask ? "sempre pergunta" : undefined} dica={t.description}
                       onMuda={(v) => salva({ disabled_tools: v ? cfg.disabled_tools.filter((x) => x !== t.name) : [...cfg.disabled_tools, t.name] })} />
              </View>
            </View>
          ))}
        </View>
      ))}
    </>
  );
}

function AbaSkills({ onErro }: { onErro: (e: string) => void }) {
  const [lista, setLista] = useState<{ name: string; description: string; prompt?: string; origem: string; editavel: boolean }[] | null>(null);
  const [ed, setEd] = useState<{ name: string; description: string; prompt: string; antigo: string } | null>(null);
  const carrega = () => api.get<{ skills: NonNullable<typeof lista> }>("/skills").then((r) => setLista(r.skills)).catch((e) => onErro(e.message));
  useEffect(() => { carrega(); }, []);
  if (ed)
    return (
      <>
        <Campo rotulo="Nome" dica="Vira o comando: minúsculas, números e hífens.">
          <TextInput style={[s.input, { fontFamily: mono, fontSize: 14 }]} value={ed.name} autoCapitalize="none" placeholder="revisar-textos" placeholderTextColor={c.faint}
                     onChangeText={(x) => setEd({ ...ed, name: x.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
        </Campo>
        <Campo rotulo="Descrição" dica="Aparece no menu do / e diz ao agente quando usar.">
          <TextInput style={s.input} value={ed.description} onChangeText={(x) => setEd({ ...ed, description: x })}
                     placeholder="Revisa ortografia e clareza de um texto" placeholderTextColor={c.faint} />
        </Campo>
        <Campo rotulo="Instruções" dica="$ARGUMENTS vira o que vier depois do /nome.">
          <Area valor={ed.prompt} onMuda={(x) => setEd({ ...ed, prompt: x })} linhas={6} placeholder="Revise o texto de $ARGUMENTS: corrija ortografia e concordância, sem mudar o tom." />
        </Campo>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Botao flex primario altura={48} rotulo="Salvar skill" desabilitado={!ed.name.trim() || !ed.prompt.trim()}
                 onPress={() => api.put("/skills", ed).then(() => { setEd(null); carrega(); toast("Skill salva no PC."); }).catch((e) => onErro(e.message))} />
          <Botao altura={48} rotulo="Cancelar" onPress={() => setEd(null)} />
        </View>
      </>
    );
  return (
    <>
      <Botao primario altura={44} rotulo="Nova skill" onPress={() => setEd({ name: "", description: "", prompt: "", antigo: "" })} />
      {!lista ? <ActivityIndicator color={c.muted} /> : lista.map((k) => (
        <Pressable key={`${k.origem}${k.name}`} style={({ pressed }) => ({ backgroundColor: pressed ? c.raised : c.surface, borderRadius: 12, padding: 12, gap: 4 })}
                   onPress={() => (k.editavel ? setEd({ name: k.name, description: k.description, prompt: k.prompt ?? "", antigo: k.name })
                     : toast(`/${k.name} é ${ORIGEM[k.origem] ?? k.origem}: editar fica no desktop.`))}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: c.fg, fontFamily: mono, fontSize: 13.5, flex: 1 }} numberOfLines={1}>/{k.name}</Text>
            <Text style={{ color: c.faint, fontSize: 11, backgroundColor: c.raised, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" }}>
              {ORIGEM[k.origem] ?? k.origem}
            </Text>
          </View>
          {!!k.description && <Text style={{ color: c.muted, fontSize: 12.5, lineHeight: 18 }} numberOfLines={2}>{k.description}</Text>}
        </Pressable>
      ))}
    </>
  );
}

function ListaRegras({ titulo, dica, placeholder, valor, onMuda }: { titulo: string; dica: string; placeholder: string; valor: string[]; onMuda: (v: string[]) => void }) {
  const [novo, setNovo] = useState("");
  const add = () => { const v = novo.trim(); if (v && !valor.includes(v)) onMuda([...valor, v]); setNovo(""); };
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: c.fg, fontSize: 14.5 }}>{titulo}</Text>
      <Text style={[s.faint, { fontSize: 12.5, lineHeight: 18 }]}>{dica}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput style={[s.input, { flex: 1, fontFamily: mono, fontSize: 13 }]} value={novo} onChangeText={setNovo} onSubmitEditing={add}
                   autoCapitalize="none" placeholder={placeholder} placeholderTextColor={c.faint} />
        <Botao rotulo="Adicionar" altura={44} onPress={add} desabilitado={!novo.trim()} />
      </View>
      {valor.map((v) => (
        <View key={v} style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }}>
          <Text style={{ color: c.fg, fontFamily: mono, fontSize: 13, flex: 1 }}>{v}</Text>
          <Pressable hitSlop={10} onPress={() => onMuda(valor.filter((x) => x !== v))}><Trash size={15} color={c.faint} /></Pressable>
        </View>
      ))}
      {!valor.length && <Text style={[s.faint, { fontSize: 12.5 }]}>Nenhuma regra: tudo pede aprovação.</Text>}
    </View>
  );
}

function AbaPermissoes({ cfg, salva }: { cfg: Cfg; salva: (p: Partial<Cfg>) => void }) {
  return (
    <>
      <Nota ambar icone={<Shield size={15} color="#fde68a" />}
            t="Regras dispensam o card de aprovação. Aceita * como curinga, e a regra que liberou fica registrada no bloco da ferramenta. Cuidado com regras largas como * ou git *." />
      <Opcao rotulo="Revisor automático no modo Automático" valor={cfg.auto_review} onMuda={(v) => salva({ auto_review: v })}
             dica="Antes do card de aprovação, o próprio modelo avalia o risco da ação. Risco baixo roda sem perguntar; o resto continua pedindo, com o motivo no card. Comando destrutivo sempre pergunta." />
      <ListaRegras titulo="Comandos liberados" dica="Compara o comando inteiro. Ex.: pytest*, git status, ls *, npm run build" placeholder="pytest*"
                   valor={cfg.auto_approve_commands} onMuda={(v) => salva({ auto_approve_commands: v })} />
      <ListaRegras titulo="Ferramentas liberadas" dica="Compara o nome da ferramenta. Ex.: write_file, mcp__memoria__*" placeholder="mcp__memoria__*"
                   valor={cfg.auto_approve_tools} onMuda={(v) => salva({ auto_approve_tools: v })} />
      <ListaRegras titulo="Pastas confiáveis" dica="Onde .forja/hooks.json pode rodar. Só a pasta liberada aqui executa os comandos dele, subpastas incluídas."
                   placeholder="C:/Projetos/meu-app" valor={cfg.trusted_hooks} onMuda={(v) => salva({ trusted_hooks: v })} />
    </>
  );
}

function AbaMemoria({ cfg, salva, onErro }: { cfg: Cfg; salva: (p: Partial<Cfg>) => void; onErro: (e: string) => void }) {
  type Mem = { available: boolean; reason?: string; can_delete?: boolean; entities: { name: string; entityType?: string; observations?: string[] }[] };
  const [m, setM] = useState<Mem | null>(null);
  const [q, setQ] = useState("");
  const [proj, setProj] = useState<string | null>(null);
  useEffect(() => {
    api.get<Mem>("/memory").then(setM).catch(() => setM({ available: false, entities: [] }));
    api.get<{ content: string }>("/memory/project").then((r) => setProj(r.content ?? "")).catch(() => setProj(""));
  }, []);
  const lista = (m?.entities ?? []).filter((e) => JSON.stringify(e).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <View style={{ gap: 10 }}>
        <Text style={s.secao2}>MEMÓRIA PESSOAL</Text>
        <Opcao rotulo="Memória pessoal" valor={cfg.personal_memory} onMuda={(v) => salva({ personal_memory: v })}
               dica="O agente lembra de você entre conversas (preferências, projetos, pessoas)." />
        {m && !m.available ? <Nota t={m.reason ?? "Sem servidor de memória ligado."} /> : (
          <>
            <TextInput style={s.input} value={q} onChangeText={setQ} placeholder="Buscar na memória" placeholderTextColor={c.faint} />
            {!m ? <ActivityIndicator color={c.muted} /> : lista.map((e) => (
              <View key={e.name} style={{ backgroundColor: c.surface, borderRadius: 12, padding: 12, gap: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ color: c.fg, fontSize: 14, fontWeight: "600", flexShrink: 1 }}>{e.name}</Text>
                  {!!e.entityType && <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11 }}>{e.entityType}</Text>}
                  <View style={{ flex: 1 }} />
                  {m.can_delete && (
                    <Pressable hitSlop={10} onPress={() => api.post<Mem>("/memory/delete", { names: [e.name] }).then(setM).catch((er) => onErro(er.message))}>
                      <Trash size={15} color={c.faint} />
                    </Pressable>
                  )}
                </View>
                {(e.observations ?? []).map((o, i) => <Text key={i} style={{ color: c.muted, fontSize: 12.5, lineHeight: 18 }}>· {o}</Text>)}
              </View>
            ))}
          </>
        )}
      </View>
      <View style={{ gap: 10 }}>
        <Text style={s.secao2}>MEMÓRIA DO PROJETO</Text>
        <Opcao rotulo="Memória do projeto" valor={cfg.project_memory} onMuda={(v) => salva({ project_memory: v })}
               dica={`O ${cfg.project_memory_file || "FORJA.md"} da pasta vai no prompt de toda conversa ali.`} />
        {proj == null ? <ActivityIndicator color={c.muted} /> : (
          <>
            <Area valor={proj} onMuda={setProj} linhas={7} emMono placeholder={cfg.project_memory_file || "FORJA.md"} />
            <Botao primario altura={44} rotulo="Salvar no projeto" onPress={() => api.put("/memory/project", { content: proj }).then(() => toast("Salvo no projeto.")).catch((e) => onErro(e.message))} />
          </>
        )}
      </View>
    </>
  );
}

function AbaRuntime({ onErro }: { onErro: (e: string) => void }) {
  const [st, setSt] = useState<any>(null);
  const recarrega = () => api.get<any>("/local").then(setSt).catch((e) => onErro(e.message));
  useEffect(() => { recarrega(); const t = setInterval(recarrega, 3000); return () => clearInterval(t); }, []); // enquanto baixa, a lista muda sozinha
  if (!st) return <ActivityIndicator color={c.muted} />;
  const acao = (p: Promise<unknown>) => p.then(recarrega).catch((e: any) => onErro(e.message));
  const MOTORES = [
    ["llama", "llama.cpp", "Motor de chat. CPU, Vulkan e CUDA convivem no disco: dá para trocar a qualquer momento, sem baixar de novo."],
    ["sd", "stable-diffusion.cpp", "Gera imagem e vídeo (e o ESRGAN da ampliação)."],
    ["ffmpeg", "ffmpeg", "Separa os quadros, junta de volta com o áudio e interpola o movimento. Só existe o build de CPU."],
    ["comfy", "ComfyUI", "SeedVR2, DAT/HAT/SwinIR e o Redesenhar. Roda só enquanto amplia e libera a VRAM no fim."],
  ] as const;
  return (
    <>
      {MOTORES.map(([kind, titulo, dica]) => {
        const r = st.runtimes?.[kind];
        if (!r) return null;
        const job = (st.jobs ?? []).find((j: any) => j.kind === "runtime" && j.status === "running" && String(j.name ?? "").toLowerCase().includes(kind === "llama" ? "llama" : kind));
        const usado = r.chosen || r.backend;
        return (
          <View key={kind} style={{ backgroundColor: c.surface, borderRadius: 12, padding: 12, gap: 10 }}>
            <Text style={{ color: c.fg, fontSize: 15, fontWeight: "600" }}>{titulo}</Text>
            <Text style={{ color: c.muted, fontSize: 12.5, lineHeight: 18 }}>{dica}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Text style={[s.faint, { fontSize: 12.5 }]}>Em uso</Text>
              {!r.available.length && <Text style={{ color: c.faint, fontSize: 12.5 }}>nenhum instalado</Text>}
              {r.available.map((a: any) => (
                <Pressable key={a.backend} onPress={() => acao(api.put("/local/runtime", { kind, backend: a.backend }))}
                           style={{ height: 28, borderRadius: 999, paddingHorizontal: 10, justifyContent: "center", backgroundColor: usado === a.backend ? c.accent : c.raised }}>
                  <Text style={{ color: usado === a.backend ? c.accentFg : c.muted, fontFamily: mono, fontSize: 12 }}>{a.backend}{a.version ? ` · ${a.version}` : ""}</Text>
                </Pressable>
              ))}
            </View>
            {job ? (
              <View style={{ gap: 4 }}>
                <View style={{ height: 4, borderRadius: 2, backgroundColor: c.line, overflow: "hidden" }}>
                  <View style={{ height: 4, width: `${job.total ? (job.done / job.total) * 100 : 0}%`, backgroundColor: c.accent }} />
                </View>
                <Text style={{ color: c.faint, fontFamily: mono, fontSize: 11.5 }}>baixando · {job.total ? Math.round((job.done / job.total) * 100) : 0}%</Text>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {r.backends.map((b: string) => {
                  const tem = r.available.some((a: any) => a.backend === b);
                  if (kind === "comfy" && tem) return null; // versão fixa: não há o que atualizar
                  return <Botao key={b} altura={34} icone={<Download size={13} color={c.fg} />} onPress={() => acao(api.post("/local/runtime", { kind, backend: b }))}
                                rotulo={kind === "ffmpeg" || kind === "comfy" ? (tem ? "Atualizar" : "Baixar") : tem ? `Atualizar ${b}` : `Baixar ${b}`} />;
                })}
              </View>
            )}
          </View>
        );
      })}
      <Nota t="O motor em uso vale para o próximo carregamento. Trocar de Vulkan para CUDA (ou para CPU) não mexe nos modelos baixados." />
    </>
  );
}
