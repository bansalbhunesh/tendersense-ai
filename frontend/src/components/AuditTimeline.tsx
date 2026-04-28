type AuditEntry = Record<string, unknown> & {
  id?: string | number;
  created_at?: string;
  action?: string;
  checksum?: string;
};

const ACTION_META: Record<string, { color: string; label: string; icon: string }> = {
  ELIGIBILITY_DECISION: { color: "#0891b2", label: "Eligibility Decision", icon: "📋" },
  OFFICER_OVERRIDE: { color: "#f59e0b", label: "Officer Override", icon: "👤" },
  TENDER_CREATED: { color: "#3b82f6", label: "Tender Created", icon: "📄" },
  DOCUMENT_UPLOADED: { color: "#6366f1", label: "Document Uploaded", icon: "📎" },
  BIDDER_REGISTERED: { color: "#8b5cf6", label: "Bidder Registered", icon: "🏢" },
  EVALUATION_STARTED: { color: "#f59e0b", label: "Evaluation Started", icon: "▶" },
  REVIEW_OVERRIDE: { color: "#f59e0b", label: "Review Override", icon: "✏️" },
};

function actionMeta(action: string) {
  const key = (action || "").toUpperCase().replace(/\s+/g, "_");
  return (
    ACTION_META[key] || { color: "#94a3b8", label: action || "Action", icon: "●" }
  );
}

function relativeTime(isoString: string): string {
  try {
    const diff = Date.now() - new Date(isoString).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(isoString).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch {
    return isoString;
  }
}

export default function AuditTimeline({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) {
    return (
      <p className="muted" style={{ textAlign: "center", padding: "24px 0" }}>
        No audit entries yet.
      </p>
    );
  }

  return (
    <div style={{ position: "relative", paddingLeft: 28 }}>
      {/* vertical spine */}
      <div
        style={{
          position: "absolute",
          left: 9,
          top: 0,
          bottom: 0,
          width: 2,
          background: "rgba(148,163,184,0.12)",
          borderRadius: 1,
        }}
      />

      {entries.map((e, i) => {
        const meta = actionMeta(String(e.action || ""));
        const checksum = String(e.checksum || "").slice(0, 20);
        const when = e.created_at ? relativeTime(String(e.created_at)) : "—";
        const abs = e.created_at
          ? new Date(String(e.created_at)).toLocaleString("en-IN")
          : "";
        const isLast = i === entries.length - 1;

        return (
          <div
            key={String(e.id ?? i)}
            style={{
              position: "relative",
              paddingBottom: isLast ? 0 : 20,
            }}
          >
            {/* dot */}
            <div
              style={{
                position: "absolute",
                left: -24,
                top: 2,
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: `${meta.color}18`,
                border: `2px solid ${meta.color}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.55rem",
                color: meta.color,
              }}
            >
              {meta.icon}
            </div>

            <div
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                background: "var(--inset)",
                border: `1px solid ${meta.color}22`,
                transition: "border-color 0.2s",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: "0.82rem",
                    color: meta.color,
                  }}
                >
                  {meta.label}
                </span>
                <span
                  className="mono muted"
                  style={{ fontSize: "0.7rem" }}
                  title={abs}
                >
                  {when}
                </span>
              </div>

              {checksum && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.62rem",
                      color: "var(--muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    audit hash
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--muted)",
                      background: "var(--surface-2)",
                      padding: "2px 8px",
                      borderRadius: 4,
                    }}
                  >
                    {checksum}…
                  </span>
                  <span
                    style={{
                      fontSize: "0.62rem",
                      color: "#0e7490",
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: "rgba(8, 145, 178, 0.09)",
                      border: "1px solid rgba(8, 145, 178, 0.22)",
                    }}
                  >
                    immutable
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
