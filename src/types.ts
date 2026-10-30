// Tipi condivisi con il backend Rust (serde camelCase).

export type Provider = "google" | "microsoft" | "imap";
export type Security = "tls" | "starttls";
/** "other" è una cartella creata dall'utente: la casella IMAP vera è in `Message.mailbox`. */
export type Folder = "inbox" | "drafts" | "sent" | "archive" | "trash" | "other";

/** Cartella creata dall'utente sul server. */
export interface Mailbox {
  /** Nome IMAP esatto, da usare con il server. */
  path: string;
  /** Ultima parte del percorso, leggibile. */
  name: string;
  /** Percorso leggibile completo («Clienti / Acme»). */
  label: string;
  delimiter: string;
  /** Cartella speciale che Missiva gestisce già (posta in arrivo, inviati…). */
  special: Folder | null;
  /** Falso per i soli contenitori (es. «[Gmail]»). */
  selectable: boolean;
}

/** Cartella dell'utente aperta nell'elenco. */
export interface OpenBox {
  accountId: string;
  mailbox: Mailbox;
}

export interface Server {
  host: string;
  port: number;
  security: Security;
}

export interface Account {
  id: string;
  name: string;
  email: string;
  displayName: string;
  provider: Provider;
  color: string;
  imap: Server;
  smtp: Server;
  username: string;
  syncDays: number;
  signature: string;
}

export interface Attachment {
  index: number;
  name: string;
  size: number;
  kind: string;
  /** Tipo MIME, per scegliere l'anteprima. */
  mime: string;
  /** Immagine già mostrata dentro l'HTML del messaggio. */
  inline: boolean;
}

export interface HtmlView {
  html: string;
  /** Contiene immagini o stili caricati da internet. */
  remote: boolean;
}

export interface Contact {
  name: string;
  email: string;
}

export interface Message {
  id: string;
  accountId: string;
  folder: Folder;
  mailbox: string;
  uid: number;
  messageId: string | null;
  /** Message-ID a cui risponde. */
  inReplyTo: string | null;
  /** Catena della conversazione, dal messaggio più vecchio. */
  references: string[];
  fromName: string;
  fromEmail: string;
  to: Contact[];
  cc: Contact[];
  subject: string;
  snippet: string;
  body: string;
  /** Secondi Unix. */
  date: number;
  unread: boolean;
  flagged: boolean;
  attachments: Attachment[];
  /** Ha una parte HTML da mostrare al posto del testo. */
  hasHtml: boolean;
  /** Solo lato interfaccia: il messaggio è in coda di invio. */
  scheduled?: Scheduled;
}

export interface SyncReport {
  messages: Message[];
  errors: { accountId: string; message: string }[];
}

export interface Guess {
  found: boolean;
  imap: Server;
  smtp: Server;
}

export interface Outgoing {
  accountId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  /** Versione HTML, solo se il testo usa la formattazione. */
  html: string | null;
  attachments: string[];
  inReplyTo: string | null;
  /** Catena della conversazione (header References). */
  references?: string[];
  /** Message-ID scelto in anticipo: la copia locale e quella del server coincidono. */
  messageId?: string | null;
}

/** Messaggio in coda per "Invia più tardi". */
export interface Scheduled {
  id: string;
  /** Secondi Unix. */
  at: number;
  outgoing: Outgoing;
  attempts: number;
  error: string | null;
}

export interface AccountPatch {
  id: string;
  name?: string;
  displayName?: string;
  color?: string;
  signature?: string;
}

/** Bozza con cui si apre la finestra Scrivi. */
export interface Draft {
  accountId?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  attachments?: string[];
  inReplyTo: string | null;
  references?: string[];
  /** Id del messaggio programmato che questa bozza sostituisce. */
  replaces?: string;
}
