// Retired. The status report, catch-up, make-a-task and announcement write-up features were
// removed from the app. This stub stays deployed so any old copy of the app that still calls it
// gets a clear answer instead of an error page. It does nothing and calls no outside service.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  return new Response(JSON.stringify({ error: "This feature is no longer available. Refresh the app.", code: "removed" }), {
    status: 410,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
