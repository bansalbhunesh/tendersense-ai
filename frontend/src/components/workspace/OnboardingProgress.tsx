export type OnboardingStep = {
  id: string;
  label: string;
  done: boolean;
  tooltip: string;
};

export default function OnboardingProgress({
  steps,
  activeIndex,
}: {
  steps: OnboardingStep[];
  activeIndex: number;
}) {
  return (
    <div
      className="onboarding-rail"
      role="navigation"
      aria-label="Workspace setup steps"
      style={{
        marginBottom: 20,
        padding: "14px 18px",
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--surface-2)",
      }}
    >
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <strong style={{ fontSize: "0.88rem" }}>Getting started</strong>
        <span className="muted" style={{ fontSize: "0.72rem" }}>
          Follow the steps in order
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 0,
          flexWrap: "wrap",
          rowGap: 8,
        }}
      >
        {steps.map((s, i) => {
          const isActive = i === activeIndex;
          const dotFill = s.done ? "var(--ok)" : isActive ? "var(--warn)" : "var(--progress-track)";
          const ring = isActive ? "0 0 0 3px rgba(245,158,11,0.25)" : "none";
          return (
            <div key={s.id} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? "1 1 40px" : "0 0 auto", minWidth: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 72 }}>
                <span
                  title={s.tooltip}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: dotFill,
                    boxShadow: ring,
                    border: s.done ? "none" : "2px solid var(--border-strong)",
                  }}
                />
                <span
                  title={s.tooltip}
                  style={{
                    fontSize: "0.68rem",
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? "var(--text)" : "var(--muted)",
                    textAlign: "center",
                    lineHeight: 1.25,
                    maxWidth: 100,
                  }}
                >
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  aria-hidden
                  style={{
                    flex: 1,
                    height: 2,
                    minWidth: 12,
                    margin: "0 4px 18px",
                    borderRadius: 1,
                    background: steps[i].done ? "rgba(8,145,178,0.35)" : "var(--progress-track)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
