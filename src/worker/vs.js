import { connect } from "cloudflare:sockets";

// @ts-nocheck
// node_modules/uuid/dist/esm-browser/regex.js
var regex_default = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;

// node_modules/uuid/dist/esm-browser/validate.js
function validate(uuid) {
    return typeof uuid === "string" && regex_default.test(uuid);
}
var validate_default = validate;

// node_modules/uuid/dist/esm-browser/stringify.js
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
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
const log = console.log

// libs/vless-js/src/lib/vless-js.ts
const WS_READY_STATE_OPEN = 1;
function getWebSocketReadableStream(wsServer, earlyDataHeader) {
    let streamCancelled = false;
    return new ReadableStream({
        start(controller) {
            wsServer.addEventListener("message", async (e) => {
                if (streamCancelled) {
                    return;
                }
                controller.enqueue(e.data);
            });
            wsServer.addEventListener("error", (e) => {
                log("websocket error");
                streamCancelled = true;
                controller.error(e);
            });
            wsServer.addEventListener("close", () => {
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
        cancel(reason) {
            log(`websocketStream is cancel DUE to `, reason);
            if (streamCancelled) {
                return;
            }
            streamCancelled = true;
            safeCloseWebSocket(wsServer);
        }
    });
}

/**
 * Read from remote socket and write back to webSocket
 *
 * @param {any} remoteSocket
 * @param {any} webSocket
 * @param {ArrayBuffer} vsResponseHeader
 * @param {(() => Promise<void>) | null} retry
 */
async function remoteSocketToWS(remoteSocket, webSocket, vsResponseHeader, retry) {
    /** @type {ArrayBuffer | null} */
    let responseHeader = vsResponseHeader;
    let readTimeout;
    let readBytes = 0;
    await remoteSocket.readable.pipeTo(
        new WritableStream({
            async write(chunk, _controller) {
                readBytes += chunk.byteLength;
                if (readTimeout) {
                    clearTimeout(readTimeout)
                }
                readTimeout = setTimeout(()=> {                    
                    console.info(`read timeout, total bytes: ${readBytes}`);
                    remoteSocket.close();
                    safeCloseWebSocket(webSocket)
                }, 30000)
                if (responseHeader) {
                    webSocket.send(await new Blob([responseHeader, chunk]).arrayBuffer());
                    responseHeader = null;
                } else {
                    webSocket.send(chunk);
                }
            }
        })
    )
    .catch((e) => {
        console.error(`remoteSocketToWS error`, e);
        safeCloseWebSocket(webSocket);
    });

    // seems is cf connect socket have error,
    // 1. Socket.closed will be called
    // 2. Socket.readable will be close without any incoming data
    if (readBytes == 0 && retry) {
        retry();
    }
}

/**
 * Handles connection reqeust from ws, outbound TCP connections.
 *
 * @param {any} remoteSocketWriter
 * @param {string} addressRemote The remote address to connect to.
 * @param {number} portRemote The remote port to connect to.
 * @param {Uint8Array} rawClientData The raw client data to write.
 * @param {any} webSocket The WebSocket to pass the remote socket to.
 * @param {Uint8Array} cfResponseHeader The cloudflare response header.
 * @returns {Promise<void>} The remote socket.
 */
async function handleConnectRequest(
    remoteSocketWriter,
    addressRemote,
    portRemote,
    rawClientData,
    webSocket,
    cfResponseHeader
) {
    async function connectAndWrite(address, port) {
        // if is ipv4, use www.{ipv4}.sslip.io
        if (/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?).){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(address))
            address = `${atob('d3d3Lg==')}${address}${atob('LnNzbGlwLmlv')}`;
        const tcpSocket = connect({
            hostname: address,
            port: port,
        });
        log(`connected to ${address}:${port}`);

        const writer = tcpSocket.writable.getWriter();
        remoteSocketWriter.value = writer;
        await writer.write(rawClientData);
        return tcpSocket;
    }

    function convertToNAT64IPv6(ipv4Address) {
        const parts = ipv4Address.split('.');
        if (parts.length !== 4) {
            throw new Error('invalid ipv4 address');
        }

        const hex = parts.map(part => {
            const num = parseInt(part, 10);
            if (num < 0 || num > 255) {
                throw new Error('invalid ipv4 address segment');
            }
            return num.toString(16).padStart(2, '0');
        });
        const prefixes = ['2602:fc59:b0:64::']; //2001:67c:2960:6464::
        const chosenPrefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        return `[${chosenPrefix}${hex[0]}${hex[1]}:${hex[2]}${hex[3]}]`;
    }

    async function getIPv6ProxyAddress(domain) {
        try {
            const dnsQuery = await fetch(`https://1.1.1.1/dns-query?name=${domain}&type=A`, {
                headers: {
                    'Accept': 'application/dns-json'
                }
            });

            const dnsResult = await dnsQuery.json();
            if (dnsResult.Answer && dnsResult.Answer.length > 0) {
                const aRecord = dnsResult.Answer.find(record => record.type === 1);
                if (aRecord) {
                    const ipv4Address = aRecord.data;
                    return convertToNAT64IPv6(ipv4Address);
                }
            }
            throw new Error('failed to parse DNS response or no A record found');
        } catch (err) {
            throw new Error(`DNS resolution failed: ${err.message}`);
        }
    }

    // if the cf connect tcp socket have no incoming data, we retry to redirect ip
    async function retry() {
        const proxyIP = await getIPv6ProxyAddress(addressRemote);
        const tcpSocket = await connectAndWrite(proxyIP, portRemote);
        tcpSocket.closed
            .catch((error) => {
                log("tcpSocket closed error", error);
            })
            .finally(() => {
                safeCloseWebSocket(webSocket);
            });
        remoteSocketToWS(tcpSocket, webSocket, cfResponseHeader, null);
    }

    const tcpSocket = await connectAndWrite(addressRemote, portRemote);
    remoteSocketToWS(tcpSocket, webSocket, cfResponseHeader, retry);
}

function base64ToArrayBuffer(base64Str) {
    if (!base64Str) {
        return { error: null };
    }
    try {
        base64Str = base64Str.replace(/-/g, "+").replace(/_/g, "/");
        const decode = atob(base64Str);
        const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
        return { earlyData: arryBuffer.buffer, error: null };
    } catch (error) {
        return { error };
    }
}

function safeCloseWebSocket(websocket) {
    try {
        if (websocket.readyState === WS_READY_STATE_OPEN) {
            websocket.close();
        }
    } catch (error) {
        console.error("safeCloseWebSocket error", error);
    }
}

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
    const command = new Uint8Array(
        vlessBuffer.slice(18 + optLength, 18 + optLength + 1)
    )[0];
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
    let addressIndex = portIndex + 2;
    const addressBuffer = new Uint8Array(
        vlessBuffer.slice(addressIndex, addressIndex + 1)
    );
    const addressType = addressBuffer[0];
    let addressLength = 0;
    let addressValueIndex = addressIndex + 1;
    let addressValue = "";
    switch (addressType) {
        case 1:
            addressLength = 4;
            addressValue = new Uint8Array(
                vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
            ).join(".");
            break;
        case 2:
            addressLength = new Uint8Array(
                vlessBuffer.slice(addressValueIndex, addressValueIndex + 1)
            )[0];
            addressValueIndex += 1;
            addressValue = new TextDecoder().decode(
                vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
            );
            break;
        case 3:
            addressLength = 16;
            const dataView = new DataView(
                vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
            );
            const ipv6 = [];
            for (let i = 0; i < 8; i++) {
                ipv6.push(dataView.getUint16(i * 2).toString(16));
            }
            addressValue = ipv6.join(":");
            break;
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

var cf_worker_vless_default = {
    async fetch(request, env, ctx) {
        const userID = env.UUID || "000000000000000000000000000000000000";
        validate_default(userID);
        const upgradeHeader = request.headers.get("Upgrade");
        if (!upgradeHeader || upgradeHeader !== "websocket") {
            return new Response(
                "BadRequest",
                {
                    status: 400,
                    statusText: "Bad Request"
                }
            );
        }
        const [client, wsServer] = Object.values(new WebSocketPair());
        wsServer.accept();

        const wsEarlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
        const wsReadable = getWebSocketReadableStream(wsServer, wsEarlyDataHeader);
        const remoteSocketWriterWrapper = { value: null };
        wsReadable.pipeTo(
            new WritableStream({
                async write(chunk, controller) {
                    const remoteSocketWriter = remoteSocketWriterWrapper.value;
                    if (remoteSocketWriter) {
                        await remoteSocketWriter.write(chunk);
                        return;
                    }
                    const {
                        hasError,
                        message,
                        portRemote,
                        addressRemote,
                        rawDataIndex,
                        vsVersion,
                        isUDP
                    } = processVHeader(chunk, userID);
                    if (isUDP && portRemote != 53) {
                        controller.error("UDP only for DNS port 53");
                        safeCloseWebSocket(wsServer)
                        return;
                    }
                    if (hasError) {
                        controller.error(message);
                        safeCloseWebSocket(wsServer)
                        return;
                    }

                    const vsResponse = new Uint8Array([vsVersion, 0]);
                    const rawClientData = chunk.slice(rawDataIndex);
                    handleConnectRequest(
                        remoteSocketWriterWrapper,
                        addressRemote,
                        portRemote,
                        rawClientData,
                        wsServer,
                        vsResponse
                    );
                }
            })
        );
        return new Response(null, {
            status: 101,
            webSocket: client
        });
    }
};
export {
    cf_worker_vless_default as default
};
