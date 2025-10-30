// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

console.log("Start hbbs server!")

Deno.serve(async (req) => {
  const upgrade = req.headers.get("upgrade") || ""
  if (upgrade.toLowerCase() != "websocket") {
    return new Response("Bad Request", {
      status: 400
    })
  }
  const { websocket, response } = Deno.upgradeWebSocket(req)
  const room = Deno.env.get('HBBS_ROOM_ID') || 'default_room'
  websocket.onopen = () => {
    console.log(`WebSocket connection established for room: ${room}`)
  }
  websocket.onmessage = (event) => {
    console.log(`Received message in room ${room}: ${event.data}`)
    // Echo the message back to the client
    websocket.send(`Echo from room ${room}: ${event.data}`)
  }
  websocket.onclose = () => {
    console.log(`WebSocket connection closed for room: ${room}`)
  }
  websocket.onerror = (err) => {
    console.error(`WebSocket error in room ${room}:`, err)
  }

  return response
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/hbbs' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
