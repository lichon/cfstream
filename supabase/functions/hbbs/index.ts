// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import * as rendezvous from './rendezvous.ts'

console.log('Start hbbs server!')

interface OnlineSocket {
  id: string
  uuid: string
  socket: WebSocket
}
// WebSocket ready state constant
const online_peers = new Map<string, OnlineSocket>()
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
    // OPEN state
    if (websocket.readyState == 1) {
      websocket.close()
    }
  } catch (error) {
    console.error('safeCloseWebSocket error', error)
  }
}
//
function sendRendezvous(data, socket) {
  if (!data) {
    return
  }
  if (!socket || socket.readyState != 1) {
    console.log('sendRendezvous socket not open')
    return
  }
  const type = Object.keys(data)[0]
  const msg = {
    union: {
      oneofKind: type,
      ...data
    }
  }
  console.log('Sending rendezvous message:', msg)
  socket.send(rendezvous.RendezvousMessage.toBinary(msg))
}
//
function handlePunchHoleRequest(req: PunchHoleRequest, socket) {
  const req_id = req?.id
  console.log(`Handling punch hole request id: ${req_id}`)
  const online_socket = online_peers.get(req_id)
  if (!online_socket) {
    sendRendezvous({
      punchHoleResponse: rendezvous.PunchHoleResponse.create({
        otherFailure: 'id not exist'
      })
    }, socket)
    return
  }
  // find id in cache, create uuid response
  sendRendezvous({
    relayResponse: rendezvous.RelayResponse.create({
      uuid: online_socket.uuid,
      version: '0'
    })
  }, socket)
}
//
function handleRelayRequest(req: RequestRelay, socket) {
  const req_id = req?.id
  console.log(`Handling relay request id: ${req_id}`)
  // Implement relay request here
}
//
function handleRegisterPeer(req: RegisterPeer, socket) {
  const peer_id = req?.id
  console.log(`Handling register peer id: ${peer_id} serial: ${req?.serial}`)
  if (!peer_id) {
    safeCloseWebSocket(socket)
    return
  }
  online_peers.set(peer_id, {
    id: peer_id,
    uuid: crypto.randomUUID(),
    socket: socket
  })
  sendRendezvous({
    registerPeerResponse: rendezvous.RegisterPeerResponse.create({
      requestPk: false
    })
  }, socket)
}
//
function handleOnlineRequest(req: OnlineRequest, socket) {
  const peer_id = req?.id
  console.log(`Handling online request id: ${peer_id} peers: ${req?.peers}`)
  if (!peer_id) {
    safeCloseWebSocket(socket)
    return
  }
  const states = new Uint8Array(req.peers.length)
  states.fill(0)
  sendRendezvous({
    onlineResponse: rendezvous.OnlineResponse.create({
      states
    })
  }, socket)
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
        const dataArray = new Uint8Array(e.data)
        const msg = rendezvous.RendezvousMessage.fromBinary(dataArray)
        console.log(`rendezvous received ${dataArray.byteLength}`, msg)
        switch (msg.union?.oneofKind) {
          case 'registerPeer':
            handleRegisterPeer(msg.union.registerPeer, socket)
            break
          case 'onlineRequest':
            handleOnlineRequest(msg.union.onlineRequest, socket)
            break
          case 'punchHoleRequest':
            handlePunchHoleRequest(msg.union.punchHoleRequest, socket)
            break
          case 'requestRelay':
            handleRelayRequest(msg.union.requestRelay, socket)
            break
          default:
            console.log('Received unknown message type')
        }
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
      console.log(`websocket cancel`, reason)
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
  const { socket, response } = Deno.upgradeWebSocket(req)
  getWebSocketReadableStream(socket)
  return response
})
//