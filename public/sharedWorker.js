// @ts-nocheck
/* eslint-disable */
let connections = [];
console.log("harsh")
self.onconnect = (event) => {
    const port = event.ports[0];
    connections.push(port);

    port.onmessage = (event) => {
        // Handle messages sent to the worker
        connections.forEach(conn => conn.postMessage(event.data));
    };

    port.start();
};
 export {};