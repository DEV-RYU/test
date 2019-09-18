const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8888 });

wss.on('connection', function connection(ws, request) {
    console.log('connection');
    ws.on('message', function incoming(message) {
        console.log('received: %s', message);
    });
    ws.on('close', function close(code, reason) {
        console.log('close ' + code + ':'+reason);
    });
    for(var i=0; i<10; i++){
      ws.send('something');
    }
});
