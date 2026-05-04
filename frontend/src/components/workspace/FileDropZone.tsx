import { useCallback, useRef, useState, type DragEvent, type ReactNode } from "react";

const DEFAULT_ACCEPT = ".pdf,.png,.jpg,.jpeg";

function extOk(name: string, accept: string): boolean {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  const parts = accept.split(",").map((p) => p.trim().toLowerCase());
  return parts.some((p) => p.startsWith(".") && p === ext);
}

export default function FileDropZone({
  accept = DEFAULT_ACCEPT,
  maxMb = 20,
  busy,
  disabled,
  onFile,
  children,
}: {
  accept?: string;
  maxMb?: number;
  busy?: boolean;
  disabled?: boolean;
  onFile: (file: File) => void;
  children?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<File | null>(null);

  const validate = useCallback(
    (file: File): string | null => {
      if (!extOk(file.name, accept)) {
        return `Unsupported type. Use: ${accept}`;
      }
      const maxB = maxMb * 1024 * 1024;
      if (file.size > maxB) {
        return `File exceeds ${maxMb} MB limit.`;
      }
      return null;
    },
    [accept, maxMb],
  );

  const pick = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      const e = validate(file);
      if (e) {
        setErr(e);
        setPicked(null);
        return;
      }
      setErr(null);
      setPicked(file);
    },
    [validate],
  );

  const onDrop = (ev: DragEvent) => {
    ev.preventDefault();
    setDrag(false);
    if (disabled || busy) return;
    pick(ev.dataTransfer.files?.[0]);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled && !busy) setDrag(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !busy) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => !disabled && !busy && inputRef.current?.click()}
        style={{
          border: `2px dashed ${drag ? "var(--accent)" : err ? "var(--bad)" : "var(--border-strong)"}`,
          borderRadius: 12,
          padding: "22px 18px",
          textAlign: "center",
          cursor: disabled || busy ? "not-allowed" : "pointer",
          background: drag ? "var(--accent-soft)" : "var(--surface)",
          opacity: disabled || busy ? 0.65 : 1,
          transition: "border-color 0.15s, background 0.15s",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          style={{ display: "none" }}
          disabled={disabled || busy}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {children || (
          <>
            <div style={{ fontSize: "0.92rem" }}>
              Drop tender PDF here or <span style={{ textDecoration: "underline", color: "var(--accent)" }}>browse</span>
            </div>
            <div className="muted" style={{ fontSize: "0.78rem", marginTop: 6 }}>
              PDF, PNG, JPEG up to {maxMb} MB
            </div>
          </>
        )}
      </div>
      {picked && (
        <div className="row" style={{ marginTop: 10, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span className="mono muted" style={{ fontSize: "0.82rem" }}>
            {picked.name} · {(picked.size / (1024 * 1024)).toFixed(2)} MB
          </span>
          <button type="button" className="primary" disabled={busy} onClick={() => onFile(picked)}>
            Upload &amp; extract
          </button>
        </div>
      )}
      {err && (
        <p className="auth-error" style={{ marginTop: 8, fontSize: "0.85rem" }}>
          {err}
        </p>
      )}
    </div>
  );
}
