import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Center, Loader } from "@mantine/core";

import { useAuth } from "./auth";
import type { Role } from "./api";
import { AppLayout } from "./components/AppLayout";
import { LoginPage } from "./pages/LoginPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { EmployeesPage } from "./pages/EmployeesPage";
import { EmployeeFormPage } from "./pages/EmployeeFormPage";
import { EmployeeProfilePage } from "./pages/EmployeeProfilePage";
import { DictionariesPage } from "./pages/DictionariesPage";
import { ImportPage } from "./pages/ImportPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { TemplateEditPage } from "./pages/TemplateEditPage";
import { UsersPage } from "./pages/UsersPage";
import { AuditPage } from "./pages/AuditPage";

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
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (me.user.must_change_password && location.pathname !== "/zmiana-hasla") {
    return <Navigate to="/zmiana-hasla" replace />;
  }
  if (roles && !roles.includes(me.user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/zmiana-hasla"
        element={
          <RequireAuth>
            <ChangePasswordPage />
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
        <Route index element={<Navigate to="/pracownicy" replace />} />
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
          path="pracownicy/:id/edycja"
          element={
            <RequireAuth roles={["admin", "hr", "manager"]}>
              <EmployeeFormPage />
            </RequireAuth>
          }
        />
        <Route
          path="import"
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
  );
}
