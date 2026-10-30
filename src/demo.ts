// Dati di esempio del design, usati solo quando l'interfaccia gira nel browser senza Tauri.

import type { Account, AccountPatch, Contact, Folder, Guess, Message, Outgoing, Provider, Scheduled, Server, SyncReport } from "./types";

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

let uid = 0;
const msg = (accountId: string, fromName: string, fromEmail: string, to: Contact[], date: number, unread: boolean, subject: string, body: string[], attachments: [string, number, string][] = [], flagged = false): Message => {
  uid += 1;
  const text = body.join("\n\n");
  return {
    id: `${accountId}:inbox:${uid}`, accountId, folder: "inbox", mailbox: "INBOX", uid, messageId: `<demo-${uid}@missiva>`,
    fromName, fromEmail, to, cc: [], subject, body: text, snippet: text.replace(/\s+/g, " ").slice(0, 180),
    date, unread, flagged,
    attachments: attachments.map(([name, size, kind], index) => ({ index, name, size, kind })),
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

let scheduled: Scheduled[] = [];

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
  removeAccount: (id: string) => {
    accounts = accounts.filter((a) => a.id !== id);
    inbox = inbox.filter((m) => m.accountId !== id);
    return wait(undefined, 0);
  },
  messages: (folder: Folder) => wait(folder === "inbox" ? inbox.filter((m) => accounts.some((a) => a.id === m.accountId)) : [], 0),
  sync: async (folder: Folder): Promise<SyncReport> => ({ messages: await demo.messages(folder).then((m) => wait(m, 1200)), errors: [] }),
  setFlags: (m: Message, flags: { seen?: boolean; flagged?: boolean }) => {
    inbox = inbox.map((x) => (x.id === m.id ? { ...x, unread: flags.seen === undefined ? x.unread : !flags.seen, flagged: flags.flagged ?? x.flagged } : x));
    return wait(undefined, 0);
  },
  move: (m: Message, _to: Folder) => {
    inbox = inbox.filter((x) => x.id !== m.id);
    return wait(undefined, 200);
  },
  send: (o: Outgoing) => (o.to.length ? wait(undefined, 800) : Promise.reject("Aggiungi almeno un destinatario")),
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
