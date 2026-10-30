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
      { keys: ["J"], label: "Messaggio successivo (anche ↓)" },
      { keys: ["K"], label: "Messaggio precedente (anche ↑)" },
      { keys: ["Ctrl", "clic"], label: "Aggiungi o togli dalla selezione" },
      { keys: ["Maiusc", "clic"], label: "Seleziona un intervallo" },
      { keys: ["Maiusc", "↓"], label: "Allarga la selezione (anche Maiusc ↑)" },
      { keys: ["Ctrl", "A"], label: "Seleziona tutti i messaggi dell'elenco" },
      { keys: ["Esc"], label: "Annulla la selezione" },
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
      { keys: ["B"], label: "Posticipa" },
      { keys: ["L"], label: "Etichetta" },
      { keys: ["U"], label: "Segna come non letto" },
    ],
  },
  {
    group: "Account nella barra laterale",
    items: [
      { keys: ["F2"], label: "Rinomina l'account selezionato" },
      { keys: ["Alt", "↑"], label: "Sposta l'account in su" },
      { keys: ["Alt", "↓"], label: "Sposta l'account in giù" },
    ],
  },
  {
    group: "Scrivi",
    items: [
      { keys: ["Ctrl", "↵"], label: "Invia" },
      { keys: ["Ctrl", "B"], label: "Grassetto" },
      { keys: ["Ctrl", "I"], label: "Corsivo" },
    ],
  },
];
