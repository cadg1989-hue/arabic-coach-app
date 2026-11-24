// Retired: version 0.1's AI endpoint. The app now uses the "sample" function. Kept as a stub that refuses every request.
Deno.serve(() => new Response(JSON.stringify({ code: "gone", error: "This endpoint has been retired." }), { status: 410, headers: { "Content-Type": "application/json" } }));
