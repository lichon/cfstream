// node_modules/uuid/dist/esm-browser/regex.js
const regex_default = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;
// node_modules/uuid/dist/esm-browser/validate.js
function validate(uuid) {
  return typeof uuid === "string" && regex_default.test(uuid);
}
const validate_default = validate;
// node_modules/uuid/dist/esm-browser/stringify.js
const byteToHex = [];
for(let i = 0; i < 256; ++i){
  byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}
function stringify(arr, offset = 0) {
  const uuid = unsafeStringify(arr, offset);
  if (!validate_default(uuid)) {
    throw TypeError("Stringified UUID is invalid " + uuid);
  }
  return uuid;
}
const stringify_default = stringify;
const log = console.log;
//
function base64ToArrayBuffer(base64Str) {
  if (!base64Str) {
    return {
      error: null
    };
  }
  try {
    base64Str = base64Str.replace(/-/g, "+").replace(/_/g, "/");
    const decode = atob(base64Str);
    const arryBuffer = Uint8Array.from(decode, (c)=>c.charCodeAt(0));
    return {
      earlyData: arryBuffer.buffer,
      error: null
    };
  } catch (error) {
    return {
      error
    };
  }
}
//
function safeCloseWebSocket(websocket) {
  try {
    if (websocket.readyState === WS_READY_STATE_OPEN) {
      websocket.close();
    }
  } catch (error) {
    console.error("safeCloseWebSocket error", error);
  }
}
//
function processVHeader(vlessBuffer, userID) {
  if (vlessBuffer.byteLength < 24) {
    return {
      hasError: true,
      message: "invalid data"
    };
  }
  const v = new Uint8Array(vlessBuffer.slice(0, 1))[0];
  let isValidUser = false;
  let isUDP = false;
  if (stringify_default(new Uint8Array(vlessBuffer.slice(1, 17))) === userID) {
    isValidUser = true;
  }
  if (!isValidUser) {
    return {
      hasError: true,
      message: "invalid user"
    };
  }
  const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0];
  const command = new Uint8Array(vlessBuffer.slice(18 + optLength, 18 + optLength + 1))[0];
  if (command === 1) {
  // tcp
  } else if (command === 2) {
    isUDP = true;
  } else {
    return {
      hasError: true,
      message: `command ${command} is not support, command 01-tcp,02-udp,03-mux`
    };
  }
  const portIndex = 18 + optLength + 1;
  const portBuffer = vlessBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getInt16(0);
  const addressIndex = portIndex + 2;
  const addressBuffer = new Uint8Array(vlessBuffer.slice(addressIndex, addressIndex + 1));
  const addressType = addressBuffer[0];
  let addressLength = 0;
  let addressValueIndex = addressIndex + 1;
  let addressValue = "";
  switch(addressType){
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 2:
      addressLength = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 3:
      {
        addressLength = 16;
        const dataView = new DataView(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
        const ipv6 = [];
        for(let i = 0; i < 8; i++){
          ipv6.push(dataView.getUint16(i * 2).toString(16));
        }
        addressValue = ipv6.join(":");
        break;
      }
    default:
      break;
  }
  if (!addressValue) {
    return {
      hasError: true,
      message: `addressValue is empty, addressType is ${addressType}`
    };
  }
  return {
    hasError: false,
    addressRemote: addressValue,
    portRemote,
    rawDataIndex: addressValueIndex + addressLength,
    vsVersion: v,
    isUDP
  };
}
//
const WS_READY_STATE_OPEN = 1;
function getWebSocketReadableStream(wsServer, earlyDataHeader) {
  let streamCancelled = false;
  return new ReadableStream({
    start (controller) {
      wsServer.addEventListener("message", async (e)=>{
        if (streamCancelled) {
          return;
        }
        controller.enqueue(e.data);
      });
      wsServer.addEventListener("error", (e)=>{
        log("websocket error");
        streamCancelled = true;
        controller.error(e);
      });
      wsServer.addEventListener("close", ()=>{
        log("webSocket is closed");
        try {
          if (!streamCancelled) {
            controller.close();
          }
        } catch (err) {
          log(`websocketStream close error `, err);
        }
      });
      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) {
        log(`earlyDataHeader has invaild base64`);
        safeCloseWebSocket(wsServer);
        return;
      }
      if (earlyData) {
        controller.enqueue(earlyData);
      }
    },
    cancel (reason) {
      log(`websocketStream is cancel DUE to `, reason);
      if (streamCancelled) {
        return;
      }
      streamCancelled = true;
      safeCloseWebSocket(wsServer);
    }
  });
}
//
async function handleConnectRequest(remoteSocketWriter, address, port, rawClientData, webSocket, vsResponseHeader) {
  let responseHeader = vsResponseHeader;
  // if is ipv4, use www.{ipv4}.sslip.io
  if (/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?).){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(address)) {
    address = `${atob('d3d3Lg==')}${address}${atob('LnNzbGlwLmlv')}`;
  }
  const tcpSocket = await Deno.connect({
    hostname: address,
    port: port
  });
  const writer = tcpSocket.writable.getWriter();
  remoteSocketWriter.value = writer;
  tcpSocket.setKeepAlive(true);
  log(`connected to ${address}:${port} ${rawClientData?.byteLength}`);
  writer.write(new Uint8Array(rawClientData));
  await tcpSocket.readable.pipeTo(new WritableStream({
    async write (chunk, _controller) {
      if (responseHeader) {
        webSocket.send(await new Blob([
          responseHeader,
          chunk
        ]).arrayBuffer());
        responseHeader = null;
      } else {
        webSocket.send(chunk);
      }
    }
  })).catch((e)=>{
    console.error(`pipe error`, e);
    safeCloseWebSocket(webSocket);
  });
}
//
Deno.serve((req)=>{
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() != "websocket") {
    return new Response("BadRequest", {
      status: 400
    });
  }
  const { socket, response } = Deno.upgradeWebSocket(req);
  const userID = Deno.env.get('UUID');
  validate_default(userID);
  const wsEarlyDataHeader = req.headers.get("sec-websocket-protocol") || "";
  const remoteSocketWriterWrapper = {
    value: null
  };
  const wsReadable = getWebSocketReadableStream(socket, wsEarlyDataHeader);
  wsReadable.pipeTo(new WritableStream({
    async write (chunk, controller) {
      const remoteSocketWriter = remoteSocketWriterWrapper.value;
      if (remoteSocketWriter) {
        await remoteSocketWriter.write(new Uint8Array(chunk));
        return;
      }
      const { hasError, message, portRemote, addressRemote, rawDataIndex, vsVersion, isUDP } = processVHeader(chunk, userID);
      if (isUDP && portRemote != 53) {
        controller.error("UDP only for DNS port 53");
        safeCloseWebSocket(socket);
        return;
      }
      if (hasError) {
        controller.error(message);
        safeCloseWebSocket(socket);
        return;
      }
      const vsResponse = new Uint8Array([
        vsVersion,
        0
      ]);
      const rawClientData = chunk.slice(rawDataIndex);
      handleConnectRequest(remoteSocketWriterWrapper, addressRemote, portRemote, rawClientData, socket, vsResponse);
    }
  }));
  return response;
});
