import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth";
import { ConfirmProvider, ToastProvider } from "@/components/ui";
import App from "./App";
import "./styles/index.css";
import "./styles/polish.css";
import "./styles/liquid.css";
import "./styles/brandfont.css";
import "./styles/menu.css";
import "./styles/purple.css";
import "./styles/feel.css";

// Appearance preferences are per device. Light is the default; Dark, Purple glass or Automatic
// (follow the phone) only when someone chooses it in Settings > Appearance. Purple glass is the
// dark theme with a purple palette on top (data-palette="purple").
// Glass is the default for everyone. Solid surfaces only come on when switched on again in
// Settings > Appearance; the old setting ("nc-solid") is cleared so every phone starts on glass.
try {
  const theme = localStorage.getItem("nc-theme");
  if (theme === "dark" || theme === "purple") document.documentElement.dataset.theme = "dark";
  else if (theme !== "system") document.documentElement.dataset.theme = "light";
  if (theme === "purple") document.documentElement.dataset.palette = "purple";
  localStorage.removeItem("nc-solid");
  if (localStorage.getItem("nc-solid-v2") === "true") document.documentElement.dataset.solid = "true";
} catch {
  /* storage can be blocked; the light default still applies */
  document.documentElement.dataset.theme = "light";
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
