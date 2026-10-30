// Ponte verso i comandi Tauri. Fuori da Tauri (vite nel browser) usa i dati demo del design.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { demo } from "./demo";
import type { Account, AccountPatch, Folder, Guess, HtmlView, Mailbox, Message, Outgoing, Provider, Scheduled, Server, SyncReport } from "./types";

export const inTauri = isTauri();

type MessageRef = Pick<Message, "accountId" | "folder" | "mailbox" | "uid">;
const ref = (m: Message): MessageRef => ({ accountId: m.accountId, folder: m.folder, mailbox: m.mailbox, uid: m.uid });

export const api = {
  listAccounts: (): Promise<Account[]> => (inTauri ? invoke("list_accounts") : demo.listAccounts()),

  autoconfig: (email: string): Promise<Guess> => (inTauri ? invoke("autoconfig", { email }) : demo.autoconfig(email)),

  addImapAccount: (input: { email: string; password: string; imap: Server; smtp: Server; syncDays: number }): Promise<Account> =>
    inTauri ? invoke("add_imap_account", { input }) : demo.addImapAccount(input),

  addOauthAccount: (provider: Provider, syncDays: number): Promise<Account> =>
    inTauri ? invoke("add_oauth_account", { provider, syncDays }) : demo.addOauthAccount(provider),

  updateAccount: (patch: AccountPatch): Promise<Account> => (inTauri ? invoke("update_account", { patch }) : demo.updateAccount(patch)),

  reorderAccounts: (ids: string[]): Promise<Account[]> => (inTauri ? invoke("reorder_accounts", { ids }) : demo.reorderAccounts(ids)),

  removeAccount: (id: string): Promise<void> => (inTauri ? invoke("remove_account", { id }) : demo.removeAccount(id)),

  cachedMessages: (folder: Folder): Promise<Message[]> => (inTauri ? invoke("cached_messages", { folder }) : demo.messages(folder)),

  /** Senza `account` sincronizza la cartella su tutti gli account. */
  syncFolder: (folder: Folder, account?: string): Promise<SyncReport> =>
    inTauri ? invoke("sync_folder", { folder, account: account ?? null }) : demo.sync(folder, account),

  /** Cartelle dell'utente: dalla cache, o dal server con `refresh`. */
  mailboxes: (account: string, refresh: boolean): Promise<Mailbox[]> =>
    inTauri ? invoke("mailboxes", { account, refresh }) : demo.mailboxes(account),

  cachedMailbox: (account: string, mailbox: string): Promise<Message[]> =>
    inTauri ? invoke("cached_mailbox", { account, mailbox }) : Promise.resolve([]),

  syncMailbox: (account: string, mailbox: string): Promise<SyncReport> =>
    inTauri ? invoke("sync_mailbox", { account, mailbox }) : demo.syncMailbox(account, mailbox),

  setFlags: (m: Message, flags: { seen?: boolean; flagged?: boolean }): Promise<void> =>
    inTauri ? invoke("set_flags", { target: ref(m), seen: flags.seen ?? null, flagged: flags.flagged ?? null }) : demo.setFlags(m, flags),

  setFlagsMany: (ms: Message[], flags: { seen?: boolean; flagged?: boolean }): Promise<void> =>
    inTauri
      ? invoke("set_flags_many", { targets: ms.map(ref), seen: flags.seen ?? null, flagged: flags.flagged ?? null })
      : Promise.all(ms.map((m) => demo.setFlags(m, flags))).then(() => {}),

  moveMessages: (ms: Message[], to: Folder): Promise<void> =>
    inTauri ? invoke("move_messages", { targets: ms.map(ref), to }) : Promise.all(ms.map((m) => demo.move(m, to))).then(() => {}),

  moveMessage: (m: Message, to: Folder): Promise<void> => (inTauri ? invoke("move_message", { target: ref(m), to }) : demo.move(m, to)),

  sendMessage: (outgoing: Outgoing): Promise<void> => (inTauri ? invoke("send_message", { outgoing }) : demo.send(outgoing)),

  scheduleMessage: (outgoing: Outgoing, at: number): Promise<Scheduled> =>
    inTauri ? invoke("schedule_message", { outgoing, at }) : demo.schedule(outgoing, at),

  listScheduled: (): Promise<Scheduled[]> => (inTauri ? invoke("list_scheduled") : demo.listScheduled()),

  cancelScheduled: (id: string): Promise<void> => (inTauri ? invoke("cancel_scheduled", { id }) : demo.cancelScheduled(id)),

  sendScheduledNow: (id: string): Promise<void> => (inTauri ? invoke("send_scheduled_now", { id }) : demo.cancelScheduled(id)),

  readStore: (name: string): Promise<unknown> => (inTauri ? invoke("read_store", { name }) : demo.readStore(name)),

  writeStore: (name: string, value: unknown): Promise<void> => (inTauri ? invoke("write_store", { name, value }) : demo.writeStore(name, value)),

  openAttachment: (m: Message, index: number): Promise<string> =>
    inTauri ? invoke("open_attachment", { target: ref(m), index }) : Promise.resolve(m.attachments[index]?.name ?? ""),

  messageHtml: (m: Message): Promise<HtmlView | null> => (inTauri ? invoke("message_html", { target: ref(m) }) : demo.messageHtml(m)),

  attachmentBytes: (m: Message, index: number): Promise<ArrayBuffer> =>
    inTauri ? invoke("attachment_bytes", { target: ref(m), index }) : demo.attachmentBytes(m, index),

  /** Link http(s) nel browser di sistema. */
  openLink: (url: string): Promise<void> => (inTauri ? openUrl(url) : (window.open(url, "_blank", "noopener"), Promise.resolve())),

  clearCache: (): Promise<void> => (inTauri ? invoke("clear_cache") : Promise.resolve()),

  trayAvailable: (): Promise<boolean> => (inTauri ? invoke("tray_available") : Promise.resolve(false)),

  setTrayUnread: (count: number): Promise<void> => (inTauri ? invoke("set_tray_unread", { count }) : Promise.resolve()),

  pickFiles: async (): Promise<string[]> => {
    if (!inTauri) return [];
    const picked = await open({ multiple: true, title: "Allega file" });
    if (!picked) return [];
    return Array.isArray(picked) ? picked : [picked];
  },
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Errore sconosciuto";
}
