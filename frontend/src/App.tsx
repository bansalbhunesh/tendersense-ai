import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { token } from "./api";
import ErrorBoundary from "./components/shell/ErrorBoundary";

const AuthPage = lazy(() => import("./pages/AuthPage"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const TenderWorkspace = lazy(() => import("./pages/TenderWorkspace"));
const ReviewPage = lazy(() => import("./pages/ReviewPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

function RouteFallback() {
  return (
    <div className="shell" style={{ paddingTop: "48px" }}>
      <p className="muted">Loading…</p>
    </div>
  );
}

function Private({ children }: { children: React.ReactNode }) {
  if (!token()) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<AuthPage />} />
          <Route
            path="/app"
            element={
              <Private>
                <Dashboard />
              </Private>
            }
          />
          <Route
            path="/tender/:id"
            element={
              <Private>
                <TenderWorkspace />
              </Private>
            }
          />
          <Route
            path="/review"
            element={
              <Private>
                <ReviewPage />
              </Private>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
