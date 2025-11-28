const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);

// CORS setup
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins for testing
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Configuration - REPLACE WITH YOUR ACTUAL NGROK URL
const OLLAMA_BASE_URL = 'https://latrisha-dermatological-bernadine.ngrok-free.dev';
const OLLAMA_MODEL = 'medllama2:latest';

// Simple health check for Render
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'Medical Chatbot',
    message: 'Server is running'
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Store active connections
const activeConnections = new Map();

// Medical context in Arabic
const MEDICAL_CONTEXT = أنت مساعد طبي مخصص للمرضى التونسيين. دورك هو تقديم معلومات طبية عامة وتحليل أولي للأعراض. تذكر أنك لست بديلاً عن الطبيب واستشر المتخصصين للحالات الخطيرة. للطوارئ اتصل على 190.;

// Simple Ollama service
class OllamaService {
  async generateResponse(userMessage, socket) {
    try {
      console.log('💬 Processing message:', userMessage.substring(0, 100));
      
      const medicalPrompt = MEDICAL_CONTEXT + "\n\nالمريض: " + userMessage + "\n\nالمساعد:";
      
      const response = await fetch(${OLLAMA_BASE_URL}/api/generate, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: medicalPrompt,
          stream: true,
          options: {
            temperature: 0.7,
            top_p: 0.9
          }
        })
      });

      if (!response.ok) {
        throw new Error(Ollama error: ${response.status});
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          try {
            const data = JSON.parse(line);
            
            if (data.response) {
              fullResponse += data.response;
              
              // Send streaming update
              socket.emit('streaming_response', {
                text: fullResponse,
                partial: !data.done
              });
            }
            
            if (data.done) {
              // Send final response
              socket.emit('streaming_response', {
                text: fullResponse,
                partial: false,
                complete: true
              });
              return fullResponse;
            }
          } catch (e) {
            // Skip JSON errors
          }
        }
      }
      
    } catch (error) {
      console.error('❌ Error:', error);
      
      const fallbackResponse = "عذرًا، الخدمة غير متاحة حاليًا. يرجى المحاولة لاحقًا.";
      
      socket.emit('streaming_response', {
        text: fallbackResponse,
        partial: false,
        complete: true,
        error: true
      });
      
      return fallbackResponse;
    }
  }
}

const ollamaService = new OllamaService();

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);
  
  activeConnections.set(socket.id, {
    connectedAt: new Date(),
    ip: socket.handshake.address
  });

  // Welcome message
  socket.emit('welcome', {
    message: 'أهلاً وسهلاً! أنا مساعدك الطبي التونسي. كيف يمكنني مساعدتك اليوم؟',
    id: socket.id
  });

  // Handle incoming messages
  socket.on('send_message', async (data) => {
    if (!data.message || data.message.trim().length === 0) {
      socket.emit('error', { message: 'الرجاء كتابة رسالة.' });
      return;
    }

    try {
      await ollamaService.generateResponse(data.message.trim(), socket);
    } catch (error) {
      console.error('💥 Message error:', error);
      socket.emit('error', { 
        message: 'عذرًا، حدث خطأ. يرجى المحاولة مرة أخرى.' 
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.id);
    activeConnections.delete(socket.id);
  });
});

const PORT = process.env.PORT || 10000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
🏥 Medical Chatbot Server
📍 Port: ${PORT}
🔗 Ollama: ${OLLAMA_BASE_URL}
🤖 Model: ${OLLAMA_MODEL}

✨ Server is running and ready!
  `);
});

module.exports = app;
