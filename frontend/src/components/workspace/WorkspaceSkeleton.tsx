export default function WorkspaceSkeleton() {
  const bar = (w: string) => (
    <div className="skeleton" style={{ height: 14, width: w, borderRadius: 8, marginBottom: 10 }} />
  );
  return (
    <div data-testid="workspace-skeleton" aria-busy="true" aria-live="polite">
      <div className="panel" style={{ marginBottom: 16 }}>
        {bar("55%")}
        {bar("100%")}
        {bar("88%")}
        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <div className="skeleton" style={{ height: 40, flex: 1, borderRadius: 10 }} />
          <div className="skeleton" style={{ height: 40, width: 120, borderRadius: 10 }} />
        </div>
      </div>
      <div className="grid2">
        <div className="panel">
          {bar("40%")}
          {bar("100%")}
          {bar("70%")}
        </div>
        <div className="panel">
          {bar("35%")}
          <div className="skeleton" style={{ height: 120, borderRadius: 12, marginTop: 12 }} />
        </div>
      </div>
    </div>
  );
}
