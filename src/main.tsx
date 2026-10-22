import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth";
import { ConfirmProvider, ToastProvider } from "@/components/ui";
import App from "./App";
import "./styles/index.css";
import "./styles/polish.css";

// Appearance preferences are per device.
try {
  const theme = localStorage.getItem("nc-theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  if (localStorage.getItem("nc-solid") === "true") document.documentElement.dataset.solid = "true";
} catch {
  /* storage can be blocked; defaults still work */
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
