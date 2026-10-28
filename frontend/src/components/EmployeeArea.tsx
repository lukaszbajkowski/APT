import { useEffect } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Center, Loader, Stack, Text } from "@mantine/core";
import { IconUserExclamation } from "@tabler/icons-react";

import { api, setAccountId } from "../api";
import { useAuth, type Account } from "../auth";

/**
 * Strony tylko dla konta pracownika. Gdy link (np. z e-maila o dokumencie do podpisu) ma `?u=<konto>`,
 * a w tej karcie jest aktywne inne konto (np. administratora), przełączamy się na wskazane konto, jeśli
 * jest zalogowane w tej przeglądarce; jeśli nie – prosimy o zalogowanie pracownika zamiast pustej strony.
 */
export function EmployeeArea() {
  const { me } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const wanted = Number(new URLSearchParams(location.search).get("u")) || null;
  const wrong = !!me && me.user.role !== "employee";
  const switchNeeded = !!me && wanted !== null && wanted !== me.user.id;
  const accounts = useQuery({
    queryKey: ["browser-accounts"],
    queryFn: () => api<Account[]>("/auth/accounts"),
    enabled: switchNeeded || wrong,
    staleTime: 0,
  });
  const target = switchNeeded ? accounts.data?.find((a) => a.id === wanted) : undefined;

  useEffect(() => {
    if (target) {
      setAccountId(target.id);
      window.location.replace(location.pathname + location.search);
    }
  }, [target, location.pathname, location.search]);

  if (!wrong && !switchNeeded) return <Outlet />;
  if (accounts.isLoading || target) {
    return (
      <Center h="50vh">
        <Loader />
      </Center>
    );
  }
  if (!wrong) return <Outlet />; // inne konto pracownika niż w linku – serwer i tak nie pokaże cudzych danych
  if (wanted === null) return <Navigate to="/" replace />;
  return (
    <Stack maw={520} mt="xl" mx="auto" px="md">
      <Alert color="orange" icon={<IconUserExclamation size={18} />} title="To strona dla konta pracownika">
        Jesteś zalogowany(-a) jako {me?.user.full_name}. Ten link dotyczy konta pracownika, które nie jest zalogowane w tej
        przeglądarce.
      </Alert>
      <Text size="sm" c="dimmed">
        Zaloguj się na konto pracownika (kluczem dostępu) – wrócisz od razu do tego dokumentu. Twoje obecne konto pozostanie
        zalogowane.
      </Text>
      <Button onClick={() => navigate("/login?dodaj=1", { state: { from: location.pathname + location.search } })}>
        Zaloguj się jako pracownik
      </Button>
      <Button variant="default" onClick={() => navigate("/", { replace: true })}>
        Wróć do mojego konta
      </Button>
    </Stack>
  );
}
