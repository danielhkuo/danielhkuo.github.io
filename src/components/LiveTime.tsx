"use client";

import { useState, useEffect } from "react";

interface LiveTimeProps {
  timezone?: string;
  location?: string;
}

/**
 * LiveTime - Client-side widget showing current local time
 *
 * Features:
 * - Updates every second
 * - Shows time in user's timezone
 * - Monospace typography for precision
 */
export default function LiveTime({
  timezone = "America/Los_Angeles",
  location = "San Francisco, CA",
}: LiveTimeProps) {
  const [time, setTime] = useState<string>("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    const updateTime = () => {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(now);

      setTime(formatted);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);

    return () => clearInterval(interval);
  }, [timezone]);

  if (!mounted) {
    return (
      <div className="flex items-center gap-3">
        <div className="w-1.5 h-1.5 bg-ink/20 animate-pulse" />
        <span className="font-mono text-xs uppercase tracking-wider text-ink/40">
          Loading...
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="w-1.5 h-1.5 bg-ink/60 animate-pulse" />
      <div className="font-mono text-xs uppercase tracking-wider text-ink/60">
        <span className="tabular-nums">{time}</span>
        <span className="mx-2">·</span>
        <span>{location}</span>
      </div>
    </div>
  );
}
