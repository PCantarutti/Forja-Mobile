import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";

// Notificações do Forja chegam como push só de dados e quem as desenha é esta tarefa, com o call_id do pedido
// como identificador. Com título, o Firebase desenhava sozinho com o app em segundo plano e perdia o `data`, e
// não havia como tirar a notificação quando o pedido fosse decidido no desktop. Agora:
//   {forja: "mostra", titulo, texto, conv_id, run_id, call_id} → mostra a notificação
//   {forja: "revoga", call_ids}                                → tira as desses pedidos
// Roda com o app aberto, em segundo plano ou fechado (o Android acorda o JS só para isto). Definida no escopo do
// módulo e importada primeiro em index.ts, como a doc do expo-notifications pede.
const TAREFA = "forja-notificacoes";

/** O payload chega em formatos diferentes conforme o estado do app (data solto, dataString, body em JSON). */
function doForja(x: any): any {
  if (!x) return null;
  if (typeof x === "string") { try { return doForja(JSON.parse(x)); } catch { return null; } }
  if (typeof x !== "object") return null;
  if (typeof x.forja === "string") return x;
  for (const v of Object.values(x)) { const r = doForja(v); if (r) return r; }
  return null;
}

const idDe = (d: { call_id?: string | null; run_id?: string }) => d.call_id || `fim-${d.run_id ?? ""}`;

async function mostra(d: any) {
  // O canal nasce no pareamento; recriar é inofensivo e cobre o app aberto pela 1ª vez já em segundo plano.
  await Notifications.setNotificationChannelAsync("default", { name: "Forja", importance: Notifications.AndroidImportance.MAX });
  await Notifications.scheduleNotificationAsync({
    identifier: idDe(d),
    content: { title: d.titulo, body: d.texto, sound: "default", priority: Notifications.AndroidNotificationPriority.MAX,
               data: { conv_id: d.conv_id, run_id: d.run_id, call_id: d.call_id } },
    trigger: { channelId: "default" },
  });
}

export async function revoga(ids: string[]) {
  await Promise.all(ids.map((id) => Notifications.dismissNotificationAsync(id).catch(() => {})));
}

/** Reserva, se o push de revogação não chegou (Doze): ao abrir a conversa, some o que ela não espera mais. */
export async function limpaConversa(convId: number, pendentes: string[]) {
  const abertas = await Notifications.getPresentedNotificationsAsync();
  await Promise.all(abertas.filter((n) => {
    const d = n.request.content.data as any;
    return d?.conv_id === convId && d?.call_id && !pendentes.includes(String(d.call_id));
  }).map((n) => Notifications.dismissNotificationAsync(n.request.identifier)));
}

TaskManager.defineTask<Notifications.NotificationTaskPayload>(TAREFA, async ({ data }) => {
  if (!data || "actionIdentifier" in data) return;
  const d = doForja(data);
  if (d?.forja === "mostra") await mostra(d).catch(() => {});
  else if (d?.forja === "revoga" && Array.isArray(d.call_ids)) await revoga(d.call_ids);
});
Notifications.registerTaskAsync(TAREFA).catch(() => {});
