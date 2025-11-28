const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);

// CORS setup
const io = socketIo(server, {
  cors: {
    origin: ["https://frontend-aibot.onrender.com", "http://localhost:3000"],
    methods: ["GET", "POST"]
  }
});

app.use(express.json());

// CRITICAL: Render Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString() 
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: '🏥 Medical Chatbot Server is RUNNING',
    status: 'healthy'
  });
});

// Basic socket connection
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.emit('welcome', {
    message: 'أهلاً وسهلاً! أنا مساعدك الطبي.',
    id: socket.id
  });

  socket.on('send_message', (data) => {
    console.log('Message received:', data.message);
    // Simple echo response for testing
    socket.emit('streaming_response', {
      text: `تم استلام رسالتك: "${data.message}". الخدمة قيد التشغيل.`,
      complete: true
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log(`
✅ SERVER RUNNING ON PORT ${PORT}
🏥 Health: http://localhost:${PORT}/health
🌐 Ready for Render!
  `);
});

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
