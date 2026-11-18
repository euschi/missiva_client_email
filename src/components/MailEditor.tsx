import { useEffect, useRef } from "react";
import { EditorContent, Extension, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import Image from "@tiptap/extension-image";
import { toHtml, toMarkdown, type DocNode, type ImageUrls } from "../markdown";

// Editor della finestra Scrivi: mostra grassetto, corsivo, link, elenchi, citazioni e tabelle
// come appariranno, ma il testo resta quello con la formattazione leggera di markdown.ts.
// Così bozze, modelli e parte in testo semplice non cambiano.

/** Ctrl+Invio spedisce (lo gestisce la finestra): l'editor non deve inserire un a capo. */
const SendKey = Extension.create({
  name: "sendKey",
  priority: 1000,
  addKeyboardShortcuts: () => ({ "Mod-Enter": () => true }),
});

/** Immagine nel testo: oltre all'anteprima ricorda il cid con cui l'email la richiama. */
const MailImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      cid: { default: null, parseHTML: (el) => el.getAttribute("data-cid"), renderHTML: (a) => (a.cid ? { "data-cid": a.cid } : {}) },
    };
  },
}).configure({ inline: true, allowBase64: true });

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
  MailImage,
  SendKey,
];

interface Options {
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
  autofocus: boolean;
  /** Anteprime delle immagini richiamate nel testo. */
  images: ImageUrls;
  /** Cambia quando arrivano nuove anteprime: il contenuto si ridisegna. */
  imagesKey: string;
  /** Immagini incollate nel testo. */
  onPasteImages: (files: File[]) => void;
}

export function useMailEditor({ value, onChange, placeholder, autofocus, images, imagesKey, onPasteImages }: Options): Editor | null {
  // Ultimo testo noto all'editor: se `value` cambia da fuori (un modello) si ricarica il contenuto.
  const known = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const onPasteRef = useRef(onPasteImages);
  onPasteRef.current = onPasteImages;

  const editor = useEditor({
    extensions: [...EXTENSIONS, Placeholder.configure({ placeholder })],
    content: toHtml(value, true, images),
    // Nelle risposte si scrive sopra la citazione: il cursore parte dall'inizio.
    autofocus: autofocus ? "start" : false,
    editorProps: {
      attributes: { class: "compose-body rich", "aria-label": "Testo del messaggio", "aria-multiline": "true", role: "textbox" },
      // Un'immagine incollata va nella cache di Missiva, non nel testo come dati.
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        onPasteRef.current(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        onPasteRef.current(files);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const text = toMarkdown(editor.getJSON() as DocNode);
      known.current = text;
      onChangeRef.current(text);
    },
  });

  useEffect(() => {
    if (!editor || value === known.current) return;
    known.current = value;
    editor.commands.setContent(toHtml(value, true, imagesRef.current), { emitUpdate: false });
  }, [editor, value]);

  // Anteprime arrivate dopo (bozza riaperta): si aggiornano le immagini senza toccare il testo.
  useEffect(() => {
    if (!editor) return;
    const { tr, doc } = editor.state;
    let changed = false;
    doc.descendants((node, pos) => {
      if (node.type.name !== "image" || !node.attrs.cid) return;
      const src = imagesRef.current(node.attrs.cid);
      if (src && src !== node.attrs.src) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, src });
        changed = true;
      }
    });
    if (changed) editor.view.dispatch(tr.setMeta("addToHistory", false));
  }, [editor, imagesKey]);

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
