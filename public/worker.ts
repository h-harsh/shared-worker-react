/* eslint-disable */
const prodUrl = '%%SOCKET_URL%%';
const devUrl = 'wss://wss.tiqs.in';
const apiUrl = prodUrl != '%%SOCKET_URL%%' ? prodUrl : devUrl;

const MSG_TYPE = {
  SUBSCRIBE: 'sub',
  UNSUBSCRIBE: 'unsub',
  CONNECT: 'connect',
};

const SOCKET_CONNECT = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RETRYING: 'retrying',
};

const Socket = function (session, token) {
  const self = this;
  this.session = session;
  this.token = token;
  this.MODE = {
    LTPC: 'ltpc',
    QUOTE: 'quote',
    FULL: 'full',
  };
  this.subscriptions = {
    ltpc: new Map(),
    quote: new Map(),
    full: new Map(),
  };

  this.updateSubscriptions = (data) => {
    if (data.msgType === MSG_TYPE.SUBSCRIBE) {
      data.data.forEach((item) => {
        this.subscriptions[data.mode].set(item, 1);
      });
    } else if (data.msgType === MSG_TYPE.UNSUBSCRIBE) {
      data.data.forEach((item) => {
        this.subscriptions[data.mode].delete(item);
      });
    }
  };

  const autoReconnect = true;

  let conn = null;

  let readTimer = null;
  let pinger = null;
  let lastRead = 0;
  let currentReconnectionCount = 0;
  let lastReconnectInterval = 0;
  //  defaultReconnectMaxDelay = 60,
  // defaultReconnectMaxRetries = 50,
  const maximumReconnectMaxRetries = 300;
  // minimumReconnectMaxDelay = 5;
  let reconnectTimeout = null;

  const readTimeout = 30; // seconds
  const reconnectMaxDelay = 10;
  const reconnectMaxTries = maximumReconnectMaxRetries;

  const triggers = {
    connect: [],
    disconnect: [],
    reconnect: [],
    noreconnect: [],
    error: [],
    close: [],
    message: [],
    ticks: [],
    orderUpdate: [],
  };

  this.connect = function () {
    // Skip if its already connected
    if (
      conn &&
      (conn.readyState === conn.CONNECTING || conn.readyState === conn.OPEN)
    ) {
      return;
    }
    const url = `${apiUrl}?session=${this.session}&token=${this.token}`;
    conn = new WebSocket(url);

    conn.onopen = function () {
      // Reset last reconnect interval
      lastReconnectInterval = null;
      // Reset current_reconnection_count attempt
      currentReconnectionCount = 0;
      // Store current open connection url to check for auto re-connection.
      // Trigger on connect event
      trigger('connect');
      // If there isn't an incoming message in n seconds, assume disconnection.
      clearInterval(readTimer);
      clearInterval(pinger);
      clearTimeout(reconnectTimeout);
      let keys = Array.from(self.subscriptions.ltpc.keys());
      if (keys.length > 0) {
        self.subscribe(self.MODE.LTPC, keys);
      }
      keys = Array.from(self.subscriptions.quote.keys());
      if (keys.length > 0) {
        self.subscribe(self.MODE.QUOTE, keys);
      }
      keys = Array.from(self.subscriptions.full.keys());
      if (keys.length > 0) {
        self.subscribe(self.MODE.FULL, keys);
      }

      lastRead = new Date();
      pinger = setInterval(() => {
        if (conn && conn.readyState === conn.OPEN) {
          conn.send('PONG');
        }
      }, 30000); // setting pin interval to 60 seconds
      readTimer = setInterval(() => {
        if ((new Date() - lastRead) / 1000 >= readTimeout) {
          // reset current_ws_url incase current connection times out
          // This is determined when last heart beat received time interval
          // exceeds readTimeout value
          if (conn) {
            conn.close();
          }
          clearInterval(readTimer);
          triggerDisconnect();
        }
      }, readTimeout * 1000);
    };

    conn.binaryType = 'arraybuffer';

    conn.onmessage = function (e) {
      // Set last read time to check for connection timeout
      lastRead = new Date();
      // Parse binary tick data
      if (e.data instanceof ArrayBuffer) {
        // Trigger on message event when binary message is received
        if (e.data.byteLength > 2) {
          trigger('ticks', [parseBinary(e.data)]);
        }
      } else {
        const data = parseTextMessage(e.data);
        if (data.type === 'orderUpdate') {
          trigger('orderUpdate', [data]);
        }
      }
    };

    conn.onerror = function (e) {
      trigger('error', [e]);

      // Force close to avoid ghost connections
      if (this && this.readyState === this.OPEN) {
        this.close();
      }
    };

    conn.onclose = function (e) {
      trigger('close', [e]);
      triggerDisconnect(e);
    };
  };

  this.disconnect = function () {
    if (
      conn &&
      conn.readyState !== conn.CLOSING &&
      conn.readyState !== conn.CLOSED
    ) {
      conn.close();
    }
  };

  this.connected = function () {
    if (conn && conn.readyState === conn.OPEN) {
      return true;
    }
    return false;
  };

  this.on = function (e, callback) {
    if (triggers.hasOwnProperty(e)) {
      triggers[e].push(callback);
    }
  };

  this.subscribe = function (mode, tokens) {
    self.updateSubscriptions({
      msgType: MSG_TYPE.SUBSCRIBE,
      mode,
      data: tokens,
    });
    // console.log('mode', mode, tokens, self.connected())
    if (!self.connected()) {
      return;
    }

    if (tokens.length > 0) {
      send({
        code: MSG_TYPE.SUBSCRIBE,
        mode,
        [mode]: tokens,
      });
    }
  };

  this.unsubscribe = function (mode, tokens) {
    self.updateSubscriptions({
      msgType: MSG_TYPE.UNSUBSCRIBE,
      mode,
      data: tokens,
    });
    if (!self.connected()) {
      return;
    }
    if (tokens.length > 0) {
      send({
        code: MSG_TYPE.UNSUBSCRIBE,
        mode,
        [mode]: tokens,
      });
    }
  };

  function triggerDisconnect(e) {
    conn = null;
    trigger('disconnect', [e]);
    if (autoReconnect) {
      attemptReconnection();
    }
  }

  // send a message to the server via the socket
  function send(message) {
    if (!conn || conn.readyState !== conn.OPEN) {
      return;
    }

    try {
      if (typeof message === 'object') {
        message = JSON.stringify(message);
      }
      conn.send(message);
    } catch (e) {
      conn.close();
    }
  }

  // trigger event callbacks
  function trigger(e, args) {
    if (!triggers[e]) {
      return;
    }
    for (let n = 0; n < triggers[e].length; n++) {
      triggers[e][n].apply(triggers[e][n], args || []);
    }
  }

  function parseTextMessage(data) {
    let parsedData = {};
    try {
      parsedData = JSON.parse(data);
    } catch (e) {
    } finally {
      return parsedData;
    }
  }

  function parseBinary(data) {
    const tick = {};
    if (data.byteLength >= 17) {
      tick.token = bigEndianToInt(data.slice(0, 4));
      tick.ltp = bigEndianToInt(data.slice(4, 8));
      if (data.byteLength === 17) {
        tick.close = bigEndianToInt(data.slice(13, 17));
        tick.netChange =
          Math.round(
            (((tick.ltp - tick.close) / tick.close) * 100 + Number.EPSILON) *
            100
          ) / 100 || 0;
        if (tick.ltp > tick.close) {
          tick.changeFlag = 43; // ascii code for +
        } else if (tick.ltp < tick.close) {
          tick.changeFlag = 45; // ascii code for -
        } else {
          tick.changeFlag = 32; // no change
        }
      }
      tick.mode = worker.MODE.LTPC;
    }
    if (data.byteLength >= 69) {
      tick.ltq = bigEndianToInt(data.slice(13, 17));
      tick.avgPrice = bigEndianToInt(data.slice(17, 21));
      tick.totalBuyQuantity = bigEndianToInt(data.slice(21, 25));
      tick.totalSellQuantity = bigEndianToInt(data.slice(25, 29));
      tick.open = bigEndianToInt(data.slice(29, 33));
      tick.high = bigEndianToInt(data.slice(33, 37));
      tick.close = bigEndianToInt(data.slice(37, 41));
      tick.low = bigEndianToInt(data.slice(41, 45));
      tick.volume = bigEndianToInt(data.slice(45, 49));
      tick.time = bigEndianToInt(data.slice(53, 57));
      tick.oi = bigEndianToInt(data.slice(57, 61));
      tick.oiDayHigh = bigEndianToInt(data.slice(61, 65));
      tick.oiDayLow = bigEndianToInt(data.slice(65, 69));
      tick.netChange =
        Math.round(
          (((tick.ltp - tick.close) / tick.close) * 100 + Number.EPSILON) * 100
        ) / 100 || 0;
      if (tick.ltp > tick.close) {
        tick.changeFlag = 43; // ascii code for +
      } else if (tick.ltp < tick.close) {
        tick.changeFlag = 45; // ascii code for -
      } else {
        tick.changeFlag = 32; // no change
      }
      tick.mode = worker.MODE.QUOTE;
    }
    if (data.byteLength === 197) {
      tick.ltt = bigEndianToInt(data.slice(49, 53));
      tick.lowerLimit = bigEndianToInt(data.slice(69, 73));
      tick.upperLimit = bigEndianToInt(data.slice(73, 77));
      const bids = [];
      const asks = [];
      for (let i = 0; i < 10; i++) {
        const quantity = bigEndianToInt(data.slice(77 + i * 12, 81 + i * 12));
        const price = bigEndianToInt(data.slice(81 + i * 12, 85 + i * 12));
        const orders = bigEndianToInt(data.slice(85 + i * 12, 87 + i * 12));
        if (i >= 5) {
          asks.push({ price, quantity, orders });
        } else {
          bids.push({ price, quantity, orders });
        }
      }
      tick.bids = bids;
      tick.asks = asks;
      tick.mode = worker.MODE.FULL;
    }
    if (tick.close === 0) {
      tick.netChange = 0;
    }
    return tick;
  }

  function attemptReconnection() {
    // Try reconnecting only so many times.
    if (currentReconnectionCount > reconnectMaxTries) {
      trigger('noreconnect');
      return;
    }

    if (currentReconnectionCount > 0) {
      lastReconnectInterval = 2 ** currentReconnectionCount;
    } else if (!lastReconnectInterval) {
      // console.log("setting lastReconnectInterval to 1");
      lastReconnectInterval = 1;
    }
    if (lastReconnectInterval > reconnectMaxDelay) {
      lastReconnectInterval = reconnectMaxDelay;
    }

    currentReconnectionCount++;

    trigger('reconnect', [currentReconnectionCount, lastReconnectInterval]);

    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }
    console.log(`new reconnect timeout: ${lastReconnectInterval} seconds`);
    reconnectTimeout = setTimeout(() => {
      self.connect();
    }, lastReconnectInterval * 1000);
  }

  function bigEndianToInt(buffer) {
    const buf = new Uint8Array(buffer);
    let value = 0;
    const len = buf.byteLength;
    for (let i = 0, j = len - 1; i < len; i++, j--) {
      value += buf[j] << (i * 8);
    }
    return value;
  }
};

let worker = null;

const subscriptions = {
  ltpc: new Map(),
  quote: new Map(),
  full: new Map(),
};

const updateSubscriptions = (data) => {
  if (data.msgType === MSG_TYPE.SUBSCRIBE) {
    data.data.forEach((item) => {
      subscriptions[data.mode].set(item, 1);
    });
  } else if (data.msgType === MSG_TYPE.UNSUBSCRIBE) {
    data.data.forEach((item) => {
      subscriptions[data.mode].delete(item);
    });
  }
};

self.onmessage = function handleMessageFromMain(msg) {
  const parsedData = JSON.parse(msg.data);

  if (parsedData.msgType === MSG_TYPE.CONNECT && parsedData.token) {
    worker = new Socket(parsedData.session, parsedData.token);
    worker.connect();

    worker.on('connect', () => {
      console.log('connected to socket');
      self.postMessage(JSON.stringify({ status: SOCKET_CONNECT.CONNECTED }));
      // subscribe to all the previous subscriptions
      let keys = Array.from(subscriptions.ltpc.keys());
      if (keys.length > 0) {
        worker.subscribe(worker.MODE.LTPC, keys);
      }
      keys = Array.from(subscriptions.quote.keys());
      if (keys.length > 0) {
        worker.subscribe(worker.MODE.QUOTE, keys);
      }
      keys = Array.from(subscriptions.full.keys());
      if (keys.length > 0) {
        worker.subscribe(worker.MODE.FULL, keys);
      }
    });
    worker.on('noreconnect', () => {
      console.log('exhausted reconnect retries...');
    });
    worker.on('close', () => {
      console.log('got close event from socket, reconnecting...');
      self.postMessage(JSON.stringify({ status: SOCKET_CONNECT.CONNECTING }));
    });
    worker.on('reconnect', () => {
      console.log('reconnecting to socket...');
      self.postMessage(JSON.stringify({ status: SOCKET_CONNECT.CONNECTING }));
    });
    worker.on('disconnect', () => {
      console.log('disconnected');
      self.postMessage(JSON.stringify({ status: SOCKET_CONNECT.CONNECTING }));
    });
    worker.on('error', (error) => {
      console.log('error', error);
      self.postMessage(JSON.stringify({ status: SOCKET_CONNECT.CONNECTING }));
    });
    worker.on('ticks', (e) => {
      self.postMessage(JSON.stringify(e));
    });
    worker.on('orderUpdate', (e) => {
      self.postMessage(JSON.stringify(e));
    });
    return;
  }
  if (!worker) {
    updateSubscriptions(parsedData);
    return;
  }
  if (parsedData.msgType === MSG_TYPE.SUBSCRIBE) {
    worker.subscribe(parsedData.mode, parsedData?.data);
  } else {
    worker.unsubscribe(parsedData.mode, parsedData?.data);
  }
  updateSubscriptions(parsedData);
};
