"use client";

import { useState } from "react";

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
}

/**
 * CopyButton - One-click copy with subtle toast notification
 *
 * Features:
 * - Copies text to clipboard
 * - Shows "Copied!" feedback
 * - Resets after 2 seconds
 */
export default function CopyButton({
  text,
  label,
  className = "",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`font-mono text-sm uppercase tracking-wider text-ink hover:text-ink/70 transition-colors ${className}`}
    >
      {copied ? "Copied!" : label || "Copy"}
    </button>
  );
}

/**
 * CopyableText - Inline text with copy button
 */
export function CopyableText({
  text,
  displayText,
}: {
  text: string;
  displayText?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="group inline-flex items-center gap-2 font-mono text-sm text-ink hover:text-ink/70 transition-colors"
    >
      <span className="underline decoration-1 underline-offset-4">
        {displayText || text}
      </span>
      <span className="text-xs opacity-0 group-hover:opacity-100 transition-opacity">
        {copied ? "✓" : "⎘"}
      </span>
    </button>
  );
}
