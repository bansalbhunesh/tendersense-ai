import { Component, type ErrorInfo, type ReactNode } from "react";
import i18n from "../i18n";

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error boundary:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const t = i18n.t.bind(i18n);
      return (
        <div className="shell" style={{ padding: 24 }}>
          <div className="panel">
            <h2>{t("errors.boundaryTitle")}</h2>
            <p className="muted" style={{ marginTop: 8 }}>
              {this.state.error.message}
            </p>
            <button
              type="button"
              className="primary"
              style={{ marginTop: 16 }}
              onClick={() => window.location.assign("/")}
            >
              {t("errors.boundaryBack")}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
