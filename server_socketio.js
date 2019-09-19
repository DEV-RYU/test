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

    // =========================[agent -> proxy -> master]=========================
    // progress info listener
    socket.on('proxy-for-bar', function (msg) {
        //socket.emit('totCnt', msg);   // node vs node
        io.sockets.emit('tomaster-bar', msg);
    });

    // cpu, mem info listener
    socket.on('proxy-for-chart', function (msg) {
        io.sockets.emit('tomaster-chart', msg);
    });

    // =========================[master -> proxy -> agent]=========================
    socket.on('proxy-for-mode', function (msg) {
        io.sockets.emit('toagent-mode', msg);
    });
	
	socket.on('proxy-for-err', function(data) {
		io.emit('tomaster-err', data);
		console.log(data);
	});

});
