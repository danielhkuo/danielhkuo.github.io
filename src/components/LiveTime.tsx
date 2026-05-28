"use client";

import { useState, useEffect, useSyncExternalStore } from "react";

interface LiveTimeProps {
  timezone?: string;
  location?: string;
}

function subscribe() {
  return () => {};
}

export default function LiveTime({
  timezone = "America/Los_Angeles",
  location = "San Francisco, CA",
}: LiveTimeProps) {
  const [time, setTime] = useState<string>("");
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  useEffect(() => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const updateTime = () => {
      setTime(formatter.format(new Date()));
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);

    return () => clearInterval(interval);
  }, [timezone]);

  if (!mounted) {
    return (
      <div className="flex items-center gap-3">
        <div className="size-1.5 bg-ink/20 animate-pulse" />
        <span className="font-mono text-xs uppercase tracking-wider text-ink">
          Loading…
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="size-1.5 bg-ink/60 animate-pulse" />
      <div className="font-mono text-xs uppercase tracking-wider text-ink">
        <span className="tabular-nums">{time}</span>
        <span className="mx-2">·</span>
        <span>{location}</span>
      </div>
    </div>
  );
}
