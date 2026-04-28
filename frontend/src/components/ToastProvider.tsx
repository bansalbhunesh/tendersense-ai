import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ToastKind = "success" | "error" | "info";

type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
};

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    idRef.current += 1;
    const id = idRef.current;
    setToasts((prev) => [...prev, { id, kind, message }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m: string) => push("success", m),
      error: (m: string) => push("error", m),
      info: (m: string) => push("info", m),
      dismiss,
    }),
    [push, dismiss],
  );

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      window.setTimeout(() => dismiss(t.id), AUTO_DISMISS_MS),
    );
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [toasts, dismiss]);

  const portalTarget = typeof document !== "undefined" ? document.body : null;

  return (
    <ToastContext.Provider value={api}>
      {children}
      {portalTarget &&
        createPortal(
          <div
            data-testid="toast-stack"
            style={{
              position: "fixed",
              top: 16,
              right: 16,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              zIndex: 9999,
              maxWidth: 380,
            }}
          >
            {toasts.map((t) => (
              <div
                key={t.id}
                role="status"
                data-testid={`toast-${t.kind}`}
                style={{
                  padding: "12px 16px",
                  borderRadius: 10,
                  background:
                    t.kind === "success"
                      ? "rgba(8, 145, 178, 0.16)"
                      : t.kind === "error"
                        ? "rgba(239,68,68,0.15)"
                        : "rgba(59,130,246,0.15)",
                  border:
                    t.kind === "success"
                      ? "1px solid rgba(8, 145, 178, 0.42)"
                      : t.kind === "error"
                        ? "1px solid rgba(239,68,68,0.45)"
                        : "1px solid rgba(59,130,246,0.45)",
                  color: "var(--text)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  fontSize: "0.9rem",
                  backdropFilter: "blur(8px)",
                }}
              >
                <span style={{ flex: 1 }}>{t.message}</span>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => dismiss(t.id)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--muted)",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: "1rem",
                    lineHeight: 1,
                  }}
                >
                  x
                </button>
              </div>
            ))}
          </div>,
          portalTarget,
        )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside a ToastProvider");
  }
  return ctx;
}
