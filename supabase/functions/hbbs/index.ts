// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

console.log('Start hbbs server!')
//
function safeCloseController(controller) {
  try {
    controller.close()
  } catch (error) {
    console.error('safeCloseController error', error)
  }
}
//
function safeCloseWebSocket(websocket) {
  try {
    if (websocket.readyState === WS_READY_STATE_OPEN) {
      websocket.close()
    }
  } catch (error) {
    console.error('safeCloseWebSocket error', error)
  }
}
//
function getWebSocketReadableStream(socket) {
  let streamCancelled = false
  return new ReadableStream({
    start(controller) {
      socket.addEventListener('message', async (e) => {
        if (streamCancelled) {
          return
        }
        console.log(`message received ${e.data.byteLength} bytes`)
        controller.enqueue(e.data)
      })
      socket.addEventListener('error', (e) => {
        console.log('websocket error')
        streamCancelled = true
        controller.error(e)
      })
      socket.addEventListener('close', () => {
        console.log('webSocket closed')
        if (!streamCancelled) {
          safeCloseController(controller)
        }
      })
    },
    cancel(reason) {
      console.log(`websocket stream is cancel DUE to `, reason)
      if (!streamCancelled) {
        streamCancelled = true
        safeCloseWebSocket(socket)
      }
    }
  })
}
//
Deno.serve(async (req) => {
  const upgrade = req.headers.get('upgrade') || ''
  if (upgrade.toLowerCase() != 'websocket') {
    return new Response('Bad Request', {
      status: 400
    })
  }
  const room = Deno.env.get('HBBS_ROOM_ID') || 'default_room'
  console.log(`Joining room: ${room}`)
  const { socket, response } = Deno.upgradeWebSocket(req)
  getWebSocketReadableStream(socket)
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
