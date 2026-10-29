// Notifiche di sistema per i nuovi messaggi.

import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { inTauri } from "./api";
import { plural } from "./format";
import type { Message } from "./types";

/** Oltre questa soglia arriva una sola notifica riepilogativa. */
const MAX_SINGLE = 3;

export async function notificationsAllowed(ask: boolean): Promise<boolean> {
  if (!inTauri) return false;
  if (await isPermissionGranted()) return true;
  return ask && (await requestPermission()) === "granted";
}

export async function notifyNewMail(messages: Message[], preview: boolean) {
  if (messages.length === 0 || !(await notificationsAllowed(true))) return;
  if (!preview || messages.length > MAX_SINGLE) {
    sendNotification({ title: "Missiva", body: `${plural(messages.length, "nuovo messaggio", "nuovi messaggi")}` });
    return;
  }
  for (const m of messages) sendNotification({ title: m.fromName, body: m.subject });
}

export async function notifyTest(preview: boolean) {
  if (!(await notificationsAllowed(true))) return false;
  sendNotification(preview ? { title: "Giulia Ferri", body: "Architettura del nuovo gateway — note per giovedì" } : { title: "Missiva", body: "1 nuovo messaggio" });
  return true;
}
