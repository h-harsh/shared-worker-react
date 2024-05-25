// @ts-nocheck
/* eslint-disable */
let connections: MessagePort[] = [];

self.onconnect = (event: MessageEvent) => {
    const port = event.ports[0];
    connections.push(port);

    port.onmessage = (event: MessageEvent) => {
        // Handle messages sent to the worker
        connections.forEach(conn => conn.postMessage(event.data));
    };

    port.start();
};
 export {};