import { useEffect, useRef } from "react";
import { EditorContent, Extension, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { toHtml, toMarkdown, type DocNode } from "../markdown";

// Editor della finestra Scrivi: mostra grassetto, corsivo, link, elenchi, citazioni e tabelle
// come appariranno, ma il testo resta quello con la formattazione leggera di markdown.ts.
// Così bozze, modelli e parte in testo semplice non cambiano.

/** Ctrl+Invio spedisce (lo gestisce la finestra): l'editor non deve inserire un a capo. */
const SendKey = Extension.create({
  name: "sendKey",
  priority: 1000,
  addKeyboardShortcuts: () => ({ "Mod-Enter": () => true }),
});

const EXTENSIONS = [
  // Solo ciò che il testo sa rappresentare: niente titoli, codice, barrato o sottolineato.
  StarterKit.configure({
    heading: false,
    code: false,
    codeBlock: false,
    strike: false,
    underline: false,
    horizontalRule: false,
    orderedList: false,
    link: { openOnClick: false, autolink: true, protocols: ["mailto"], defaultProtocol: "https" },
  }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  SendKey,
];

export function useMailEditor({ value, onChange, placeholder, autofocus }: { value: string; onChange: (text: string) => void; placeholder: string; autofocus: boolean }): Editor | null {
  // Ultimo testo noto all'editor: se `value` cambia da fuori (un modello) si ricarica il contenuto.
  const known = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [...EXTENSIONS, Placeholder.configure({ placeholder })],
    content: toHtml(value, true),
    // Nelle risposte si scrive sopra la citazione: il cursore parte dall'inizio.
    autofocus: autofocus ? "start" : false,
    editorProps: { attributes: { class: "compose-body rich", "aria-label": "Testo del messaggio", "aria-multiline": "true", role: "textbox" } },
    onUpdate: ({ editor }) => {
      const text = toMarkdown(editor.getJSON() as DocNode);
      known.current = text;
      onChangeRef.current(text);
    },
  });

  useEffect(() => {
    if (!editor || value === known.current) return;
    known.current = value;
    editor.commands.setContent(toHtml(value, true), { emitUpdate: false });
  }, [editor, value]);

  return editor;
}

export function MailEditorView({ editor }: { editor: Editor | null }) {
  return <EditorContent editor={editor} style={{ display: "contents" }} />;
}

/** Indirizzo da usare per un link: senza schema si sottintende https. */
export function linkHref(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (/^(https?:\/\/|mailto:)\S+$/i.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  if (/^[^\s/]+\.[^\s]+$/.test(v)) return `https://${v}`;
  return null;
}
