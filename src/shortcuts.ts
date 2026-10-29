// Scorciatoie da tastiera: elenco mostrato nelle Impostazioni (la gestione è in App.tsx).

export const SHORTCUTS: { group: string; items: { keys: string[]; label: string }[] }[] = [
  {
    group: "Generali",
    items: [
      { keys: ["C"], label: "Scrivi un nuovo messaggio" },
      { keys: ["Ctrl", "K"], label: "Cerca in tutti gli account" },
      { keys: ["F5"], label: "Sincronizza ora" },
      { keys: ["Esc"], label: "Chiudi la finestra o svuota la ricerca" },
    ],
  },
  {
    group: "Elenco",
    items: [
      { keys: ["J"], label: "Messaggio successivo" },
      { keys: ["K"], label: "Messaggio precedente" },
    ],
  },
  {
    group: "Messaggio aperto",
    items: [
      { keys: ["R"], label: "Rispondi" },
      { keys: ["A"], label: "Rispondi a tutti" },
      { keys: ["F"], label: "Inoltra" },
      { keys: ["E"], label: "Archivia" },
      { keys: ["Canc"], label: "Sposta nel cestino" },
      { keys: ["S"], label: "Contrassegna" },
      { keys: ["U"], label: "Segna come non letto" },
    ],
  },
  {
    group: "Scrivi",
    items: [{ keys: ["Ctrl", "↵"], label: "Invia" }],
  },
];
