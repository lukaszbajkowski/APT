import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Center, Loader } from "@mantine/core";

import { useAuth } from "./auth";
import { MFA_PATH, type Role } from "./api";
import { AppLayout } from "./components/AppLayout";
import { LoginPage } from "./pages/LoginPage";
import { ForgotPasswordPage, SetPasswordPage } from "./pages/PasswordResetPages";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { MfaPage } from "./pages/MfaPage";
import { EmployeesPage } from "./pages/EmployeesPage";
import { HomePage } from "./pages/HomePage";
import { InvitePage, MyAccountPage } from "./pages/AccountPages";

// Rzadziej używane strony ładują się dopiero przy wejściu (mniejszy pierwszy pakiet JS).
const AgencyReportPage = lazy(() => import("./pages/AgencyReportPage").then((m) => ({ default: m.AgencyReportPage })));
const EmployeeRequestsPage = lazy(() => import("./pages/EmployeeRequestsPage").then((m) => ({ default: m.EmployeeRequestsPage })));
const SignPage = lazy(() => import("./pages/SignPage").then((m) => ({ default: m.SignPage })));
const EmployeeFormPage = lazy(() => import("./pages/EmployeeFormPage").then((m) => ({ default: m.EmployeeFormPage })));
const EmployeeProfilePage = lazy(() => import("./pages/EmployeeProfilePage").then((m) => ({ default: m.EmployeeProfilePage })));
const DictionariesPage = lazy(() => import("./pages/DictionariesPage").then((m) => ({ default: m.DictionariesPage })));
const ImportPage = lazy(() => import("./pages/ImportPage").then((m) => ({ default: m.ImportPage })));
const TemplatesPage = lazy(() => import("./pages/TemplatesPage").then((m) => ({ default: m.TemplatesPage })));
const TemplateEditPage = lazy(() => import("./pages/TemplateEditPage").then((m) => ({ default: m.TemplateEditPage })));
const EmployeeAccountsPage = lazy(() => import("./pages/EmployeeAccountsPage").then((m) => ({ default: m.EmployeeAccountsPage })));
const UsersPage = lazy(() => import("./pages/UsersPage").then((m) => ({ default: m.UsersPage })));
const AuditPage = lazy(() => import("./pages/AuditPage").then((m) => ({ default: m.AuditPage })));
const RetentionPage = lazy(() => import("./pages/RetentionPage").then((m) => ({ default: m.RetentionPage })));
const ScannerPage = lazy(() => import("./pages/ScannerPage").then((m) => ({ default: m.ScannerPage })));
const ReportsPage = lazy(() => import("./pages/ReportsPage").then((m) => ({ default: m.ReportsPage })));
const QualityPage = lazy(() => import("./pages/QualityPage").then((m) => ({ default: m.QualityPage })));
const TrainingsPage = lazy(() => import("./pages/TrainingsPage").then((m) => ({ default: m.TrainingsPage })));
const TasksPage = lazy(() => import("./pages/TasksPage").then((m) => ({ default: m.TasksPage })));
const TrainingImportPage = lazy(() => import("./pages/TrainingImportPage").then((m) => ({ default: m.TrainingImportPage })));

function Home() {
  const { me } = useAuth();
  if (me?.user.role === "employee") return <Navigate to="/moje-konto" replace />;
  return <HomePage />;
}

function PageLoader() {
  return (
    <Center h="40vh">
      <Loader />
    </Center>
  );
}

function RequireAuth({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { me, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }
  if (!me || me.mfa_pending) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (me.user.must_change_password && location.pathname !== "/zmiana-hasla") {
    return <Navigate to="/zmiana-hasla" replace />;
  }
  if (!me.user.must_change_password && me.mfa_setup_required && location.pathname !== MFA_PATH) {
    return <Navigate to={MFA_PATH} replace />;
  }
  if (me.user.role === "employee" && location.pathname !== "/moje-konto") {
    return <Navigate to="/moje-konto" replace />;
  }
  if (roles && !roles.includes(me.user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<PageLoader />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-hasla" element={<ForgotPasswordPage />} />
      <Route path="/ustaw-haslo" element={<SetPasswordPage />} />
      <Route path="/podpis/:token" element={<SignPage />} />
      <Route path="/zaproszenie" element={<InvitePage />} />
      <Route
        path="/zmiana-hasla"
        element={
          <RequireAuth>
            <ChangePasswordPage />
          </RequireAuth>
        }
      />
      <Route
        path={MFA_PATH}
        element={
          <RequireAuth>
            <MfaPage />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="moje-konto" element={<MyAccountPage />} />
        <Route path="pracownicy" element={<EmployeesPage />} />
        <Route
          path="pracownicy/nowy"
          element={
            <RequireAuth roles={["admin", "hr"]}>
              <EmployeeFormPage />
            </RequireAuth>
          }
        />
        <Route path="pracownicy/:id" element={<EmployeeProfilePage />} />
        <Route
          path="zgloszenia"
          element={
            <RequireAuth roles={["admin", "hr", "agency"]}>
              <EmployeeRequestsPage />
            </RequireAuth>
          }
        />
        <Route
          path="zestawienia"
          element={
            <RequireAuth roles={["admin", "hr", "agency"]}>
              <AgencyReportPage />
            </RequireAuth>
          }
        />
        <Route
          path="konta-pracownikow"
          element={
            <RequireAuth roles={["admin", "hr"]}>
              <EmployeeAccountsPage />
            </RequireAuth>
          }
        />
        <Route path="skaner" element={<ScannerPage />} />
        <Route
          path="raporty"
          element={
            <RequireAuth roles={["admin", "hr", "manager"]}>
              <ReportsPage />
            </RequireAuth>
          }
        />
        <Route
          path="pracownicy/:id/edycja"
          element={
            <RequireAuth roles={["admin", "hr", "manager"]}>
              <EmployeeFormPage />
            </RequireAuth>
          }
        />
        <Route path="import" element={<Navigate to="/pracownicy/import" replace />} />
        <Route
          path="pracownicy/import"
          element={
            <RequireAuth roles={["admin", "hr"]}>
              <ImportPage />
            </RequireAuth>
          }
        />
        <Route
          path="szablony"
          element={
            <RequireAuth roles={["admin"]}>
              <TemplatesPage />
            </RequireAuth>
          }
        />
        <Route
          path="szablony/:id"
          element={
            <RequireAuth roles={["admin"]}>
              <TemplateEditPage />
            </RequireAuth>
          }
        />
        <Route
          path="slowniki"
          element={
            <RequireAuth roles={["admin", "hr"]}>
              <DictionariesPage />
            </RequireAuth>
          }
        />
        <Route
          path="uzytkownicy"
          element={
            <RequireAuth roles={["admin"]}>
              <UsersPage />
            </RequireAuth>
          }
        />
        <Route
          path="uzytkownicy/wylaczeni"
          element={
            <RequireAuth roles={["admin"]}>
              <UsersPage />
            </RequireAuth>
          }
        />
        <Route
          path="zadania"
          element={
            <RequireAuth roles={["admin", "hr", "manager"]}>
              <TasksPage />
            </RequireAuth>
          }
        />
        <Route
          path="szkolenia/import"
          element={
            <RequireAuth roles={["admin", "hr"]}>
              <TrainingImportPage />
            </RequireAuth>
          }
        />
        <Route
          path="szkolenia"
          element={
            <RequireAuth roles={["admin", "hr", "manager"]}>
              <TrainingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="braki"
          element={
            <RequireAuth roles={["admin", "hr", "manager"]}>
              <QualityPage />
            </RequireAuth>
          }
        />
        <Route
          path="retencja"
          element={
            <RequireAuth roles={["admin"]}>
              <RetentionPage />
            </RequireAuth>
          }
        />
        <Route
          path="dziennik"
          element={
            <RequireAuth roles={["admin"]}>
              <AuditPage />
            </RequireAuth>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
