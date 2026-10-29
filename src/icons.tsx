// Icone a tratto del design (viewBox 24, stroke currentColor).

const PATHS = {
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35",
  sync: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16 M8 16H3v5",
  minimize: "M6 12h12",
  maximize: "M6 6h12v12H6z",
  close: "M6 6l12 12 M18 6L6 18",
  pen: "M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z",
  plus: "M12 5v14 M5 12h14",
  sliders: "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  draft: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 15h6",
  send: "M22 2 11 13 M22 2l-7 20-4-9-9-4 20-7z",
  archive: "M21 8v13H3V8 M1 3h22v5H1z M10 12h4",
  trash: "M3 6h18 M8 6V4h8v2 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
  filter: "M3 6h18 M7 12h10 M10 18h4",
  reply: "M9 17l-5-5 5-5 M4 12h11a5 5 0 0 1 5 5v2",
  replyAll: "M7 17l-5-5 5-5 M12 17l-5-5 5-5 M7 12h8a5 5 0 0 1 5 5v2",
  forward: "M15 17l5-5-5-5 M20 12H9a5 5 0 0 0-5 5v2",
  mail: "M4 4h16v16H4z M22 6l-10 7L2 6",
  clip: "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48",
  chevron: "M6 9l6 6 6-6",
  check: "M20 6 9 17l-5-5",
  lock: "M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4",
  server: "M2 3h20v8H2z M2 13h20v8H2z M6 7h.01 M6 17h.01",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4",
  external: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14 21 3",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  palette: "M12 22a10 10 0 1 1 0-20c5.5 0 10 4 10 9a5 5 0 0 1-5 5h-2a2 2 0 0 0-1 3.7A1.5 1.5 0 0 1 12 22z M7.5 10.5h.01 M12 7.5h.01 M16.5 10.5h.01",
  alert: "M12 9v4 M12 17h.01 M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z",
  markUnread: "M22 6v12H2V6 M22 6l-10 7L2 6 M19 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
} as const;

export type IconName = keyof typeof PATHS;

interface Props {
  name: IconName;
  size?: number;
  stroke?: number;
  fill?: string;
  label?: string;
  className?: string;
}

export function Icon({ name, size = 16, stroke = 1.8, fill = "none", label, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
