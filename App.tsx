import { CameraView, useCameraPermissions } from "expo-camera";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, AppState, BackHandler, Linking, Platform, Pressable, RefreshControl, ScrollView, SectionList, Text, TextInput,
         useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { api, base, carregaPar, escolheBase, salvaPar, viaLan } from "./src/api";
import Chat, { type Conv } from "./src/Chat";
import CarregandoModelo from "./src/Carregando";
import Comparar from "./src/Comparar";
import Video from "./src/Video";
import { Abaixo, Balanca, Balao, Busca, Chip, Codigo, Divide, Globo, Filme, Imagem, Info, Menu, Novo, PainelDir, Pasta as IconePasta, Prancheta,
         Pulso, Ramo, Sair, Seta, Term, Voltar } from "./src/icones";
import Imagens from "./src/Imagens";
import Maestro from "./src/Maestro";
import { Painel, PAINEIS, type PainelId } from "./src/Painel";
import Pesquisa from "./src/Pesquisa";
import { LogoMarca, LogoTexto } from "./src/Logo";
import EscolhePasta, { nomePasta } from "./src/Pasta";
import Site, { type Servidor } from "./src/Site";
import { Dialogos, pergunta } from "./src/Dialogo";
import { c, mono, s } from "./src/tema";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

/** Permissão + token da Expo, registrado no backend para ele mandar o push. */
async function registraPush() {
  if (!Device.isDevice) return;
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("default", { name: "Forja", importance: Notifications.AndroidImportance.MAX });
  const { granted } = await Notifications.requestPermissionsAsync();
  if (!granted) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api.post("/mobile/register", { expo_token: data });
}

/** Erro de renderização vira tela com o motivo e um "voltar", em vez de fechar o app. */
class Protecao extends Component<{ children: ReactNode; onVoltar: () => void }, { erro: Error | null }> {
  state = { erro: null as Error | null };
  static getDerivedStateFromError(erro: Error) { return { erro }; }
  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <View style={{ padding: 20, gap: 12 }}>
        <Text style={[s.txt, { fontWeight: "600" }]}>Algo quebrou nesta tela</Text>
        <Text style={[s.muted, { fontFamily: mono }]} selectable>{String(this.state.erro.message)}</Text>
        <Pressable style={[s.btnSec, { alignSelf: "flex-start" }]}
                   onPress={() => { this.setState({ erro: null }); this.props.onVoltar(); }}>
          <Text style={s.btnSecTxt}>Voltar</Text>
        </Pressable>
      </View>
    );
  }
}

type Pagina = "chat" | "agent" | "maestro" | "imagem" | "video" | "comparar" | "pesquisa" | "sites";
// As seções do Forja Desktop (Controls.tsx, SectionTabs), na mesma ordem, + os sites que o agente subiu.
const PAGINAS: { id: Pagina; rotulo: string; Icone: typeof Balao }[] = [
  { id: "chat", rotulo: "Chat", Icone: Balao },
  { id: "agent", rotulo: "Agente", Icone: Codigo },
  { id: "maestro", rotulo: "Maestro", Icone: Divide },
  { id: "imagem", rotulo: "Imagens", Icone: Imagem },
  { id: "video", rotulo: "Vídeo", Icone: Filme },
  { id: "comparar", rotulo: "Comparar", Icone: Balanca },
  { id: "pesquisa", rotulo: "Pesquisa", Icone: Busca },
  { id: "sites", rotulo: "Sites", Icone: Globo },
];
const ICONE_PAINEL: Record<PainelId, typeof Balao> = {
  info: Info, navegador: Globo, terminal: Term, alteracoes: Ramo, instancias: Pulso, local: Chip, planos: Prancheta,
};
const kindDe = (k?: string): Pagina => (PAGINAS.some((p) => p.id === k) && k !== "sites" ? (k as Pagina) : "agent");
const pasta = (label?: string) => label?.split(/[\\/]/).filter(Boolean).pop() || "Forja (padrão)";

export default function App() {
  return (
    <SafeAreaProvider>
      <Raiz />
      <CarregandoModelo />
      <Dialogos />
    </SafeAreaProvider>
  );
}

function Raiz() {
  const [pareado, setPareado] = useState<boolean | null>(null);
  const [pagina, setPagina] = useState<Pagina>("agent");
  const [conv, setConv] = useState<Conv | null>(null); // null = conversa nova ("Como posso ajudar?")
  const [sessao, setSessao] = useState(0); // troca de conversa remonta o Chat
  const [site, setSite] = useState<string | null>(null);
  const [gaveta, setGaveta] = useState(false);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [erro, setErro] = useState("");
  const [telaCheia, setTelaCheia] = useState(false);
  const [pastaNova, setPastaNova] = useState<string | null>(null); // escolhida no seletor para a conversa nova
  const [seletor, setSeletor] = useState(false);
  const [direita, setDireita] = useState(false);
  const toque = Notifications.useLastNotificationResponse();
  const inset = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const carregaConvs = () =>
    api.get<Conv[]>("/conversations").then((l) => { setConvs(l); setErro(""); return l; })
      .catch((e) => { setErro(e.message); return [] as Conv[]; });

  useEffect(() => {
    carregaPar().then((p) => { setPareado(!!p); if (p) carregaConvs(); });
    // Voltou para o app (talvez saiu ou chegou em casa): rede local se responder, senão a tailnet.
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") escolheBase(); });
    return () => sub.remove();
  }, []);

  // Link de pareamento (forja://parear?c=<JSON do QR>), para parear sem câmera: a aba Celular copia o link.
  // Confirma antes: um link qualquer não troca o PC pareado sem você ver para onde vai.
  useEffect(() => {
    const trata = (url: string | null) => {
      const m = url?.match(/^forja:\/\/parear\?c=(.+)$/);
      let p: any = null;
      try { p = m && JSON.parse(decodeURIComponent(m[1])); } catch { return; }
      if (!p?.token || !(p.url || p.lan)) return;
      pergunta("Parear com este PC?", [p.lan, p.url].filter(Boolean).join("\n"), [
        { texto: "Cancelar", estilo: "cancelar" },
        { texto: "Parear", acao: async () => {
          await salvaPar({ url: p.url ?? null, lan: p.lan ?? null, token: p.token });
          await escolheBase();
          await registraPush().catch(() => {});
          setPareado(true);
          carregaConvs();
        } },
      ]);
    };
    Linking.getInitialURL().then(trata);
    const sub = Linking.addEventListener("url", (e) => trata(e.url));
    return () => sub.remove();
  }, []);

  const abre = (c: Conv | null, p: Pagina = pagina, fecha = true) => {
    setPagina(p);
    setConv(c);
    setSite(null);
    setSessao((n) => n + 1);
    if (fecha) setGaveta(false);
  };

  // Tocar na notificação abre direto a conversa que está esperando (depois do pareamento carregar).
  useEffect(() => {
    const d = toque?.notification.request.content.data as { conv_id?: number } | undefined;
    if (!pareado || !d?.conv_id || !base()) return;
    carregaConvs().then((l) => {
      const c = l.find((x) => x.id === d.conv_id) ?? { id: d.conv_id!, title: "Conversa" };
      abre(c, kindDe(c.kind));
    });
  }, [toque, pareado]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (gaveta) return setGaveta(false), true;
      if (direita) return setDireita(false), true;
      if (site) return setSite(null), true;
      if (conv || pagina === "sites") return setGaveta(true), true; // como no ChatGPT: voltar mostra as conversas
      return false;
    });
    return () => sub.remove();
  }, [gaveta, direita, site, conv, pagina]);

  if (pareado === null) return <View style={s.tela} />;
  if (!pareado)
    return (
      <View style={[s.tela, { paddingTop: inset.top, paddingBottom: inset.bottom }]}>
        <StatusBar style="light" />
        <Parear onPronto={() => { setPareado(true); carregaConvs(); }} />
      </View>
    );

  const criada = (cv: Conv) => { setConv(cv); carregaConvs(); };
  const turno = () => carregaConvs().then((l) => setConv((cv) => (cv && l.find((x) => x.id === cv.id)) || cv)); // título pode ter mudado
  // Conversa nova: a pasta escolhida no seletor; sem escolha, a da conversa mais recente da página.
  const workspace = pastaNova ?? convs.find((x) => (x.kind ?? "agent") === pagina)?.workspace ?? null;
  const comPasta = pagina === "agent" || pagina === "maestro";
  const pastaAtual = conv ? nomePasta(conv.workspace_label || conv.workspace) : nomePasta(workspace);
  const titulo = pagina === "sites" ? (site ?? "Sites") : conv?.title ?? PAGINAS.find((p) => p.id === pagina)!.rotulo;
  const cheia = telaCheia && width > height;

  return (
    <View style={[s.tela, { paddingTop: cheia ? 0 : inset.top }]}>
      <StatusBar style="light" hidden={cheia} />
      {!cheia && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, height: 60 }}>
          <Pressable onPress={() => { setGaveta(true); carregaConvs(); }} hitSlop={6} style={redondo}>
            <Menu size={22} />
          </Pressable>
          <Pressable style={{ flex: 1 }} disabled={!comPasta || !!conv} onPress={() => setSeletor(true)}>
            <Text style={[s.txt, { fontWeight: "600", fontSize: 16 }]} numberOfLines={1}>{titulo}</Text>
            {comPasta && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <IconePasta size={12} color={c.faint} />
                <Text style={[s.faint, { fontSize: 12.5 }]} numberOfLines={1}>{pastaAtual || "Forja (padrão)"}</Text>
                {!conv && <Abaixo size={12} color={c.faint} />}
              </View>
            )}
          </Pressable>
          {pagina !== "sites" ? (
            <Pressable onPress={() => abre(null)} hitSlop={6} style={redondo}><Novo size={20} /></Pressable>
          ) : site ? (
            <Pressable onPress={() => setSite(null)} hitSlop={6} style={redondo}><Voltar size={20} /></Pressable>
          ) : null}
          <Pressable onPress={() => setDireita(true)} hitSlop={6} style={redondo}><PainelDir size={20} /></Pressable>
        </View>
      )}
      <View style={{ flex: 1, paddingBottom: pagina === "sites" && !cheia ? inset.bottom : 0 }}>
        <Protecao onVoltar={() => abre(null)}>
          {pagina === "sites" ? (
            site ? <Site nome={site} /> : <Servidores abre={setSite} />
          ) : pagina === "imagem" ? (
            <Imagens key={sessao} conv={conv} onCriada={criada} onTurno={turno} onAbreChat={(c, k) => abre(c, k as Pagina)} />
          ) : pagina === "video" ? (
            <Video key={sessao} conv={conv} onCriada={criada} onTurno={turno} />
          ) : pagina === "comparar" ? (
            <Comparar key={sessao} conv={conv} onCriada={criada} onTurno={turno} />
          ) : pagina === "pesquisa" ? (
            <Pesquisa key={sessao} conv={conv} onCriada={criada} onTurno={turno}
                      onAbre={(id) => carregaConvs().then((l) => abre(l.find((x) => x.id === id) ?? { id, title: "Discussão" }, "chat"))} />
          ) : pagina === "maestro" ? (
            <Maestro key={sessao} conv={conv} workspace={workspace} onTelaCheia={setTelaCheia} pasta={pastaAtual || "Forja (padrão)"}
                     onPasta={() => setSeletor(true)} onCriada={criada} onTurno={turno} />
          ) : (
            <Chat key={sessao} conv={conv} kind={pagina} workspace={workspace} onTelaCheia={setTelaCheia}
                  pasta={comPasta ? pastaAtual || "Forja (padrão)" : undefined} onPasta={() => setSeletor(true)}
                  onCriada={criada} onTurno={turno} onAbreImagens={(c) => { carregaConvs(); abre(c, "imagem"); }} />
          )}
        </Protecao>
      </View>
      <GavetaDireita aberta={direita} fecha={() => setDireita(false)} conv={conv?.id ?? null}
                     onAbreConv={(id) => { setDireita(false); carregaConvs().then((l) => { const cv = l.find((x) => x.id === id); if (cv) abre(cv, kindDe(cv.kind)); }); }} />
      <EscolhePasta aberta={seletor} atual={workspace} onFecha={() => setSeletor(false)}
                    onEscolhe={(p) => { setPastaNova(p); setSeletor(false); }} />
      <Gaveta aberta={gaveta} fecha={() => setGaveta(false)} pagina={pagina} convs={convs} atual={conv?.id} erro={erro}
              // Trocar de página só troca a lista: a gaveta fica aberta para escolher a conversa (Sites não tem conversa).
              onPagina={(p) => (p === "sites" ? (setPagina("sites"), setSite(null), setGaveta(false)) : abre(null, p, false))}
              onConv={(c) => abre(c)} onNova={() => abre(null)}
              onDesparear={() => salvaPar(null).then(() => { setGaveta(false); setPareado(false); })} />
    </View>
  );
}

const redondo = { width: 44, height: 44, borderRadius: 22, borderColor: c.line, borderWidth: 1, backgroundColor: c.surface,
                  alignItems: "center", justifyContent: "center" } as const;

/** Gaveta do ChatGPT: busca + nova conversa, as páginas do Forja no topo e as conversas da página embaixo. */
function Gaveta({ aberta, fecha, pagina, convs, atual, erro, onPagina, onConv, onNova, onDesparear }: {
  aberta: boolean; fecha: () => void; pagina: Pagina; convs: Conv[]; atual?: number; erro: string;
  onPagina: (p: Pagina) => void; onConv: (c: Conv) => void; onNova: () => void; onDesparear: () => void;
}) {
  const inset = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const largura = Math.min(width * 0.82, 360);
  const x = useRef(new Animated.Value(-largura)).current;
  const [busca, setBusca] = useState("");
  // Sempre montada: animação nativa iniciada antes do mount não pegava e a gaveta ficava fora da tela.
  useEffect(() => {
    Animated.timing(x, { toValue: aberta ? 0 : -largura, duration: 200, useNativeDriver: true }).start();
  }, [aberta]);

  const q = busca.trim().toLowerCase();
  const kindPag = pagina === "sites" ? "agent" : pagina;
  const secoes = useMemo(() => {
    const mapa = new Map<string, Conv[]>();
    for (const cv of convs) {
      if ((cv.kind ?? "agent") !== kindPag || (q && !cv.title.toLowerCase().includes(q))) continue;
      const k = kindPag === "agent" || kindPag === "maestro" ? pasta(cv.workspace_label) : "Recentes";
      mapa.set(k, [...(mapa.get(k) ?? []), cv]);
    }
    return [...mapa].map(([title, data]) => ({ title, data }));
  }, [convs, kindPag, q]);
  const host = base().replace(/^https?:\/\//, "").split(":")[0];
  const pc = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host : host.split(".")[0]; // IP da rede local inteiro; na tailnet, o nome da máquina
  const desparear = () =>
    pergunta("Desparear", `Este celular perde o acesso a ${pc || "este PC"} até ler o QR de novo.`,
      [{ texto: "Cancelar", estilo: "cancelar" }, { texto: "Desparear", estilo: "perigo", acao: onDesparear }]);

  return (
    <View pointerEvents={aberta ? "auto" : "none"} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000",
                              opacity: x.interpolate({ inputRange: [-largura, 0], outputRange: [0, 0.55] }) }}>
        <Pressable style={{ flex: 1 }} onPress={fecha} />
      </Animated.View>
      <Animated.View style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: largura, backgroundColor: c.side,
                              paddingTop: inset.top + 8, paddingBottom: inset.bottom, transform: [{ translateX: x }] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, marginBottom: 10 }}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.surface, borderRadius: 999,
                         paddingHorizontal: 14, borderColor: c.line, borderWidth: 1 }}>
            <Busca size={17} color={c.faint} />
            <TextInput style={{ flex: 1, color: c.fg, fontSize: 15, paddingVertical: 10 }} value={busca} onChangeText={setBusca}
                       placeholder="Buscar" placeholderTextColor={c.faint} />
          </View>
          <Pressable onPress={onNova} hitSlop={8}><Novo size={22} /></Pressable>
        </View>
        {PAGINAS.map(({ id, rotulo, Icone }) => (
          <Pressable key={id} onPress={() => onPagina(id)}
                     style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, marginHorizontal: 8,
                       paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12,
                       backgroundColor: pagina === id ? c.raised : pressed ? c.surface : "transparent" })}>
            <Icone size={21} color={pagina === id ? c.fg : c.muted} />
            <Text style={{ color: c.fg, fontSize: 16, fontWeight: pagina === id ? "600" : "400" }}>{rotulo}</Text>
          </Pressable>
        ))}
        <View style={{ height: 1, backgroundColor: c.line, marginHorizontal: 20, marginVertical: 10 }} />
        <SectionList
          sections={secoes}
          keyExtractor={(cv) => String(cv.id)}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 12 }}
          ListHeaderComponent={erro ? <Text style={[s.muted, { color: c.red, padding: 12 }]}>{erro}</Text> : null}
          ListEmptyComponent={!erro ? <Text style={[s.faint, { padding: 12 }]}>{q ? "Nada encontrado." : "Nenhuma conversa ainda."}</Text> : null}
          renderSectionHeader={({ section }) =>
            kindPag === "agent" || kindPag === "maestro" ? (
              <Text style={[s.secao, { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 4 }]}>
                {section.title} <Text style={{ color: c.faint }}>{section.data.length}</Text>
              </Text>
            ) : null}
          renderItem={({ item }) => (
            <Pressable onPress={() => onConv(item)}
                       style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 11, borderRadius: 10,
                         backgroundColor: item.id === atual ? c.raised : pressed ? c.surface : "transparent" })}>
              <Text style={{ color: c.fg, fontSize: 15.5 }} numberOfLines={1}>{item.title}</Text>
            </Pressable>
          )}
        />
        <Pressable onPress={desparear}
                   style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12,
                            borderTopColor: c.line, borderTopWidth: 1 }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.raised, alignItems: "center", justifyContent: "center" }}>
            <LogoMarca size={20} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.fg, fontSize: 15, fontWeight: "600" }} numberOfLines={1}>{pc || "Forja"}</Text>
            <Text style={[s.faint, !!erro && { color: c.red }]}>{erro ? "Sem conexão com o PC" : viaLan() ? "Conectado pela rede local" : "Conectado pela tailnet"}</Text>
          </View>
          <Sair size={17} color={c.faint} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** A barra de ícones do canto superior direito do desktop, como gaveta da direita: lista → painel. */
function GavetaDireita({ aberta, fecha, conv, onAbreConv }: { aberta: boolean; fecha: () => void; conv: number | null; onAbreConv: (id: number) => void }) {
  const inset = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [painel, setPainel] = useState<PainelId | null>(null);
  const largura = painel ? width : Math.min(width * 0.82, 360); // o painel aberto usa a tela toda
  const x = useRef(new Animated.Value(width)).current;
  useEffect(() => {
    Animated.timing(x, { toValue: aberta ? 0 : width, duration: 200, useNativeDriver: true }).start();
    if (!aberta) setPainel(null);
  }, [aberta]);
  const atual = PAINEIS.find((p) => p.id === painel);
  return (
    <View pointerEvents={aberta ? "auto" : "none"} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Animated.View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000",
                              opacity: x.interpolate({ inputRange: [0, width], outputRange: [0.55, 0] }) }}>
        <Pressable style={{ flex: 1 }} onPress={fecha} />
      </Animated.View>
      <Animated.View style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: largura, backgroundColor: c.side,
                              paddingTop: inset.top + 8, paddingBottom: inset.bottom, transform: [{ translateX: x }] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingBottom: 10 }}>
          <Pressable hitSlop={10} onPress={() => (painel ? setPainel(null) : fecha())}><Voltar size={20} /></Pressable>
          <Text style={{ color: c.fg, fontSize: 16, fontWeight: "600", flex: 1 }}>{atual?.rotulo ?? "Painéis"}</Text>
        </View>
        {painel ? (
          <View style={{ flex: 1 }}><Painel id={painel} conv={conv} onAbreConv={onAbreConv} /></View>
        ) : (
          PAINEIS.map(({ id, rotulo, dica }) => {
            const Icone = ICONE_PAINEL[id];
            return (
              <Pressable key={id} onPress={() => setPainel(id)}
                         style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, marginHorizontal: 8, paddingHorizontal: 12,
                           paddingVertical: 12, borderRadius: 12, backgroundColor: pressed ? c.surface : "transparent" })}>
                <Icone size={21} color={c.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.fg, fontSize: 16 }}>{rotulo}</Text>
                  <Text style={s.faint} numberOfLines={1}>{dica}</Text>
                </View>
                <Seta size={16} color={c.faint} />
              </Pressable>
            );
          })
        )}
      </Animated.View>
    </View>
  );
}

function Parear({ onPronto }: { onPronto: () => void }) {
  const [perm, pede] = useCameraPermissions();
  const [erro, setErro] = useState("");
  const [lendo, setLendo] = useState(false);
  if (!perm?.granted)
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 18 }}>
        <View style={{ alignItems: "center", gap: 14, marginBottom: 12 }}>
          <LogoMarca size={72} />
          <LogoTexto height={20} />
        </View>
        <Text style={[s.txt, { textAlign: "center" }]}>Pareie com o Forja Desktop</Text>
        <Text style={[s.muted, { textAlign: "center", lineHeight: 20 }]}>
          No PC, abra Configurações → Celular e leia o QR. Em casa basta a mesma rede Wi‑Fi (com a rede local ligada no PC); fora de casa, o Tailscale.
        </Text>
        <Pressable style={s.btn} onPress={pede}><Text style={s.btnTxt}>Ler QR</Text></Pressable>
      </View>
    );
  return (
    <View style={{ flex: 1 }}>
      <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={lendo ? undefined : async ({ data }) => {
          setLendo(true);
          try {
            const p = JSON.parse(data);
            if (!(p.url || p.lan) || !p.token) throw new Error("Esse QR não é do Forja");
            await salvaPar({ url: p.url ?? null, lan: p.lan ?? null, token: p.token });
            await escolheBase();
            await api.get("/mobile"); // confere endereço + token antes de seguir
            await registraPush().catch((e) => setErro(`Sem notificações: ${e.message}`));
            onPronto();
          } catch (e: any) {
            await salvaPar(null);
            setErro(e.message);
            setLendo(false);
          }
        }} />
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: "#000b" }}>
        <Text style={[s.muted, { textAlign: "center" }, !!erro && { color: c.red }]}>
          {erro || (lendo ? "Conectando ao PC…" : "Aponte para o QR da aba Celular")}
        </Text>
      </View>
    </View>
  );
}

/** Sites que o agente subiu (serve_start). Tocar publica a porta na tailnet e abre dentro do app. */
function Servidores({ abre }: { abre: (nome: string) => void }) {
  const [lista, setLista] = useState<Servidor[] | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const carrega = () => {
    setCarregando(true);
    api.get<{ servers: Servidor[] }>("/servers").then((r) => { setLista(r.servers.filter((x) => x.alive && x.url)); setErro(""); })
      .catch((e) => setErro(e.message)).finally(() => setCarregando(false));
  };
  useEffect(carrega, []);
  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}
                refreshControl={<RefreshControl refreshing={carregando} onRefresh={carrega} tintColor={c.muted} colors={[c.fg]} progressBackgroundColor={c.raised} />}>
      <Text style={[s.secao, { paddingHorizontal: 4, paddingTop: 6 }]}>Sites em execução</Text>
      {!!erro && <Text style={[s.muted, { color: c.red }]}>{erro}</Text>}
      {lista?.length === 0 && (
        <Text style={[s.muted, { padding: 4, lineHeight: 20 }]}>Nenhum site rodando. Quando a IA subir um servidor, ele aparece aqui.</Text>
      )}
      {lista?.map((item) => (
        <Pressable key={item.name} onPress={() => abre(item.name)}
                   style={({ pressed }) => ({ backgroundColor: pressed ? c.raised : c.surface, borderColor: c.line, borderWidth: 1,
                                              borderRadius: 16, padding: 14, gap: 6 })}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.green }} />
            <Text style={[s.txt, { fontWeight: "600", flex: 1 }]} numberOfLines={1}>{item.name}</Text>
            <Seta size={16} color={c.faint} />
          </View>
          <Text style={[s.muted, { fontFamily: mono }]} numberOfLines={1}>{item.url}</Text>
          {!!item.command && <Text style={[s.faint, { fontFamily: mono, fontSize: 12 }]} numberOfLines={1}>$ {item.command}</Text>}
        </Pressable>
      ))}
    </ScrollView>
  );
}
