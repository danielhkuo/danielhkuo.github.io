"use client";

/**
 * A prompt-styled affordance shown inside the decorative #about terminal panel.
 * Clicking it asks the TerminalLauncher to open the real interactive shell and
 * passes the button as the focus-return target.
 */
export default function ShellHint() {
  return (
    <button
      type="button"
      data-terminal-trigger=""
      onClick={(e) =>
        window.dispatchEvent(
          new CustomEvent("terminal:open", {
            detail: { trigger: e.currentTarget },
          }),
        )
      }
      className="group mt-1 inline-flex items-center gap-2 font-mono text-[var(--panel-accent)] transition-opacity hover:opacity-80 focus:outline-none focus-visible:underline"
    >
      <span aria-hidden>$</span>
      <span className="underline decoration-dotted underline-offset-4">
        open ./shell
      </span>
      <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
        ↵
      </span>
    </button>
  );
}
