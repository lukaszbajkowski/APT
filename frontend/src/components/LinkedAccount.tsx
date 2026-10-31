import { useEffect, type ReactNode } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Center, Stack, Text } from "@mantine/core";
import { IconUserExclamation } from "@tabler/icons-react";

import { api, setAccountId } from "../api";
import { useAuth, type Account } from "../auth";
import { useT } from "../lib/i18n";
import { Loading } from "./States";

/**
 * Linki z e-maili i SMS-ów mają `?u=<konto adresata>`. Gdy w tej karcie jest aktywne inne konto
 * (każdy ma osobne konta: pracownika i funkcyjne), przełączamy się na wskazane konto, jeśli jest zalogowane
 * w tej przeglądarce; jeśli nie – prosimy o zalogowanie zamiast pokazywać pustą lub cudzą stronę.
 */
export function LinkedAccount({ children }: { children: ReactNode }) {
  const t = useT();
  const { me } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const wanted = Number(new URLSearchParams(location.search).get("u")) || null;
  const mismatch = !!me && wanted !== null && wanted !== me.user.id;
  const accounts = useQuery({
    queryKey: ["browser-accounts"],
    queryFn: () => api<Account[]>("/auth/accounts"),
    enabled: mismatch,
    staleTime: 0,
  });
  const target = mismatch ? accounts.data?.find((a) => a.id === wanted) : undefined;

  useEffect(() => {
    if (target) {
      setAccountId(target.id);
      window.location.replace(location.pathname + location.search);
    }
  }, [target, location.pathname, location.search]);

  if (!mismatch) return <>{children}</>;
  if (accounts.isLoading || target) {
    return (
      <Center h="50vh">
        <Loading />
      </Center>
    );
  }
  if (accounts.isError) return <>{children}</>;
  return (
    <Stack maw={520} mt="xl" mx="auto" px="md">
      <Alert color="orange" icon={<IconUserExclamation size={18} />} title={t("Ten link dotyczy innego konta")}>
        {t("Jesteś zalogowany(-a) jako {name}, a link przygotowano dla innego konta, które nie jest zalogowane w tej przeglądarce.", { name: me?.user.full_name })}
      </Alert>
      <Text size="sm" c="dimmed">
        {t("Zaloguj się na to konto – wrócisz od razu na tę stronę. Obecne konto pozostanie zalogowane.")}
      </Text>
      <Button onClick={() => navigate("/login?dodaj=1", { state: { from: location.pathname + location.search } })}>
        {t("Zaloguj się na właściwe konto")}
      </Button>
      <Button variant="default" onClick={() => navigate("/", { replace: true })}>
        {t("Wróć do mojego konta")}
      </Button>
    </Stack>
  );
}

/** Strony tylko dla konta pracownika: inne role wracają na stronę główną. */
export function EmployeeArea() {
  const { me } = useAuth();
  if (me && me.user.role !== "employee") return <Navigate to="/" replace />;
  return <Outlet />;
}
