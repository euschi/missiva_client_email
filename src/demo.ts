// Dati di esempio del design, usati solo quando l'interfaccia gira nel browser senza Tauri.

import type { Account, AccountPatch, Contact, Folder, Guess, HtmlView, Mailbox, Message, Outgoing, Provider, Scheduled, Server, SyncReport } from "./types";

const tls = (host: string, port: number): Server => ({ host, port, security: "tls" });

let accounts: Account[] = [
  { id: "personal", name: "Personale", email: "eugenio@gmail.com", displayName: "Eugenio", provider: "google", color: "#F2A65A", imap: tls("imap.gmail.com", 993), smtp: tls("smtp.gmail.com", 465), username: "eugenio@gmail.com", syncDays: 90, signature: "" },
  { id: "work", name: "Lavoro", email: "eugenio@azienda.it", displayName: "Eugenio", provider: "microsoft", color: "#7AB0FF", imap: tls("outlook.office365.com", 993), smtp: { host: "smtp.office365.com", port: 587, security: "starttls" }, username: "eugenio@azienda.it", syncDays: 90, signature: "Backend & DevOps · [NOME AZIENDA]" },
  { id: "dev", name: "Dominio", email: "me@eugenio.dev", displayName: "Eugenio", provider: "imap", color: "#C7B5FF", imap: tls("imap.eugenio.dev", 993), smtp: tls("smtp.eugenio.dev", 465), username: "me@eugenio.dev", syncDays: 90, signature: "eugenio.dev" },
];

const now = new Date();
const at = (daysAgo: number, h: number, m: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return Math.floor(d.getTime() / 1000);
};

const EMAIL = { personal: "eugenio@gmail.com", work: "eugenio@azienda.it", dev: "me@eugenio.dev" };
const me = (email: string): Contact => ({ name: "Eugenio", email });

const MIME: Record<string, string> = { PDF: "application/pdf", PNG: "image/png", TXT: "text/plain" };

let uid = 0;
const msg = (accountId: string, fromName: string, fromEmail: string, to: Contact[], date: number, unread: boolean, subject: string, body: string[], attachments: [string, number, string][] = [], flagged = false): Message => {
  uid += 1;
  const text = body.join("\n\n");
  return {
    id: `${accountId}:inbox:${uid}`, accountId, folder: "inbox", mailbox: "INBOX", uid, messageId: `demo-${uid}@missiva`, inReplyTo: null, references: [],
    fromName, fromEmail, to, cc: [], subject, body: text, snippet: text.replace(/\s+/g, " ").slice(0, 180),
    date, unread, flagged,
    attachments: attachments.map(([name, size, kind], index) => ({ index, name, size, kind, mime: MIME[kind] ?? "application/octet-stream", inline: false })),
    hasHtml: subject.startsWith("Numero 212"),
  };
};

let inbox: Message[] = [
  msg("work", "Giulia Ferri", "giulia.ferri@azienda.it", [me("eugenio@azienda.it"), { name: "Marco Valli", email: "marco.valli@azienda.it" }], at(0, 9, 42), true, "Architettura del nuovo gateway — note per giovedì",
    ["Ciao Eugenio,", "ti giro le note prima della riunione di giovedì, così arriviamo allineati. In sintesi: spostiamo l’autenticazione sul gateway e lasciamo ai singoli servizi solo la verifica del token.", "Nel PDF trovi lo schema aggiornato con i tre scenari di rollout. Il secondo mi sembra il più prudente: partiamo dai servizi interni e apriamo verso l’esterno solo dopo due settimane di osservazione.", "Riesci a darci un’occhiata entro mercoledì sera? Se hai dubbi sul diagramma di sequenza ci sentiamo anche domani mattina.", "A presto,", "Giulia"],
    [["gateway-architettura-v3.pdf", 2_516_582, "PDF"], ["sequenza-autenticazione.png", 655_360, "PNG"]], true),
  msg("dev", "Build bot", "ci@eugenio.dev", [me(EMAIL.dev)], at(0, 9, 15), true, "Pipeline #4821 superata su main",
    ["La pipeline #4821 sul ramo main è stata completata.", "Test: 312 superati, 0 falliti. Durata: 4 min 12 s.", "L’immagine del container è stata pubblicata nel registry con il tag 1.8.3."]),
  msg("personal", "Chiara Russo", "chiara.russo@gmail.com", [me(EMAIL.personal)], at(0, 8, 3), false, "Sabato sera da noi?",
    ["Ciao!", "Sabato sera facciamo una cena tranquilla da noi, verso le otto. Ci sono anche Luca e Sara.", "Porta pure quel vino di cui parlavi l’altra volta, siamo curiosi.", "Fammi sapere,", "Chiara"]),
  msg("work", "Anna Bianchi", "anna.bianchi@azienda.it", [me("eugenio@azienda.it"), { name: "Team backend", email: "backend@azienda.it" }], at(1, 17, 20), true, "Ferie di dicembre — conferma entro venerdì",
    ["Ciao a tutti,", "per organizzare i turni del periodo natalizio mi servono le vostre date di ferie entro venerdì.", "Basta rispondere a questa mail con i giorni: aggiorno io il calendario condiviso.", "Grazie,", "Anna"]),
  msg("personal", "Aerolinee Tirreno", "checkin@tirreno.example", [me(EMAIL.personal)], at(1, 11, 5), false, "Carta d’imbarco · Roma FCO → Lisbona LIS",
    ["Il check-in per il tuo volo è completato.", "Roma Fiumicino → Lisbona, 7 novembre. Posto 14A.", "Trovi la carta d’imbarco in allegato: puoi mostrarla dal telefono al controllo di sicurezza."],
    [["carta-imbarco.pdf", 184_320, "PDF"]]),
  msg("dev", "Registro Domini", "rinnovi@registro.example", [me(EMAIL.dev)], at(3, 10, 30), false, "Il dominio eugenio.dev scade tra 30 giorni",
    ["Il dominio eugenio.dev scade tra 30 giorni.", "Il rinnovo automatico è attivo: non devi fare nulla. Ti avviseremo a rinnovo completato."]),
  msg("work", "Marco Valli", "marco.valli@azienda.it", [me(EMAIL.work)], at(4, 19, 12), false, "Re: Accessi VPN per il nuovo collega",
    ["Fatto, gli ho mandato le credenziali temporanee.", "Lunedì lo affianchi tu per la configurazione dell’ambiente?", "Marco"]),
  msg("personal", "Note dal kernel", "numero@notedalkernel.example", [me(EMAIL.personal)], at(4, 8, 0), false, "Numero 212 — scheduler, Wayland e file system",
    ["Questa settimana: le novità dello scheduler, lo stato di Wayland sulle schede grafiche ibride e un confronto pratico tra file system.", "Buona lettura."]),
];

// Una conversazione completa: la risposta inviata a Giulia e la replica di Marco.
const nowSec = () => Math.floor(Date.now() / 1000);
const sentCopy = (o: Outgoing, date: number): Message => ({
  ...inbox[0],
  id: `${o.accountId}:sent:${date}`,
  accountId: o.accountId,
  folder: "sent",
  mailbox: "Sent Items",
  messageId: o.messageId ?? `demo-sent-${date}@missiva`,
  inReplyTo: o.inReplyTo,
  references: o.references ?? [],
  fromName: "Eugenio",
  fromEmail: accounts.find((a) => a.id === o.accountId)?.email ?? "",
  to: o.to.map((email) => ({ name: email, email })),
  cc: [],
  subject: o.subject,
  body: o.body,
  snippet: o.body.replace(/\s+/g, " ").slice(0, 180),
  date,
  unread: false,
  flagged: false,
  attachments: [],
  hasHtml: false,
});
const gateway = inbox[0];
let sentBox: Message[] = [
  {
    ...sentCopy(
      { accountId: "work", to: [gateway.fromEmail], cc: [], bcc: [], subject: `Re: ${gateway.subject}`, body: "Grazie Giulia, ci guardo stasera.\n\nPer me il secondo scenario va bene, ne parliamo giovedì.", html: null, attachments: [], inReplyTo: gateway.messageId, references: [gateway.messageId!], messageId: "demo-900@missiva" },
      gateway.date - 1500,
    ),
    to: [{ name: "Giulia Ferri", email: gateway.fromEmail }],
  },
];
inbox.push({
  ...gateway,
  id: "work:inbox:901",
  uid: 901,
  messageId: "demo-901@missiva",
  inReplyTo: "demo-900@missiva",
  references: [gateway.messageId!, "demo-900@missiva"],
  fromName: "Marco Valli",
  fromEmail: "marco.valli@azienda.it",
  subject: `Re: ${gateway.subject}`,
  body: "D'accordo anche io sul secondo scenario.\n\nPreparo i numeri sul traffico dei servizi interni per giovedì.\n\nMarco",
  snippet: "D'accordo anche io sul secondo scenario. Preparo i numeri sul traffico dei servizi interni per giovedì.",
  date: gateway.date - 600,
  unread: true,
  flagged: false,
  attachments: [],
});
// Il primo messaggio della conversazione è il più vecchio dei tre.
inbox[0] = { ...gateway, date: gateway.date - 3600 };

let scheduled: Scheduled[] = [];

const box = (path: string, special: Folder | null = null, selectable = true): Mailbox => ({
  path,
  name: path.split("/").pop()!,
  label: path.split("/").join(" / "),
  delimiter: "/",
  special,
  selectable,
});
const MAILBOXES: Record<string, Mailbox[]> = {
  work: [box("INBOX", "inbox"), box("Sent Items", "sent"), box("Drafts", "drafts"), box("Deleted Items", "trash"), box("Archive", "archive"), box("Clienti"), box("Clienti/Acme"), box("Clienti/Borealis"), box("Fatture 2026"), box("Junk Email")],
  personal: [box("INBOX", "inbox"), box("[Gmail]", null, false), box("[Gmail]/Bozze", "drafts"), box("[Gmail]/Posta inviata", "sent"), box("[Gmail]/Cestino", "trash"), box("[Gmail]/Spam"), box("Viaggi"), box("Viaggi/Lisbona")],
  dev: [box("INBOX", "inbox"), box("INBOX/CI"), box("Sent", "sent"), box("Trash", "trash")],
};

const NEWSLETTER_HTML = `<style type="text/css">
  body { background: #f3efe6; } .wrap { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; }
  .head { background: #1f2a44; color: #fff; padding: 24px; } h1 { margin: 0; font: 700 26px Georgia, serif; }
  .item { padding: 16px 24px; border-bottom: 1px solid #eee; } a { color: #2563eb; }
  @media (prefers-color-scheme: dark) { .item { color: #ffffff !important; } }
</style>
<div class="wrap">
  <div class="head"><h1>Note dal kernel</h1><p>Numero 212 · settimana 44</p></div>
  <img src="https://example.com/banner.png" alt="Banner remoto" width="560">
  <div class="item"><b>Scheduler</b>: le novità di EEVDF e cosa cambia per i desktop. <a href="https://example.com/scheduler">Leggi</a></div>
  <div class="item"><b>Wayland</b> sulle schede grafiche ibride: lo stato dei driver.</div>
  <div class="item"><b>File system</b>: confronto pratico tra ext4, btrfs e bcachefs.</div>
</div>`;

/** PNG generato al volo per provare miniature e anteprime nel browser. */
async function demoPng(label: string): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(640, 400);
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#1f2a44";
  g.fillRect(0, 0, 640, 400);
  g.fillStyle = "#c9f26b";
  g.font = "bold 36px sans-serif";
  g.fillText(label, 40, 210);
  return (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
}

/** PDF minimo di due pagine (pdf.js ricostruisce la tabella xref). */
function demoPdf(title: string): ArrayBuffer {
  const page = (n: number, text: string) =>
    `${n} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents ${n + 1} 0 R >> endobj\n` +
    `${n + 1} 0 obj << /Length ${text.length + 40} >> stream\nBT /F1 28 Tf 72 760 Td (${text}) Tj ET\nendstream endobj\n`;
  const pdf =
    "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n" +
    "2 0 obj << /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >> endobj\n" +
    page(3, title) +
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n" +
    page(6, "Pagina 2") +
    "trailer << /Root 1 0 R >>\n%%EOF";
  return new TextEncoder().encode(pdf).buffer as ArrayBuffer;
}

const wait = <T,>(v: T, ms = 300) => new Promise<T>((r) => setTimeout(() => r(v), ms));

export const demo = {
  listAccounts: () => wait(accounts, 0),
  autoconfig: (email: string): Promise<Guess> => {
    const domain = email.split("@")[1] ?? "";
    return wait({ found: !!domain, imap: tls(`imap.${domain}`, 993), smtp: tls(`smtp.${domain}`, 465) }, 500);
  },
  addImapAccount: (input: { email: string; imap: Server; smtp: Server; syncDays: number }): Promise<Account> => {
    const acc: Account = { id: crypto.randomUUID(), name: input.email.split("@")[1] ?? input.email, email: input.email, displayName: input.email.split("@")[0], provider: "imap", color: "#7EE0B5", imap: input.imap, smtp: input.smtp, username: input.email, syncDays: input.syncDays, signature: "" };
    accounts = [...accounts, acc];
    return wait(acc, 900);
  },
  addOauthAccount: (_provider: Provider): Promise<Account> =>
    Promise.reject("Nell’anteprima del browser l’accesso OAuth non è disponibile: avvia l’app con «npm run tauri dev»."),
  updateAccount: (patch: AccountPatch): Promise<Account> => {
    accounts = accounts.map((a) => (a.id === patch.id ? { ...a, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } : a));
    return wait(accounts.find((a) => a.id === patch.id)!, 0);
  },
  reorderAccounts: (ids: string[]): Promise<Account[]> => {
    const at = (a: Account) => (ids.includes(a.id) ? ids.indexOf(a.id) : Infinity);
    accounts = [...accounts].sort((a, b) => at(a) - at(b));
    return wait(accounts, 0);
  },
  mailboxes: (account: string) => wait(MAILBOXES[account] ?? [], 0),
  syncMailbox: async (account: string, mailbox: string): Promise<SyncReport> => {
    // Qualche messaggio dell'account, come se fosse stato spostato in quella cartella.
    const picked = inbox.filter((m) => m.accountId === account).slice(0, mailbox.length % 2 ? 2 : 1);
    const messages = picked.map((m) => ({ ...m, id: `${m.id}:${mailbox}`, folder: "other" as const, mailbox, unread: false }));
    return wait({ messages, errors: [] }, 400);
  },
  messageHtml: (m: Message): Promise<HtmlView | null> => wait(m.hasHtml ? { html: NEWSLETTER_HTML, remote: true } : null, 150),
  attachmentBytes: async (m: Message, index: number): Promise<ArrayBuffer> => {
    const f = m.attachments[index];
    await wait(null, 250);
    if (f.mime.startsWith("image/")) return demoPng(f.name);
    if (f.mime === "application/pdf") return demoPdf(f.name);
    return new TextEncoder().encode(`Contenuto di ${f.name}`).buffer as ArrayBuffer;
  },
  removeAccount: (id: string) => {
    accounts = accounts.filter((a) => a.id !== id);
    inbox = inbox.filter((m) => m.accountId !== id);
    return wait(undefined, 0);
  },
  messages: (folder: Folder) =>
    wait((folder === "inbox" ? inbox : folder === "sent" ? sentBox : []).filter((m) => accounts.some((a) => a.id === m.accountId)), 0),
  sync: async (folder: Folder, account?: string): Promise<SyncReport> => ({
    messages: (await demo.messages(folder).then((m) => wait(m, 1200))).filter((m) => !account || m.accountId === account),
    errors: [],
  }),
  setFlags: (m: Message, flags: { seen?: boolean; flagged?: boolean }) => {
    inbox = inbox.map((x) => (x.id === m.id ? { ...x, unread: flags.seen === undefined ? x.unread : !flags.seen, flagged: flags.flagged ?? x.flagged } : x));
    return wait(undefined, 0);
  },
  move: (m: Message, _to: Folder) => {
    inbox = inbox.filter((x) => x.id !== m.id);
    return wait(undefined, 200);
  },
  send: (o: Outgoing) => {
    if (!o.to.length) return Promise.reject("Aggiungi almeno un destinatario");
    sentBox = [...sentBox, sentCopy(o, nowSec())];
    return wait(undefined, 800);
  },
  schedule: (outgoing: Outgoing, at: number) => {
    const s: Scheduled = { id: crypto.randomUUID(), at, outgoing, attempts: 0, error: null };
    scheduled = [...scheduled, s];
    return wait(s, 200);
  },
  listScheduled: () => wait(scheduled, 0),
  cancelScheduled: (id: string) => {
    scheduled = scheduled.filter((s) => s.id !== id);
    return wait(undefined, 200);
  },
  readStore: (name: string) => {
    try {
      return wait(JSON.parse(localStorage.getItem(`missiva.demo.${name}`) ?? "null"), 0);
    } catch {
      return wait(null, 0);
    }
  },
  writeStore: (name: string, value: unknown) => {
    try {
      localStorage.setItem(`missiva.demo.${name}`, JSON.stringify(value));
    } catch {
      // Anteprima senza storage: i dati restano solo in memoria.
    }
    return wait(undefined, 0);
  },
};
