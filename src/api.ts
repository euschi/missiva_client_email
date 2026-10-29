// Ponte verso i comandi Tauri. Fuori da Tauri (vite nel browser) usa i dati demo del design.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { demo } from "./demo";
import type { Account, AccountPatch, Folder, Guess, Message, Outgoing, Provider, Server, SyncReport } from "./types";

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

  removeAccount: (id: string): Promise<void> => (inTauri ? invoke("remove_account", { id }) : demo.removeAccount(id)),

  cachedMessages: (folder: Folder): Promise<Message[]> => (inTauri ? invoke("cached_messages", { folder }) : demo.messages(folder)),

  syncFolder: (folder: Folder): Promise<SyncReport> => (inTauri ? invoke("sync_folder", { folder }) : demo.sync(folder)),

  setFlags: (m: Message, flags: { seen?: boolean; flagged?: boolean }): Promise<void> =>
    inTauri ? invoke("set_flags", { target: ref(m), seen: flags.seen ?? null, flagged: flags.flagged ?? null }) : demo.setFlags(m, flags),

  moveMessage: (m: Message, to: Folder): Promise<void> => (inTauri ? invoke("move_message", { target: ref(m), to }) : demo.move(m, to)),

  sendMessage: (outgoing: Outgoing): Promise<void> => (inTauri ? invoke("send_message", { outgoing }) : demo.send(outgoing)),

  openAttachment: (m: Message, index: number): Promise<string> =>
    inTauri ? invoke("open_attachment", { target: ref(m), index }) : Promise.resolve(m.attachments[index]?.name ?? ""),

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
