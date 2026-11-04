import "./lib/install";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./app.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MantineProvider, useComputedColorScheme } from "@mantine/core";
import { theme } from "./theme";
import { Notifications } from "@mantine/notifications";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { App } from "./App";
import { AuthProvider } from "./auth";
import { ConfirmProvider } from "./lib/confirm";
import { I18nProvider } from "./lib/i18n";
import { ApiError, errorText, serverDownStore } from "./api";
import { ServiceGate } from "./components/ServiceNotices";
import { notifications } from "@mantine/notifications";

// Błąd wczytywania: jedno czytelne powiadomienie (co się stało, czyja to wina, co zrobić), bez dublowania.
const queryClient = new QueryClient({
  // domyślna obsługa błędu zapisu: czerwone powiadomienie, chyba że mutacja ma własną obsługę
  mutationCache: new MutationCache({
    onError: (error, _v, _c, mutation) => {
      if (mutation.options.onError) return;
      if (error instanceof ApiError && error.status === 401) return;
      if (serverDownStore.get()) return;
      notifications.show({ color: "red", title: "Nie udało się zapisać", message: errorText(error) });
    },
  }),
  queryCache: new QueryCache({
    onError: (error) => {
      // przy niedostępnym serwerze zamiast powiadomień jest ekran przerwy technicznej
      if (serverDownStore.get()) return;
      if (!(error instanceof ApiError) || error.status === 401 || (error.status >= 400 && error.status < 500 && error.status !== 0)) return;
      notifications.show({
        id: "query-error",
        color: "red",
        title: error.status === 0 ? "Brak połączenia z serwerem" : "Nie udało się wczytać danych",
        message:
          error.status === 0
            ? "Problem jest po stronie sieci. Nic nie zostało zmienione – sprawdź internet i odśwież stronę."
            : "To błąd po stronie serwera, nie Twój. Spróbuj za chwilę; jeśli się powtarza, zgłoś to administratorowi.",
      });
    },
  }),
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status < 500 && error.status !== 0) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

/** Kolor paska przeglądarki (Safari, Chrome na Androidzie) = tło strony, także po ręcznej zmianie motywu. */
function ThemeColor() {
  const scheme = useComputedColorScheme("light", { getInitialValueInEffect: false });
  React.useEffect(() => {
    const color = scheme === "dark" ? "#1E1A17" : "#F5F4F2";
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.setAttribute("content", color);
      m.removeAttribute("media");
    });
  }, [scheme]);
  return null;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <ThemeColor />
      <Notifications position="bottom-center" autoClose={3000} />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <I18nProvider>
              <ConfirmProvider>
                <ServiceGate>
                  <App />
                </ServiceGate>
              </ConfirmProvider>
            </I18nProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  </React.StrictMode>,
);

// Instalacja na telefonie (PWA): service worker nic nie buforuje, służy tylko do instalacji.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
