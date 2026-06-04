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
      className="group capsule-shell inline-flex items-center gap-3 px-4 py-3 text-sm text-text-primary hover:border-primary hover:shadow-md"
    >
      <span className="font-body">
        {displayText || text}
      </span>
      <span className="caps-label text-[0.68rem] text-text-muted opacity-70 group-hover:opacity-100">
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}
