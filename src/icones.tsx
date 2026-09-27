import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";
import { c } from "./tema";

type P = { size?: number; color?: string };

// Traço no estilo dos ícones do desktop (frontend/src/components/icons.tsx): 24x24, stroke 1.8, pontas redondas.
function Icone({ size = 20, color = c.fg, children }: P & { children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8}
         strokeLinecap="round" strokeLinejoin="round">
      {children}
    </Svg>
  );
}

export const Voltar = (p: P) => <Icone {...p}><Path d="M15 18l-6-6 6-6" /></Icone>;
export const Seta = (p: P) => <Icone {...p}><Path d="M9 18l6-6-6-6" /></Icone>;
export const Abaixo = (p: P) => <Icone {...p}><Path d="M6 9l6 6 6-6" /></Icone>;
export const Parar = ({ size = 20, color = c.fg }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24"><Rect x={6} y={6} width={12} height={12} rx={2} fill={color} /></Svg>
);
export const Sair = (p: P) => <Icone {...p}><Path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" /></Icone>;
export const Menu = (p: P) => <Icone {...p}><Path d="M4 8h16M4 16h10" /></Icone>;
export const Novo = (p: P) => <Icone {...p}><Path d="M12 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-6M18.4 2.6a2 2 0 013 3L12 15l-4 1 1-4 9.4-9.4z" /></Icone>;
export const Info = (p: P) => <Icone {...p}><Circle cx={12} cy={12} r={9} /><Path d="M12 11v5M12 8h.01" /></Icone>;
export const Chip = (p: P) => <Icone {...p}><Rect x={6} y={6} width={12} height={12} rx={2} /><Path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></Icone>;
export const Acima = (p: P) => <Icone {...p}><Path d="M6 15l6-6 6 6" /></Icone>;
export const Lapis = (p: P) => <Icone {...p}><Path d="M17 3a2.8 2.8 0 014 4L7.5 20.5 2 22l1.5-5.5z" /></Icone>;

// Os mesmos nomes do desktop (icons.tsx), gerados dos paths dele.
export const Copy = (p: P) => <Icone {...p}><Rect x={9} y={9} width={12} height={12} rx={2} /><Path d="M5 15V5a2 2 0 0 1 2-2h10" /></Icone>;
export const Check = (p: P) => <Icone {...p}><Path d="m5 12 5 5 9-10" /></Icone>;
export const CheckSquare = (p: P) => <Icone {...p}><Rect x={3.5} y={3.5} width={17} height={17} rx={3} /><Path d="m8 12 3 3 5-6" /></Icone>;
export const Brain = (p: P) => <Icone {...p}><Path d="M9 4a3 3 0 0 0-3 3v.5A3 3 0 0 0 4 10.5a3 3 0 0 0 1 2.2A3 3 0 0 0 6 18a3 3 0 0 0 3 2 3 3 0 0 0 3-3V7a3 3 0 0 0-3-3z" /><Path d="M15 4a3 3 0 0 1 3 3v.5a3 3 0 0 1 2 3 3 3 0 0 1-1 2.2 3 3 0 0 1-1 5.3 3 3 0 0 1-3 2 3 3 0 0 1-3-3" /></Icone>;
export const Chevron = (p: P) => <Icone {...p}><Path d="m8 10 4-4 4 4M8 14l4 4 4-4" /></Icone>;
export const ChevronDown = (p: P) => <Icone {...p}><Path d="m6 9 6 6 6-6" /></Icone>;
export const Cube = (p: P) => <Icone {...p}><Path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><Path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></Icone>;
export const Tokens = (p: P) => <Icone {...p}><Ellipse cx={12} cy={6} rx={7} ry={3} /><Path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></Icone>;
export const Clock = (p: P) => <Icone {...p}><Circle cx={12} cy={12} r={9} /><Path d="M12 7v5l3 2" /></Icone>;
export const Balanca = (p: P) => <Icone {...p}><Path d="M12 4v16M8 20h8M4 8h16" /><Path d="m4 8-2.5 5a3 3 0 0 0 5 0z" /><Path d="m20 8-2.5 5a3 3 0 0 0 5 0z" /></Icone>;
export const Gauge = (p: P) => <Icone {...p}><Path d="M4 16a8 8 0 1 1 16 0" /><Path d="m12 16 4-5" /></Icone>;
export const ArrowUp = (p: P) => <Icone {...p}><Path d="M12 19V5m-6 6 6-6 6 6" /></Icone>;
export const Eye = (p: P) => <Icone {...p}><Path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" /><Circle cx={12} cy={12} r={2.8} /></Icone>;
export const EyeOff = (p: P) => <Icone {...p}><Path d="M3 3l18 18" /><Path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.3 3.8" /><Path d="M6.3 8.2A17 17 0 0 0 2 12s3.6 6 10 6a9.8 9.8 0 0 0 3.5-.6" /></Icone>;
export const Edit = (p: P) => <Icone {...p}><Path d="M12 20h9" /><Path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></Icone>;
export const Search = (p: P) => <Icone {...p}><Circle cx={11} cy={11} r={7} /><Path d="m20 20-3.5-3.5" /></Icone>;
export const Trash = (p: P) => <Icone {...p}><Path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></Icone>;
export const Gear = (p: P) => <Icone {...p}><Circle cx={12} cy={12} r={3} /><Path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l1.7-1.3-2-3.4-2 .8a7.7 7.7 0 0 0-2.6-1.5L14.2 3H9.8l-.3 2.1a7.7 7.7 0 0 0-2.6 1.5l-2-.8-2 3.4 1.7 1.3a7.7 7.7 0 0 0 0 3L2.9 15l2 3.4 2-.8a7.7 7.7 0 0 0 2.6 1.5l.3 2.1h4.4l.3-2.1a7.7 7.7 0 0 0 2.6-1.5l2 .8 2-3.4z" /></Icone>;
export const Paperclip = (p: P) => <Icone {...p}><Path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7.5-7.5" /></Icone>;
export const Refresh = (p: P) => <Icone {...p}><Path d="M21 12a9 9 0 1 1-2.6-6.4" /><Path d="M21 4v5h-5" /></Icone>;
export const Shield = (p: P) => <Icone {...p}><Path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" /><Path d="m9 12 2 2 4-4" /></Icone>;
export const X = (p: P) => <Icone {...p}><Path d="M6 6l12 12M18 6L6 18" /></Icone>;
export const Plus = (p: P) => <Icone {...p}><Path d="M12 5v14M5 12h14" /></Icone>;
export const GitBranch = (p: P) => <Icone {...p}><Circle cx={6} cy={5} r={2.5} /><Circle cx={6} cy={19} r={2.5} /><Circle cx={18} cy={8} r={2.5} /><Path d="M6 7.5v9M18 10.5c0 3-3 4-6 4s-6 1-6 3" /></Icone>;
export const Terminal = (p: P) => <Icone {...p}><Path d="m5 7 5 5-5 5" /><Path d="M12 17h7" /></Icone>;
export const Pin = (p: P) => <Icone {...p}><Path d="M9 4h6l-1 6 3 3v1H7v-1l3-3z" /><Path d="M12 14v6" /></Icone>;
export const Archive = (p: P) => <Icone {...p}><Rect x={3} y={4} width={18} height={4} rx={1} /><Path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></Icone>;
export const More = (p: P) => <Icone {...p}><Circle cx={5} cy={12} r={1.2} fill={p.color ?? c.fg} /><Circle cx={12} cy={12} r={1.2} fill={p.color ?? c.fg} /><Circle cx={19} cy={12} r={1.2} fill={p.color ?? c.fg} /></Icone>;
export const ExternalLink = (p: P) => <Icone {...p}><Path d="M14 4h6v6" /><Path d="M20 4 10 14" /><Path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></Icone>;
export const FolderOpen = (p: P) => <Icone {...p}><Path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H6.5a2 2 0 0 0-1.9 1.4L3 17z M3 17l1.6-5.6A2 2 0 0 1 6.5 10H21l-2 7a2 2 0 0 1-1.9 1.4H5a2 2 0 0 1-2-1.4z" /></Icone>;
export const Download = (p: P) => <Icone {...p}><Path d="M12 4v11m-5-5 5 5 5-5" /><Path d="M4 19h16" /></Icone>;
export const Activity = (p: P) => <Icone {...p}><Path d="M3 12h4l3-8 4 16 3-8h4" /></Icone>;
export const Globe = (p: P) => <Icone {...p}><Circle cx={12} cy={12} r={9} /><Path d="M3 12h18M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18" /></Icone>;
export const PanelRight = (p: P) => <Icone {...p}><Rect x={3} y={4} width={18} height={16} rx={2} /><Path d="M15 4v16" /></Icone>;
export const ArrowLeft = (p: P) => <Icone {...p}><Path d="M19 12H5m6-6-6 6 6 6" /></Icone>;
export const ArrowRight = (p: P) => <Icone {...p}><Path d="M5 12h14m-6-6 6 6-6 6" /></Icone>;
export const Folder = (p: P) => <Icone {...p}><Path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Icone>;
export const Laptop = (p: P) => <Icone {...p}><Rect x={4} y={5} width={16} height={11} rx={1.5} /><Path d="M2 19h20" /></Icone>;
export const Undo = (p: P) => <Icone {...p}><Path d="M9 14 4 9l5-5" /><Path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Icone>;
export const Split = (p: P) => <Icone {...p}><Circle cx={6} cy={6} r={2} /><Circle cx={18} cy={6} r={2} /><Circle cx={12} cy={19} r={2} /><Path d="M6 8v2a4 4 0 0 0 4 4h0a2 2 0 0 1 2 2v1M18 8v2a4 4 0 0 1-4 4" /></Icone>;
export const Bubble = (p: P) => <Icone {...p}><Rect x={3} y={4} width={18} height={13} rx={3.5} /><Path d="M8.5 17v3.5L13 17" /></Icone>;
export const Code = (p: P) => <Icone {...p}><Path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 5l-4 14" /></Icone>;
export const PanelLeft = (p: P) => <Icone {...p}><Rect x={3} y={4} width={18} height={16} rx={2} /><Path d="M9 4v16" /></Icone>;
export const Sliders = (p: P) => <Icone {...p}><Path d="M4 8h10M18 8h2M4 16h4M12 16h8" /><Circle cx={16} cy={8} r={2} /><Circle cx={10} cy={16} r={2} /></Icone>;
export const Quadro = (p: P) => <Icone {...p}><Rect x={3} y={4} width={18} height={16} rx={2} /><Path d="M9 4v16M15 4v16" /><Path d="M5.5 8h1.5M11 8h2M11 11h2M17 8h1.5" /></Icone>;
export const Clipboard = (p: P) => <Icone {...p}><Rect x={6} y={4} width={12} height={16} rx={2} /><Path d="M9 4h6v3H9z" /><Path d="M9 11h6M9 15h4" /></Icone>;
export const Wrench = (p: P) => <Icone {...p}><Path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" /></Icone>;
export const Cpu = (p: P) => <Icone {...p}><Rect x={7} y={7} width={10} height={10} rx={1.5} /><Rect x={4} y={4} width={16} height={16} rx={2.5} /><Path d="M9 1.5v2.5M15 1.5v2.5M9 20v2.5M15 20v2.5M1.5 9H4M1.5 15H4M20 9h2.5M20 15h2.5" /></Icone>;
export const Robo = (p: P) => <Icone {...p}><Rect x={5} y={8} width={14} height={11} rx={2.5} /><Path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5M3 13v2M21 13v2" /><Circle cx={12} cy={3.5} r={1} /></Icone>;
export const Image = (p: P) => <Icone {...p}><Rect x={3} y={5} width={18} height={14} rx={2} /><Circle cx={8.5} cy={10} r={1.5} /><Path d="m4 17 5-5 4 4 3-3 4 4" /></Icone>;
export const Recolher = (p: P) => <Icone {...p}><Path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></Icone>;
export const Expandir = (p: P) => <Icone {...p}><Path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></Icone>;
export const Film = (p: P) => <Icone {...p}><Rect x={3} y={4} width={18} height={16} rx={2} /><Path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></Icone>;
export const QuadroAntes = (p: P) => <Icone {...p}><Path d="M6 5v14" /><Path d="m18 6-8 6 8 6z" /></Icone>;
export const QuadroDepois = (p: P) => <Icone {...p}><Path d="M18 5v14" /><Path d="m6 6 8 6-8 6z" /></Icone>;
export const Repetir = (p: P) => <Icone {...p}><Path d="m17 2 3 3-3 3" /><Path d="M4 11V9a4 4 0 0 1 4-4h12" /><Path d="m7 22-3-3 3-3" /><Path d="M20 13v2a4 4 0 0 1-4 4H4" /></Icone>;
export const TelaCheia = (p: P) => <Icone {...p}><Path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" /></Icone>;
export const Pip = (p: P) => <Icone {...p}><Rect x={2.5} y={4.5} width={19} height={15} rx={2} /><Rect x={12} y={11.5} width={7} height={5} rx={1} /></Icone>;
export const Trocar = (p: P) => <Icone {...p}><Path d="M7 7h11l-3-3M17 17H6l3 3" /></Icone>;
export const Teclado = (p: P) => <Icone {...p}><Rect x={2.5} y={6} width={19} height={12} rx={2} /><Path d="M6.5 10h1M10.5 10h1M14.5 10h1M6.5 14h11" /></Icone>;
export const Raio = (p: P) => <Icone {...p}><Path d="M13 2 4 14h7l-1 8 9-12h-7z" /></Icone>;
export const Camera = (p: P) => <Icone {...p}><Path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><Circle cx={12} cy={13} r={3.5} /></Icone>;
export const Square = ({ size = 14, color = c.fg }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24"><Rect x={5} y={5} width={14} height={14} rx={2.5} fill={color} /></Svg>
);
export const Play = ({ size = 16, color = c.fg }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24"><Path d="M8 5.1v13.8a1 1 0 0 0 1.5.9l10.6-6.9a1 1 0 0 0 0-1.7L9.5 4.2A1 1 0 0 0 8 5.1Z" fill={color} /></Svg>
);
export const Pause = ({ size = 16, color = c.fg }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24"><Rect x={6} y={4.5} width={4} height={15} rx={1.2} fill={color} /><Rect x={14} y={4.5} width={4} height={15} rx={1.2} fill={color} /></Svg>
);
export const Star = ({ size = 16, color = c.fg, cheia }: P & { cheia?: boolean }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={cheia ? color : "none"} stroke={color} strokeWidth={1.8} strokeLinejoin="round">
    <Path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
  </Svg>
);

// Nomes antigos do app, agora com o desenho do desktop.
export const Cubo = Cube;
export const Relogio = Clock;
export const Escudo = Shield;
export const Cerebro = Brain;
export const Busca = Search;
export const Globo = Globe;
export const Balao = Bubble;
export const Codigo = Code;
export const Divide = Split;
export const Pasta = Folder;
export const Filme = Film;
export const Imagem = Image;
export const Term = Terminal;
export const Ramo = GitBranch;
export const Pulso = Activity;
export const Prancheta = Clipboard;
export const PainelDir = PanelRight;
export const Fechar = X;
export const Externo = ExternalLink;
export const Enviar = ArrowUp;
