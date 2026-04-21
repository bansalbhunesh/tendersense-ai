import { Navigate, Route, Routes } from "react-router-dom";
import { token } from "./api";
import ErrorBoundary from "./components/ErrorBoundary";
import AuthPage from "./pages/AuthPage";
import Dashboard from "./pages/Dashboard";
import TenderWorkspace from "./pages/TenderWorkspace";
import ReviewPage from "./pages/ReviewPage";

function Private({ children }: { children: React.ReactNode }) {
  if (!token()) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </ErrorBoundary>
  );
}
