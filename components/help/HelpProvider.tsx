"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

/**
 * Global on/off state for the in-app help layer (the little (i) info buttons).
 * Persisted in localStorage so the choice survives reloads. Defaults to ON so a
 * brand-new user sees every hint; once they know the app they can switch it off
 * for a clean screen. Pure UI state — touches no business data.
 */
const STORAGE_KEY = "hak61-help-enabled";

type HelpContextValue = {
  enabled: boolean;
  toggle: () => void;
  /** True once the persisted choice has been read on the client. */
  ready: boolean;
};

const HelpContext = createContext<HelpContextValue>({
  enabled: true,
  toggle: () => {},
  ready: false,
});

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(true); // default ON for new users
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "0") setEnabled(false);
    } catch {
      /* localStorage unavailable — keep default ON */
    }
    setReady(true);
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore persistence failure */
      }
      return next;
    });
  }, []);

  return (
    <HelpContext.Provider value={{ enabled, toggle, ready }}>
      {children}
    </HelpContext.Provider>
  );
}

export function useHelp(): HelpContextValue {
  return useContext(HelpContext);
}
