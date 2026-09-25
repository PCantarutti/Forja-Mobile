import { createContext, useContext } from "react";
import { Image, Pressable, Text, View } from "react-native";
import Svg, { Path, Rect, Text as SvgText } from "react-native-svg";
import { base, comToken } from "./api";
import { c } from "./tema";

export type Anexo = { path: string; name: string; size: number; mime: string; kind: string; local?: string };

/** Conversa das mensagens na tela: o /api/files resolve o caminho do anexo dentro da pasta dela. */
export const ConvDoAnexo = createContext<number | null>(null);

// Cores tradicionais de cada programa (as que o Explorer mostra): PDF vermelho, Word azul, Excel verde...
const TIPOS: { casa: RegExp; rotulo: string; marca: string; cor: string }[] = [
  { casa: /\.pdf$|pdf/, rotulo: "PDF", marca: "PDF", cor: "#e5252a" },
  { casa: /\.(docx?|odt|rtf)$|word|opendocument\.text/, rotulo: "Documento", marca: "W", cor: "#2b579a" },
  { casa: /\.(xlsx?|ods|csv)$|sheet|excel|csv/, rotulo: "Planilha", marca: "X", cor: "#217346" },
  { casa: /\.(pptx?|odp)$|presentation|powerpoint/, rotulo: "Apresentação", marca: "P", cor: "#d24726" },
  { casa: /\.(zip|rar|7z|tar|gz)$|zip|compress/, rotulo: "Compactado", marca: "ZIP", cor: "#b58900" },
  { casa: /\.(mp3|wav|ogg|m4a|flac)$|^audio\//, rotulo: "Áudio", marca: "♪", cor: "#8e44ad" },
  { casa: /\.(mp4|mov|mkv|webm|avi)$|^video\//, rotulo: "Vídeo", marca: "▶", cor: "#c0392b" },
  { casa: /\.(py|js|ts|tsx|jsx|java|c|cpp|cs|go|rs|rb|php|html|css|json|sh|sql|ya?ml)$/, rotulo: "Código", marca: "</>", cor: "#6e40c9" },
  { casa: /\.(txt|md|log)$|^text\//, rotulo: "Texto", marca: "TXT", cor: "#6b7280" },
];

const tipoDe = (a: { name: string; mime?: string }) => {
  const alvo = `${a.name.toLowerCase()} ${a.mime ?? ""}`;
  return TIPOS.find((t) => t.casa.test(alvo)) ?? { rotulo: "Arquivo", marca: (a.name.split(".").pop() ?? "").slice(0, 4).toUpperCase() || "?", cor: "#525252" };
};
export const ehImagem = (a: { name: string; mime?: string; kind?: string }) =>
  a.kind === "image" || /^image\//.test(a.mime ?? "") || /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(a.name);

const tamanho = (n: number) => (!n ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Folha de documento com a dobra no canto e a faixa colorida do programa (o "PDF vermelho" tradicional). */
export function IconeDoc({ nome, mime, tam = 40 }: { nome: string; mime?: string; tam?: number }) {
  const t = tipoDe({ name: nome, mime });
  return (
    <Svg width={tam * 0.8} height={tam} viewBox="0 0 32 40">
      <Path d="M3 1h18l8 8v28a2 2 0 01-2 2H3a2 2 0 01-2-2V3a2 2 0 012-2z" fill="#f4f4f5" />
      <Path d="M21 1v6a2 2 0 002 2h6" fill="#d4d4d8" />
      <Rect x={1} y={22} width={28} height={12} rx={2} fill={t.cor} />
      <SvgText x={15} y={31} fontSize={t.marca.length > 2 ? 7.5 : 9} fontWeight="700" fill="#fff" textAnchor="middle">{t.marca}</SvgText>
    </Svg>
  );
}

/** Anexo com prévia: imagem em miniatura (a do celular antes de enviar, a do PC depois) ou o ícone do tipo. */
export function CartaoAnexo({ a, onRemover }: { a: Anexo; onRemover?: () => void }) {
  const conv = useContext(ConvDoAnexo);
  const t = tipoDe(a);
  const img = ehImagem(a);
  const fonte = a.local ?? (conv != null ? comToken(`${base()}/api/files?path=${encodeURIComponent(a.path)}&conv=${conv}`) : null);
  return (
    <Pressable onPress={onRemover} disabled={!onRemover}
               style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.raised, borderColor: c.line, borderWidth: 1,
                        borderRadius: 12, padding: 6, paddingRight: onRemover ? 8 : 12, maxWidth: 240 }}>
      {img && fonte ? (
        <Image source={{ uri: fonte }} style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: c.surface }} resizeMode="cover" />
      ) : (
        <View style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}><IconeDoc nome={a.name} mime={a.mime} /></View>
      )}
      <View style={{ flexShrink: 1 }}>
        <Text style={{ color: c.fg, fontSize: 13 }} numberOfLines={1}>{a.name}</Text>
        <Text style={{ color: c.faint, fontSize: 11.5 }} numberOfLines={1}>{[img ? "Imagem" : t.rotulo, tamanho(a.size)].filter(Boolean).join(" · ")}</Text>
      </View>
      {!!onRemover && <Text style={{ color: c.faint, fontSize: 13 }}>✕</Text>}
    </Pressable>
  );
}
