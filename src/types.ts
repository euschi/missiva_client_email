// Tipi condivisi con il backend Rust (serde camelCase).

export type Provider = "google" | "microsoft" | "imap";
export type Security = "tls" | "starttls";
export type Folder = "inbox" | "drafts" | "sent" | "archive" | "trash";

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
  /** Id del messaggio programmato che questa bozza sostituisce. */
  replaces?: string;
}
