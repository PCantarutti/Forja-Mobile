/** Velocidade do sd-cli como o desktop mostra (ImagensView `velocidade`): "3,2 s/passo" quando lento, "2,5 passos/s"
 *  quando rápido. `unidade`: "passo" na geração, "quadro" na ampliação de vídeo. */
export function velocidade(sPorUnidade: number, unidade = "passo"): string {
  return sPorUnidade >= 1
    ? `${sPorUnidade.toFixed(1).replace(".", ",")} s/${unidade}`
    : `${(1 / sPorUnidade).toFixed(1).replace(".", ",")} ${unidade}s/s`;
}

/** Tempo restante em minutos e segundos: "~45 s", "~2 min 15 s", "~1 h 3 min". */
export function restante(segundos: number): string {
  const s = Math.max(1, Math.round(segundos));
  if (s < 60) return `~${s} s`;
  if (s < 3600) return `~${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
  return `~${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}
