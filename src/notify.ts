// Notifiche di sistema per i nuovi messaggi.

import { isPermissionGranted, onAction, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { inTauri } from "./api";
import { plural } from "./format";
import type { Message } from "./types";

/** Oltre questa soglia arriva una sola notifica riepilogativa. */
const MAX_SINGLE = 3;

/** Cosa aprire al clic: un messaggio per id, oppure tutta la posta in arrivo. */
export type NotificationTarget = { messageId: string } | { inbox: true };

// Il plugin rende cliccabile una notifica solo se chi ascolta i clic c'è già al momento dell'invio.
let clicksReady: Promise<unknown> = Promise.resolve();

/** Ascolta i clic sulle notifiche; senza destinazione (notifica di prova) `target` è null. */
export function listenNotificationClicks(open: (target: NotificationTarget | null) => void): () => void {
  if (!inTauri) return () => {};
  const listener = onAction((e) => {
    if (e.actionId !== "tap") return;
    const extra = e.notification?.extra ?? {};
    if (typeof extra.messageId === "string") open({ messageId: extra.messageId });
    else open(extra.inbox === true ? { inbox: true } : null);
  });
  clicksReady = listener.catch(() => {});
  return () => {
    listener.then((l) => l.unregister()).catch(() => {});
  };
}

export async function notificationsAllowed(ask: boolean): Promise<boolean> {
  if (!inTauri) return false;
  if (await isPermissionGranted()) return true;
  return ask && (await requestPermission()) === "granted";
}

export async function notifyNewMail(messages: Message[], preview: boolean) {
  if (messages.length === 0 || !(await notificationsAllowed(true))) return;
  await clicksReady;
  if (!preview || messages.length > MAX_SINGLE) {
    const extra: NotificationTarget = messages.length === 1 ? { messageId: messages[0].id } : { inbox: true };
    sendNotification({ title: "Missiva", body: `${plural(messages.length, "nuovo messaggio", "nuovi messaggi")}`, extra });
    return;
  }
  for (const m of messages) sendNotification({ title: m.fromName, body: m.subject, extra: { messageId: m.id } });
}

export async function notifyTest(preview: boolean) {
  if (!(await notificationsAllowed(true))) return false;
  await clicksReady;
  sendNotification(preview ? { title: "Giulia Ferri", body: "Architettura del nuovo gateway — note per giovedì" } : { title: "Missiva", body: "1 nuovo messaggio" });
  return true;
}
