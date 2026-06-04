"use client";

import { useState, useEffect, useSyncExternalStore } from "react";

interface LiveTimeProps {
  timezone?: string;
  location?: string;
  variant?: "compact" | "prominent";
}

function subscribe() {
  return () => {};
}

export default function LiveTime({
  timezone = "America/Los_Angeles",
  location = "San Francisco, CA",
  variant = "compact",
}: LiveTimeProps) {
  const [time, setTime] = useState<string>("");
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const isProminent = variant === "prominent";

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
      <div className={isProminent ? "capsule-shell inline-flex items-center gap-3 px-5 py-4" : "capsule-shell inline-flex items-center gap-3 px-4 py-3"}>
        <div className="size-2 animate-pulse rounded-full bg-secondary" />
        <span className={isProminent ? "caps-label text-sm text-text-muted" : "caps-label text-xs text-text-muted"}>
          Loading…
        </span>
      </div>
    );
  }

  return (
    <div className={isProminent ? "capsule-shell inline-flex items-center gap-4 px-5 py-4" : "capsule-shell inline-flex items-center gap-3 px-4 py-3"}>
      <div className={isProminent ? "size-2.5 animate-pulse rounded-full bg-available" : "size-2 animate-pulse rounded-full bg-available"} />
      <div className={isProminent ? "caps-label text-xl text-text-primary sm:text-2xl" : "caps-label text-xs text-text-primary"}>
        <span className="tabular-nums">{time}</span>
        {location ? (
          <>
            <span className="mx-2">·</span>
            <span>{location}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
