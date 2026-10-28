import "./lib/install";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./app.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MantineProvider, createTheme, type MantineColorsTuple } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { App } from "./App";
import { AuthProvider } from "./auth";
import { ApiError } from "./api";

// Granat – ten sam kolor co pasek na karcie identyfikacyjnej.
const navy: MantineColorsTuple = [
  "#eef2fa",
  "#dbe2f0",
  "#b3c2e2",
  "#89a0d4",
  "#6683c8",
  "#5071c1",
  "#4467bf",
  "#3657a8",
  "#2d4d97",
  "#1f3a73",
];

const theme = createTheme({
  primaryColor: "navy",
  primaryShade: { light: 7, dark: 5 },
  colors: { navy },
  defaultRadius: "md",
  fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="bottom-right" />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
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
