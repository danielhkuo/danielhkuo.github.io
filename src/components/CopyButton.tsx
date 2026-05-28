"use client";

import { useState } from "react";

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
      type="button"
      onClick={handleCopy}
      className="group inline-flex items-center gap-2 font-mono text-sm text-ink hover:text-ink transition-colors"
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
