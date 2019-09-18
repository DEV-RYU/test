const server = require('http').createServer();

const io = require('socket.io')(8888, {
//  path: '/test',
  serveClient: false,
  // below are engine.IO options
  pingInterval: 10000,
  pingTimeout: 5000,
  cookie: false
});

io.on('connection', (socket) => {
  console.log('client Socket Id : ' + socket.id);

  socket.on('proxy-for-bar', function(data) {
    io.emit('tomaster-bar', data);
    console.log(data);
  });

  socket.on('proxy-for-mode', function(data) {
    io.emit('toagent-mode', data);
    console.log(data);
  });

  socket.on('proxy-for-chart', function(data) {
    io.emit('tomaster-chart', data);
    //console.log(data);
  });

  socket.on('proxy-for-err', function(data) {
    io.emit('tomaster-err', data);
    console.log(data);
  });
});
