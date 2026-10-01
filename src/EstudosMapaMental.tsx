import * as Clipboard from "expo-clipboard";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import Svg, { Circle, G, Path, Rect, TSpan, Text as SvgText } from "react-native-svg";
import { Text } from "./Texto";
import { type NoMapa, arvore, comFilhos, corDo, desenhar, fonteDe, paraMermaid } from "./estudosMapa";
import { Copy, Minus, Plus } from "./icones";
import { c, mono } from "./tema";
import { BotaoIcone, Chip, toast } from "./ui";

/** O resumo como mapa mental (o mesmo do PC: estudosMapa.ts). No celular começa só com os tópicos — a bolinha
 *  abre o ramo, tocar no nome abre a seção no resumo. Rola nos dois sentidos; − e + mudam o tamanho. */
export default function EstudosMapaMental({ md, tema, onAbrir }: { md: string; tema: string; onAbrir: (ancora: number) => void }) {
  const raiz = useMemo(() => arvore(md, tema), [md, tema]);
  const todos = useMemo(() => comFilhos(raiz), [raiz]);
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set());
  const mapa = useMemo(() => desenhar(raiz, abertos), [raiz, abertos]);
  const [k, setK] = useState(1);
  const janela = useWindowDimensions();
  const h = useRef<ScrollView>(null), v = useRef<ScrollView>(null);
  const centro = mapa.nos.find((n) => n.nivel === 0)!;

  // o tema no meio da tela ao abrir, ao mudar o tamanho e ao abrir/fechar ramo (o desenho se recompõe)
  useEffect(() => {
    const t = setTimeout(() => {
      h.current?.scrollTo({ x: Math.max(0, (centro.x + centro.w / 2) * k - janela.width / 2), animated: false });
      v.current?.scrollTo({ y: Math.max(0, (centro.y + centro.h / 2) * k - janela.height * 0.3), animated: false });
    }, 30);
    return () => clearTimeout(t);
  }, [centro.x, centro.y, k, janela.width, janela.height]);   // eslint-disable-line react-hooks/exhaustive-deps

  const alternar = (id: string) => setAbertos((a) => {
    const n = new Set(a);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const tudoAberto = todos.every((id) => abertos.has(id));

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6 }}>
        <Chip rotulo={tudoAberto ? "Só os tópicos" : "Abrir tudo"} onPress={() => setAbertos(tudoAberto ? new Set() : new Set(todos))} />
        <Chip rotulo="Mermaid" icone={<Copy size={14} color={c.muted} />}
              onPress={() => Clipboard.setStringAsync(paraMermaid(raiz)).then(() => toast("Mapa copiado como Mermaid."))} />
        <View style={{ flex: 1 }} />
        <BotaoIcone lado={34} onPress={() => setK((x) => Math.max(0.5, Math.round((x - 0.15) * 100) / 100))}><Minus size={15} color={c.fg} /></BotaoIcone>
        <Text style={{ color: c.muted, fontFamily: mono, fontSize: 12, minWidth: 40, textAlign: "center" }}>{Math.round(k * 100)}%</Text>
        <BotaoIcone lado={34} onPress={() => setK((x) => Math.min(2, Math.round((x + 0.15) * 100) / 100))}><Plus size={15} color={c.fg} /></BotaoIcone>
      </View>
      <ScrollView ref={v} style={{ flex: 1 }} contentContainerStyle={{ minHeight: "100%", justifyContent: "center" }}>
        <ScrollView ref={h} horizontal contentContainerStyle={{ minWidth: "100%", justifyContent: "center" }} showsHorizontalScrollIndicator={false}>
          <Svg width={mapa.largura * k} height={mapa.altura * k} viewBox={`0 0 ${mapa.largura} ${mapa.altura}`}>
            {mapa.ligacoes.map((l) => (
              <Path key={l.id} d={l.d} fill="none" stroke={corDo(l.ramo)} strokeOpacity={0.55} strokeWidth={l.id.startsWith("raiz-") ? 2.4 : 1.6} />
            ))}
            {mapa.nos.map((n) => <No key={n.id} n={n} onAbrir={onAbrir} onAlternar={alternar} />)}
          </Svg>
        </ScrollView>
      </ScrollView>
      <Text style={{ color: c.faint, fontSize: 11.5, textAlign: "center", paddingVertical: 6 }}>
        toque no nome para ler a seção · a bolinha abre e fecha o ramo
      </Text>
    </View>
  );
}

function No({ n, onAbrir, onAlternar }: { n: NoMapa; onAbrir: (ancora: number) => void; onAlternar: (id: string) => void }) {
  const cor = corDo(n.ramo);
  const raiz = n.nivel === 0, topico = n.nivel === 1;
  const fonte = fonteDe(n.nivel);
  const bx = n.lado === -1 ? n.x - 9 : n.x + n.w + 9, by = n.y + n.h / 2;
  return (
    <G>
      <G onPress={raiz ? undefined : () => onAbrir(n.ancora)}>
        <Rect x={n.x} y={n.y} width={n.w} height={n.h} rx={raiz ? n.h / 2 : topico ? 10 : 7}
              fill={raiz ? c.accent : topico ? cor : c.raised} fillOpacity={raiz ? 1 : topico ? 0.16 : 1}
              stroke={raiz ? "none" : cor} strokeOpacity={topico ? 1 : 0.45} strokeWidth={topico ? 1.5 : 1} />
        <SvgText x={n.x + n.w / 2} y={n.y + n.h / 2 - ((n.linhas.length - 1) * fonte * 1.3) / 2 + fonte * 0.35} textAnchor="middle"
                 fontSize={fonte} fontWeight={raiz ? "700" : topico ? "600" : "400"} fill={raiz ? c.accentFg : c.fg}>
          {n.linhas.map((l, i) => <TSpan key={i} x={n.x + n.w / 2} dy={i === 0 ? 0 : fonte * 1.3}>{l}</TSpan>)}
        </SvgText>
      </G>
      {!raiz && n.filhos > 0 && (
        <G onPress={() => onAlternar(n.id)}>
          {/* alvo de toque maior que a bolinha desenhada */}
          <Circle cx={bx} cy={by} r={16} fill="transparent" />
          <Circle cx={bx} cy={by} r={9} fill={c.surface} stroke={cor} strokeWidth={1.5} />
          <SvgText x={bx} y={by + (n.aberto ? 4 : 3.5)} textAnchor="middle" fontSize={n.aberto ? 13 : 10} fontWeight="700" fill={cor}>
            {n.aberto ? "−" : String(n.filhos)}
          </SvgText>
        </G>
      )}
    </G>
  );
}
