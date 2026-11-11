const svg = (body: string, extra = ""): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;

export const LOCK = svg('<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>');
export const COINS = svg(
  '<circle cx="9" cy="9" r="6"/><path d="M14.2 6.3a6 6 0 1 1-7.9 7.9" /><circle cx="9" cy="9" r="2" fill="currentColor" stroke="none"/>',
  ' stroke-width="2"',
);
export const CHECK = svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', ' class="ck" stroke-width="2.6"');
export const CLOSE = svg('<path d="M6 6l12 12M18 6L6 18"/>');
export const SPINNER = svg(
  '<circle cx="12" cy="12" r="9" opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"/>',
  ' class="sp" stroke-width="3"',
);
