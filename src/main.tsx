import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth";
import { ConfirmProvider, ToastProvider } from "@/components/ui";
import { startScrollHints } from "@/lib/scrollHints";
import App from "./App";
import "./styles/index.css";
import "./styles/polish.css";
import "./styles/liquid.css";
import "./styles/brandfont.css";
import "./styles/menu.css";
import "./styles/purple.css";
import "./styles/feel.css";
import "./styles/clay.css";
import "./styles/qs.css";
import "./styles/onyx.css";

// Appearance preferences are per device. Onyx (the design system's look: the black of the logo
// artwork, grain, a red glow, smoked glass, serif headings, raised buttons) is the default; QS
// Team glass, Light, Dark, Purple glass, Clay glass or Automatic (follow the phone) only when
// someone chooses it in Settings > Appearance. Onyx, QS Team glass and Purple glass are the dark
// theme with a palette on top (data-palette="onyx" / "qs" / "purple"); Clay glass is the light
// theme with soft clay on top (data-palette="clay").
// When Onyx came in (Nov 2026) every device switched to it once ("nc-look-onyx"); after that,
// whatever someone picks in Settings stays.
// Glass is the default for everyone. Solid surfaces only come on when switched on again in
// Settings > Appearance; the old setting ("nc-solid") is cleared so every phone starts on glass.
try {
  if (!localStorage.getItem("nc-look-onyx")) {
    localStorage.setItem("nc-theme", "onyx");
    localStorage.setItem("nc-look-onyx", "1");
  }
  const theme = localStorage.getItem("nc-theme") || "onyx";
  if (theme === "dark" || theme === "purple" || theme === "qs" || theme === "onyx") document.documentElement.dataset.theme = "dark";
  else if (theme !== "system") document.documentElement.dataset.theme = "light";
  if (theme === "purple" || theme === "clay" || theme === "qs" || theme === "onyx") document.documentElement.dataset.palette = theme;
  localStorage.removeItem("nc-solid");
  if (localStorage.getItem("nc-solid-v2") === "true") document.documentElement.dataset.solid = "true";
} catch {
  /* storage can be blocked; the Onyx default still applies */
  document.documentElement.dataset.theme = "dark";
  document.documentElement.dataset.palette = "onyx";
}

startScrollHints();

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
