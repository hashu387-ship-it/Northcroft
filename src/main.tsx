import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth";
import { ConfirmProvider, ToastProvider } from "@/components/ui";
import { startScrollHints } from "@/lib/scrollHints";
import App from "./App";
import { applyAppearance, migrateAppearance } from "@/lib/appearance";
import { startChrome } from "@/lib/chrome";
import "./styles/core.css";
import "./styles/index.css";
import "./styles/polish.css";
import "./styles/feel.css";
import "./styles/motion.css";

// Appearance (Settings > Appearance) is per device: Automatic, Light or Dark, how see-through the
// glass is, text size and list density. The new Apple-standard design replaced the eight older
// looks; every device moves to Automatic once (migrateAppearance).
try {
  migrateAppearance();
} catch {
  /* storage can be blocked */
}
applyAppearance();

startScrollHints();
startChrome();

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
