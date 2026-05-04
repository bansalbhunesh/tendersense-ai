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

export type ToastKind = "success" | "error" | "info" | "warning";

export type ToastAction = { label: string; onClick: () => void };

type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
  durationMs?: number;
  action?: ToastAction;
};

type ToastOptions = {
  durationMs?: number;
  action?: ToastAction;
};

type ToastApi = {
  success: (message: string, opts?: ToastOptions) => void;
  error: (message: string, opts?: ToastOptions) => void;
  info: (message: string, opts?: ToastOptions) => void;
  warning: (message: string, opts?: ToastOptions) => void;
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

  const push = useCallback((kind: ToastKind, message: string, opts?: ToastOptions) => {
    idRef.current += 1;
    const id = idRef.current;
    const durationMs = opts?.durationMs ?? (opts?.action ? 8000 : AUTO_DISMISS_MS);
    setToasts((prev) => [...prev, { id, kind, message, durationMs, action: opts?.action }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, o) => push("success", m, o),
      error: (m, o) => push("error", m, o),
      info: (m, o) => push("info", m, o),
      warning: (m, o) => push("warning", m, o),
      dismiss,
    }),
    [push, dismiss],
  );

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => window.setTimeout(() => dismiss(t.id), t.durationMs ?? AUTO_DISMISS_MS));
    return () => {
      timers.forEach((x) => window.clearTimeout(x));
    };
  }, [toasts, dismiss]);

  const portalTarget = typeof document !== "undefined" ? document.body : null;

  const toastStyles = (kind: ToastKind) => {
    if (kind === "success") {
      return {
        background: "rgba(8, 145, 178, 0.16)",
        border: "1px solid rgba(8, 145, 178, 0.42)",
      };
    }
    if (kind === "error") {
      return {
        background: "rgba(239,68,68,0.15)",
        border: "1px solid rgba(239,68,68,0.45)",
      };
    }
    if (kind === "warning") {
      return {
        background: "rgba(245,158,11,0.14)",
        border: "1px solid rgba(245,158,11,0.45)",
      };
    }
    return {
      background: "rgba(59,130,246,0.15)",
      border: "1px solid rgba(59,130,246,0.45)",
    };
  };

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
              maxWidth: 400,
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
                  ...toastStyles(t.kind),
                  color: "var(--text)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  fontSize: "0.9rem",
                  backdropFilter: "blur(8px)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ flex: 1 }}>{t.message}</span>
                  <button
                    type="button"
                    aria-label="Dismiss notification"
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
                    ×
                  </button>
                </div>
                {t.action && (
                  <div>
                    <button
                      type="button"
                      className="primary"
                      style={{ fontSize: "0.82rem", padding: "6px 12px" }}
                      onClick={() => {
                        t.action?.onClick();
                        dismiss(t.id);
                      }}
                    >
                      {t.action.label}
                    </button>
                  </div>
                )}
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
