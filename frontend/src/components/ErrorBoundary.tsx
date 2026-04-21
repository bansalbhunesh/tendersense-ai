import { Component, type ErrorInfo, type ReactNode } from "react";

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
      return (
        <div className="shell" style={{ padding: 24 }}>
          <div className="panel">
            <h2>Something went wrong</h2>
            <p className="muted" style={{ marginTop: 8 }}>
              {this.state.error.message}
            </p>
            <button
              type="button"
              className="primary"
              style={{ marginTop: 16 }}
              onClick={() => window.location.assign("/")}
            >
              Back to sign in
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
