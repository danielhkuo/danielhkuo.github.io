import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { gridSize } from "./grid";

interface Point {
  x: number;
  y: number;
}

type BarHandler = (e: ReactMouseEvent<HTMLElement>) => void;

export interface TermWindow {
  /** The body's size in cells, as Terminal puts it in the title (80×24). */
  size: { rows: number; cols: number };
  toggleZoom(): void;
  /** For the window element: placement, drag position, inactive state. */
  windowProps: {
    className: string;
    style: CSSProperties | undefined;
    "data-inactive": "" | undefined;
  };
  /** For the title bar: the drag handle and double-click-to-zoom. */
  barProps: {
    className: string;
    onMouseDown: BarHandler;
    onDoubleClick: BarHandler;
  };
}

/**
 * Everything the live terminal does as a macOS window, behind the props for
 * its two elements. It drags by the title bar and zooms from the green light
 * or a double-click. It measures itself in cells for the title and greys out
 * while the browser window is inactive. A press outside it closes it, and on
 * phones it fits the visual viewport so the on-screen keyboard never hides it.
 */
export function useTermWindow(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
): TermWindow {
  // Where the window was dragged to; null while CSS still centres it.
  const [pos, setPos] = useState<Point | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [dragging, setDragging] = useState(false);
  // The pointer's offset into the window at the start of a drag.
  const grab = useRef<Point>({ x: 0, y: 0 });

  const size = useCellSize(ref, open);
  const inactive = useInactive();
  useFitVisualViewport(ref, open);
  useCloseOnOutsidePress(ref, open, onClose);

  // While dragging, the window follows the pointer anywhere on the page.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) =>
      setPos({
        x: Math.max(0, e.clientX - grab.current.x),
        y: Math.max(0, e.clientY - grab.current.y),
      });
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    };
  }, [dragging]);

  const toggleZoom = () => setZoomed((z) => !z);

  const onBarMouseDown: BarHandler = (e) => {
    const win = ref.current;
    if (!win || e.button !== 0 || isControl(e.target)) return;
    // The bar is never a focus target: the prompt keeps focus.
    e.preventDefault();
    if (zoomed) return;
    // The first drag starts from wherever CSS centred the window.
    const rect = win.getBoundingClientRect();
    const start = pos ?? { x: rect.left, y: rect.top };
    setPos(start);
    grab.current = { x: e.clientX - start.x, y: e.clientY - start.y };
    setDragging(true);
  };

  const onBarDoubleClick: BarHandler = (e) => {
    if (!isControl(e.target)) toggleZoom();
  };

  const placement = zoomed ? " term-zoomed" : pos ? "" : " term-centered";
  const style: CSSProperties | undefined = pos ? { left: pos.x, top: pos.y } : undefined;

  return {
    size,
    toggleZoom,
    windowProps: {
      className: `term-win${placement}`,
      style,
      "data-inactive": inactive ? "" : undefined,
    },
    barProps: {
      className: `term-bar${dragging ? " dragging" : ""}`,
      onMouseDown: onBarMouseDown,
      onDoubleClick: onBarDoubleClick,
    },
  };
}

/** A light or the close button: a control in the bar, not a drag handle. */
function isControl(target: EventTarget) {
  return target instanceof Element && target.closest("button") !== null;
}

/**
 * The body's size in whole cells, re-measured as the window resizes — or, on
 * phones, as the frame follows the visual viewport. The cell comes from CSS
 * (--term-cell × --term-line), the grid every body draws on.
 */
function useCellSize(ref: RefObject<HTMLElement | null>, open: boolean) {
  const [size, setSize] = useState({ rows: 24, cols: 80 });
  useEffect(() => {
    const win = ref.current;
    if (!open || !win) return;
    const measure = () => {
      const body = win.querySelector<HTMLElement>(".term-body");
      if (!body) return;
      const cs = getComputedStyle(body);
      const next = gridSize(body, {
        width: parseFloat(cs.getPropertyValue("--term-cell")),
        height: parseFloat(cs.getPropertyValue("--term-line")),
      });
      setSize((s) => (s.rows === next.rows && s.cols === next.cols ? s : next));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(win);
    const frame = win.querySelector(".term-frame");
    if (frame) observer.observe(frame);
    return () => observer.disconnect();
  }, [ref, open]);
  return size;
}

const subscribeToFocus = (onChange: () => void) => {
  window.addEventListener("focus", onChange);
  window.addEventListener("blur", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    window.removeEventListener("blur", onChange);
  };
};

/**
 * macOS greys an inactive window. The nearest a page can get is its own
 * browser window losing focus.
 */
function useInactive() {
  return !useSyncExternalStore(
    subscribeToFocus,
    () => document.hasFocus(),
    () => true,
  );
}

/**
 * Phones: fit the window's frame to the visual viewport.
 *
 * iOS Safari does not shrink the layout viewport for the on-screen keyboard
 * (it ignores `interactive-widget`); it shrinks the VISUAL viewport and lets
 * the user pan it across the layout viewport, so anything position:fixed
 * slides under the keyboard and out the top. Two things keep that from
 * showing: the window itself covers the whole layout viewport (CSS, so a pan
 * only ever reveals more window), and the frame inside it — title bar, body,
 * input row — is placed at the visual viewport's offset and height. The
 * geometry is written straight to the element from the viewport's own events,
 * not through React state: that saves the render round trip, so the frame is
 * where the viewport is on the same frame it moved.
 */
function useFitVisualViewport(ref: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    const view = window.visualViewport;
    const win = ref.current;
    if (!open || !view || !win) return;
    const phone = window.matchMedia("(max-width: 760px)");
    const update = () => {
      if (!phone.matches) {
        win.style.removeProperty("--term-top");
        win.style.removeProperty("--term-h");
        delete win.dataset.keyboard;
        return;
      }
      win.style.setProperty("--term-top", `${Math.max(0, view.offsetTop)}px`);
      win.style.setProperty("--term-h", `${view.height}px`);
      // The keyboard covers the home indicator, so the input row can drop
      // its safe-area padding and sit right on the keyboard.
      if (window.innerHeight - view.height > 120) win.dataset.keyboard = "";
      else delete win.dataset.keyboard;
    };
    update();
    view.addEventListener("resize", update);
    view.addEventListener("scroll", update);
    phone.addEventListener("change", update);
    return () => {
      view.removeEventListener("resize", update);
      view.removeEventListener("scroll", update);
      phone.removeEventListener("change", update);
    };
  }, [ref, open]);
}

/**
 * Close on a press anywhere outside the window — except on the buttons that
 * open it, so pressing a trigger doesn't close-then-reopen.
 */
function useCloseOnOutsidePress(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
) {
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!open) return;
    const onPress = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (ref.current?.contains(target) || target.closest("[data-terminal-trigger]")) return;
      close();
    };
    document.addEventListener("mousedown", onPress);
    return () => document.removeEventListener("mousedown", onPress);
  }, [ref, open]);
}
