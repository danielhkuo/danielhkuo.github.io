"use client";

import { useRef } from "react";
import ScreenView from "./ScreenView";
import ShellView from "./ShellView";
import { useShell } from "./useShell";
import { useTermWindow } from "./useTermWindow";
import { Lights, ProxyIcon } from "./WindowChrome";
import type { TerminalApi } from "./types";

/**
 * The live terminal: a macOS Terminal window (useTermWindow) running a zsh
 * session (useShell). The body is the shell's scrollback and prompt, or a
 * full-screen program while one runs.
 */
export default function Terminal({
  open,
  onClose,
  api,
}: {
  open: boolean;
  onClose: () => void;
  api: TerminalApi;
}) {
  const winRef = useRef<HTMLDialogElement>(null);
  const termWindow = useTermWindow(winRef, open, onClose);
  const shell = useShell(api, onClose, termWindow.size.cols);

  if (!open) return null;

  // Non-modal: the page stays live around it, and a press outside closes it.
  return (
    <dialog ref={winRef} open {...termWindow.windowProps} aria-label="interactive terminal">
      {/* On desktop the frame is display:contents — the window IS the frame.
          On phones it is the part of the window inside the visual viewport. */}
      <div className="term-frame">
        {/* role=presentation: dragging and double-click-to-zoom are pointer
            conveniences. The lights are the controls, and they are buttons. */}
        <div {...termWindow.barProps} role="presentation">
          <Lights onClose={onClose} onMinimize={onClose} onZoom={termWindow.toggleZoom} />
          <ProxyIcon />
          {/* Terminal.app's title: cwd — process — size. The leading dash is a
              login shell's argv[0]; a running program puts its own name there. */}
          <div className="title">
            daniel — {shell.program?.title ?? "-zsh"} — {termWindow.size.cols}×{termWindow.size.rows}
          </div>
          <button type="button" className="term-close" aria-label="close terminal" onClick={onClose}>
            ✕
          </button>
        </div>

        {shell.program ? (
          <ScreenView program={shell.program} onExit={shell.endProgram} onClose={onClose} />
        ) : (
          <ShellView shell={shell} />
        )}
      </div>
    </dialog>
  );
}
