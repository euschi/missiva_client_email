// Ponte verso i comandi Tauri. Fuori da Tauri (vite nel browser) usa i dati demo del design.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { demo } from "./demo";
import type { Account, AccountPatch, AiAgent, McpResult, McpServer, McpTool, Browser, Folder, Invite, SearchQuery, Unsubscribe, Guess, HtmlView, InlineImageFile, Mailbox, Message, Outgoing, Provider, Scheduled, Server, SyncReport } from "./types";

export const inTauri = isTauri();

type MessageRef = Pick<Message, "accountId" | "folder" | "mailbox" | "uid">;
const ref = (m: Message): MessageRef => ({ accountId: m.accountId, folder: m.folder, mailbox: m.mailbox, uid: m.uid });

/** Anteprima: le immagini incollate restano in memoria finché la pagina è aperta. */
const demoImages = new Map<string, string>();

export const api = {
  listAccounts: (): Promise<Account[]> => (inTauri ? invoke("list_accounts") : demo.listAccounts()),

  autoconfig: (email: string): Promise<Guess> => (inTauri ? invoke("autoconfig", { email }) : demo.autoconfig(email)),

  addImapAccount: (input: { email: string; password: string; imap: Server; smtp: Server; syncDays: number }): Promise<Account> =>
    inTauri ? invoke("add_imap_account", { input }) : demo.addImapAccount(input),

  addOauthAccount: (provider: Provider, syncDays: number): Promise<Account> =>
    inTauri ? invoke("add_oauth_account", { provider, syncDays }) : demo.addOauthAccount(provider),

  reconnectAccount: (id: string): Promise<void> =>
    inTauri ? invoke("reconnect_account", { id }) : Promise.reject("Nell’anteprima del browser l’accesso OAuth non è disponibile."),

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

  /** Sposta messaggi di un solo account in una sua cartella. */
  moveToMailbox: (ms: Message[], mailbox: string): Promise<void> =>
    inTauri ? invoke("move_to_mailbox", { targets: ms.map(ref), mailbox }) : Promise.all(ms.map((m) => demo.move(m, "other"))).then(() => {}),

  /** Messaggi più vecchi di `m` nella sua casella. */
  loadOlder: (m: Message): Promise<Message[]> => (inTauri ? invoke("load_older", { target: ref(m) }) : Promise.resolve([])),

  /** Ricerca sul server in tutti gli account. */
  searchMail: (query: SearchQuery): Promise<SyncReport> => (inTauri ? invoke("search_mail", { query }) : demo.sync("archive")),

  /** Copia gli allegati su disco e ne restituisce i percorsi, per un nuovo messaggio. */
  prepareAttachments: (m: Message, indexes: number[]): Promise<string[]> =>
    inTauri ? invoke("prepare_attachments", { target: ref(m), indexes }) : Promise.resolve(indexes.map((i) => m.attachments.find((f) => f.index === i)?.name ?? "allegato")),

  markSpam: (ms: Message[]): Promise<void> => (inTauri ? invoke("mark_spam", { targets: ms.map(ref) }) : Promise.all(ms.map((m) => demo.move(m, "other"))).then(() => {})),

  createMailbox: (account: string, parent: string | null, name: string, delimiter: string): Promise<string> =>
    inTauri ? invoke("create_mailbox", { account, parent, name, delimiter }) : Promise.resolve(name),

  renameMailbox: (account: string, path: string, name: string, delimiter: string): Promise<void> =>
    inTauri ? invoke("rename_mailbox", { account, path, name, delimiter }) : Promise.resolve(),

  deleteMailbox: (account: string, path: string): Promise<void> => (inTauri ? invoke("delete_mailbox", { account, path }) : Promise.resolve()),

  saveAttachment: (m: Message, index: number, path: string): Promise<void> => (inTauri ? invoke("save_attachment", { target: ref(m), index, path }) : Promise.resolve()),

  saveAttachments: (m: Message, indexes: number[], dir: string): Promise<number> =>
    inTauri ? invoke("save_attachments", { target: ref(m), indexes, dir }) : Promise.resolve(indexes.length),

  exportEml: (m: Message, path: string): Promise<void> => (inTauri ? invoke("export_eml", { target: ref(m), path }) : Promise.resolve()),

  /** Percorso scelto dall'utente per salvare un file; `null` se annulla. */
  pickSavePath: async (name: string): Promise<string | null> => (inTauri ? save({ defaultPath: name }) : name),

  pickFolder: async (): Promise<string | null> => {
    if (!inTauri) return "Scaricati";
    const picked = await open({ directory: true, title: "Salva gli allegati in" });
    return Array.isArray(picked) ? (picked[0] ?? null) : picked;
  },

  unsubscribeInfo: (m: Message): Promise<Unsubscribe | null> => (inTauri ? invoke("unsubscribe_info", { target: ref(m) }) : Promise.resolve(null)),

  unsubscribePost: (url: string): Promise<void> => (inTauri ? invoke("unsubscribe_post", { url }) : Promise.resolve()),

  calendarInvite: (m: Message): Promise<Invite | null> => (inTauri ? invoke("calendar_invite", { target: ref(m) }) : Promise.resolve(null)),

  respondInvite: (m: Message, status: "accepted" | "tentative" | "declined"): Promise<void> =>
    inTauri ? invoke("respond_invite", { target: ref(m), status }) : Promise.resolve(),

  /** Il server di invio risponde? Falso se siamo offline. */
  serverReachable: (account: string): Promise<boolean> => (inTauri ? invoke("server_reachable", { account }) : Promise.resolve(true)),

  gmailSetLabel: (ms: Message[], label: string, on: boolean): Promise<void> =>
    inTauri ? invoke("gmail_set_label", { targets: ms.map(ref), messageIds: ms.map((m) => m.messageId ?? ""), label, on }) : Promise.resolve(),

  gmailLabelMembers: (account: string, label: string): Promise<{ ids: string[]; complete: boolean } | null> =>
    inTauri ? invoke("gmail_label_members", { account, label }) : Promise.resolve(null),

  /** Link mailto: con cui è stata avviata l'app. */
  initialMailto: (): Promise<string | null> => (inTauri ? invoke("initial_mailto") : Promise.resolve(null)),

  isDefaultMailClient: (): Promise<boolean> => (inTauri ? invoke("is_default_mail_client") : Promise.resolve(false)),

  setDefaultMailClient: (): Promise<void> => (inTauri ? invoke("set_default_mail_client") : Promise.resolve()),

  saveDraft: (outgoing: Outgoing): Promise<void> => (inTauri ? invoke("save_draft", { outgoing }) : demo.saveDraft(outgoing)),

  deleteDraft: (account: string, messageId: string): Promise<void> => (inTauri ? invoke("delete_draft", { account, messageId }) : demo.deleteDraft(account, messageId)),

  deleteForever: (ms: Message[]): Promise<void> => (inTauri ? invoke("delete_forever", { targets: ms.map(ref) }) : Promise.resolve()),

  /** Svuota il Cestino di un account, o di tutti. */
  emptyTrash: (account: string | null): Promise<void> => (inTauri ? invoke("empty_trash", { account }) : Promise.resolve()),

  /** Segna come letta un'intera casella sul server: senza `account` su tutti, senza `mailbox` la cartella speciale. */
  markAllRead: (account: string | null, folder: Folder, mailbox: string | null): Promise<void> =>
    inTauri ? invoke("mark_all_read", { account, folder, mailbox }) : Promise.resolve(),

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

  /** Link http(s) nel browser predefinito; fallisce se il sistema non riesce ad aprirlo. */
  openLink: (url: string): Promise<void> => (inTauri ? invoke("open_link", { url }) : (window.open(url, "_blank", "noopener"), Promise.resolve())),

  /** Browser installati, da proporre se quello predefinito non funziona. */
  listBrowsers: (): Promise<Browser[]> => (inTauri ? invoke("list_browsers") : Promise.resolve([])),

  openLinkWith: (browser: string, url: string): Promise<void> => (inTauri ? invoke("open_link_with", { browser, url }) : Promise.resolve()),

  /** Agenti AI installati sul computer. */
  listAiAgents: (): Promise<AiAgent[]> =>
    inTauri ? invoke("list_ai_agents") : Promise.resolve([{ id: "demo", name: "Agente di prova", path: "" }]),

  /** Manda il testo all'agente e ne restituisce la risposta; `request` serve per `cancelAi`. */
  askAi: (request: string, agent: string, prompt: string): Promise<string> =>
    inTauri
      ? invoke("ask_ai", { request, agent, prompt })
      : new Promise((ok) => setTimeout(() => ok("Questa è una **risposta di prova**: nell’anteprima del browser gli agenti AI non sono disponibili."), 900)),

  cancelAi: (request: string): Promise<void> => (inTauri ? invoke("cancel_ai", { request }) : Promise.resolve()),

  /** Collegamenti MCP configurati. */
  mcpServers: (): Promise<McpServer[]> => (inTauri ? invoke("mcp_servers") : Promise.resolve([])),

  /** Aggiunge o aggiorna (stesso id) un collegamento MCP. */
  mcpSaveServer: (server: McpServer): Promise<McpServer> =>
    inTauri ? invoke("mcp_save_server", { server }) : Promise.reject("Nell’anteprima del browser i collegamenti MCP non sono disponibili."),

  mcpRemoveServer: (id: string): Promise<void> => (inTauri ? invoke("mcp_remove_server", { id }) : Promise.resolve()),

  /** Strumenti del server; `request` serve per `mcpCancel`. */
  mcpListTools: (request: string, server: string): Promise<McpTool[]> =>
    inTauri ? invoke("mcp_list_tools", { request, server }) : Promise.reject("Nell’anteprima del browser i collegamenti MCP non sono disponibili."),

  mcpCallTool: (request: string, server: string, tool: string, args: Record<string, unknown>): Promise<McpResult> =>
    inTauri ? invoke("mcp_call_tool", { request, server, tool, args }) : Promise.reject("Nell’anteprima del browser i collegamenti MCP non sono disponibili."),

  mcpCancel: (request: string): Promise<void> => (inTauri ? invoke("mcp_cancel", { request }) : Promise.resolve()),

  clearCache: (): Promise<void> => (inTauri ? invoke("clear_cache") : Promise.resolve()),

  trayAvailable: (): Promise<boolean> => (inTauri ? invoke("tray_available") : Promise.resolve(false)),

  setTrayUnread: (count: number): Promise<void> => (inTauri ? invoke("set_tray_unread", { count }) : Promise.resolve()),

  /** Riporta in primo piano la finestra, anche se nascosta nell'area di notifica. */
  showWindow: (): Promise<void> => (inTauri ? invoke("show_window") : Promise.resolve()),

  /** Copia un'immagine dal disco nella cache, per metterla nel testo. */
  importInlineImage: (path: string): Promise<InlineImageFile> => (inTauri ? invoke("import_inline_image", { path }) : Promise.reject(new Error("Disponibile nell'app"))),

  /** Immagine incollata (base64 senza intestazione `data:`). */
  pasteInlineImage: (name: string, data: string, mime: string): Promise<InlineImageFile> => {
    if (inTauri) return invoke("paste_inline_image", { name, data });
    const path = `demo/${crypto.randomUUID()}/${name}`;
    demoImages.set(path, `data:${mime};base64,${data}`);
    return Promise.resolve({ path, name, mime, url: demoImages.get(path)! });
  },

  /** Anteprima di un'immagine già in cache, per riaprire una bozza. */
  inlineImageUrl: (path: string): Promise<string> =>
    inTauri ? invoke("inline_image_url", { path }) : demoImages.has(path) ? Promise.resolve(demoImages.get(path)!) : Promise.reject(new Error("Non disponibile")),

  pickImages: async (): Promise<string[]> => {
    if (!inTauri) return [];
    const picked = await open({ multiple: true, title: "Inserisci immagine", filters: [{ name: "Immagini", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }] });
    if (!picked) return [];
    return Array.isArray(picked) ? picked : [picked];
  },

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
