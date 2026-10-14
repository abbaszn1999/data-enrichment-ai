/**
 * Drives the animated pointer that shows the user what the assistant is doing.
 * The overlay component subscribes; the driver calls move / press / hide.
 */

export type CursorState = {
  visible: boolean;
  x: number;
  y: number;
  pressed: boolean;
  /** Short label next to the pointer, for example "Typing". */
  label: string;
};

type Listener = (state: CursorState) => void;

let state: CursorState = { visible: false, x: 0, y: 0, pressed: false, label: "" };
const listeners = new Set<Listener>();

function publish(next: Partial<CursorState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
}

export function subscribeCursor(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Slide the pointer to the center of an element (the CSS transition lasts about 550 ms). */
export async function moveCursorTo(element: Element, label = ""): Promise<void> {
  const rect = element.getBoundingClientRect();
  const x = rect.left + Math.min(rect.width / 2, 120);
  const y = rect.top + rect.height / 2;
  publish({ visible: true, x, y, label, pressed: false });
  await sleep(620);
}

export async function pressCursor(): Promise<void> {
  publish({ pressed: true });
  await sleep(160);
  publish({ pressed: false });
}

export function hideCursor() {
  publish({ visible: false, label: "", pressed: false });
}
