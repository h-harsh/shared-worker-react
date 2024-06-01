self.addEventListener('connect', function(event) {
  var port = event.ports[0];
  port.addEventListener('message', function(event) {
    port.postMessage('Message received: ' + event.data);
  });
  port.start();
});
