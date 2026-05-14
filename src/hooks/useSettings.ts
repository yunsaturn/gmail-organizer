"use client";

import { useEffect, useState } from "react";

interface Settings {
  kuaiEnabled: boolean;
}

const DEFAULT: Settings = { kuaiEnabled: false };
const KEY = "gmail-organizer-settings";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try { setSettings({ ...DEFAULT, ...JSON.parse(raw) }); } catch {}
    }
    setReady(true);
  }, []);

  return { settings, ready };
}
