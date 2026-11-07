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

// Appearance preferences are per device. Onyx (the design system's look: soft charcoal clay, the
// Northcroft world with grain, a red glow and the skyline, serif headings, puffy clay buttons and
// thick clay rows in every table) is the default; Pearl (the same clay in warm light grey), QS
// Team glass, Light, Dark, Purple glass, Clay glass or Automatic (follow the phone) only when
// someone chooses it in Settings > Appearance. Onyx, QS Team glass and Purple glass are the dark
// theme with a palette on top (data-palette="onyx" / "qs" / "purple"); Pearl and Clay glass are
// the light theme with a palette on top (data-palette="pearl" / "clay").
// Dusk (the same clay in a twilight palette: Black Rock, Blue Suede Shoes and Daemonette Hide with
// solid Succulent Lime, Wondrous Wisteria and Persian Orange highlight cards) is now the default.
// When Onyx came in (Nov 2026) every device switched to it once ("nc-look-onyx"), and again to Dusk
// when it came in ("nc-look-dusk"); after that, whatever someone picks in Settings stays.
// Glass is the default for everyone. Solid surfaces only come on when switched on again in
// Settings > Appearance; the old setting ("nc-solid") is cleared so every phone starts on glass.
try {
  if (!localStorage.getItem("nc-look-dusk")) {
    localStorage.setItem("nc-theme", "dusk");
    localStorage.setItem("nc-look-dusk", "1");
    localStorage.setItem("nc-look-onyx", "1");
  }
  const theme = localStorage.getItem("nc-theme") || "dusk";
  if (theme === "dark" || theme === "purple" || theme === "qs" || theme === "onyx" || theme === "dusk") document.documentElement.dataset.theme = "dark";
  else if (theme !== "system") document.documentElement.dataset.theme = "light";
  if (theme === "purple" || theme === "clay" || theme === "qs" || theme === "onyx" || theme === "pearl" || theme === "dusk") document.documentElement.dataset.palette = theme;
  localStorage.removeItem("nc-solid");
  if (localStorage.getItem("nc-solid-v2") === "true") document.documentElement.dataset.solid = "true";
} catch {
  /* storage can be blocked; the Dusk default still applies */
  document.documentElement.dataset.theme = "dark";
  document.documentElement.dataset.palette = "dusk";
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
