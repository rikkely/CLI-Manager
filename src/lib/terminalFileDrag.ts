interface TerminalFileDragPayload {
  text: string;
}

let currentDrag: TerminalFileDragPayload | null = null;

export function beginTerminalFileDrag(text: string) {
  currentDrag = text ? { text } : null;
}

export function endTerminalFileDrag() {
  currentDrag = null;
}

export function getTerminalFileDragText(): string {
  return currentDrag?.text ?? "";
}
