const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Configure CORS for your Render frontend
const io = socketIo(server, {
  cors: {
    origin: [
      "https://frontend-aibot.onrender.com",
      "http://localhost:3000",
      "http://localhost:5173"
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Configuration - Updated for Ngrok setup
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'medllama2:latest';

// Admin Configuration
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'iamtheserver2024';

// Store blocked IPs and users persistently
const blockedIPs = new Map();
const blockedUsers = new Map();

// FIXED: Enhanced Medical Context (was empty before)
const MEDICAL_CONTEXT = ' '

class RemoteOllamaService {
  async generateResponse(userMessage, socket) {
    return new Promise(async (resolve, reject) => {
      try {
        console.log('💬 Medical query received:', userMessage.substring(0, 100));
        console.log('🔗 Connecting to Ollama at:', OLLAMA_BASE_URL);
        
        const medicalPrompt = MEDICAL_CONTEXT + "\n\nالمريض: " + userMessage + "\n\nالمساعد:";
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);

        // Enhanced headers for Ngrok compatibility
        const headers = {
          'Content-Type': 'application/json',
          'User-Agent': 'Medical-Chatbot-Server/1.0',
          'Accept': 'application/json'
        };

        // Add Ngrok authentication if available
        if (process.env.NGROK_AUTH_TOKEN) {
          headers['Authorization'] = `Bearer ${process.env.NGROK_AUTH_TOKEN}`;
        }

        const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            prompt: medicalPrompt,
            stream: true,
            options: {
              temperature: 0.7,
              top_p: 0.9,
              top_k: 40
            }
          }),
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
          let errorDetails = '';
          try {
            errorDetails = await response.text();
          } catch (e) {
            errorDetails = 'Could not read error response';
          }
          
          console.error(`❌ Ollama API error ${response.status}:`, errorDetails);
          
          if (response.status === 403) {
            throw new Error(`Ngrok/Ollama access forbidden (403). This is usually a Ngrok security restriction. Check your Ngrok configuration.`);
          } else if (response.status === 404) {
            throw new Error(`Ollama endpoint not found. Check if Ollama is running and the URL is correct.`);
          } else {
            throw new Error(`HTTP ${response.status}: ${errorDetails}`);
          }
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
                
                if (socket && socket.connected) {
                  socket.emit('streaming_response', {
                    text: fullResponse,
                    partial: !data.done
                  });
                }
              }
              
              if (data.done) {
                if (socket && socket.connected) {
                  socket.emit('streaming_response', {
                    text: fullResponse,
                    partial: false,
                    complete: true
                  });
                }
                console.log('✅ Response completed, length:', fullResponse.length);
                resolve(fullResponse);
                return;
              }
              
            } catch (e) {
              console.warn('⚠️ JSON parse error:', e.message);
            }
          }
        }

        resolve(fullResponse);
        
      } catch (error) {
        console.error('❌ Ollama service error:', error);
        
        let fallbackResponse = "عذرًا، الخدمة الطبية غير متاحة حاليًا. يرجى المحاولة لاحقًا أو الاتصال بطبيبك مباشرة.";
        
        if (error.name === 'AbortError') {
          fallbackResponse = "عذرًا، تجاوزت الاستجابة المهلة المسموحة. يرجى المحاولة مرة أخرى.";
        } else if (error.message.includes('403') || error.message.includes('forbidden')) {
          fallbackResponse = "عذرًا، الخدمة الطبية غير متاحة حاليًا بسبب قيود الأمان. يرجى الاتصال بالدعم الفني.";
        } else if (error.message.includes('404') || error.message.includes('not found')) {
          fallbackResponse = "عذرًا، خدمة الذكاء الاصطناعي غير متوفرة حاليًا. يرجى الاتصال بالدعم الفني.";
        }
        
        if (socket && socket.connected) {
          socket.emit('streaming_response', {
            text: fallbackResponse,
            partial: false,
            complete: true,
            error: true
          });
        }
        
        resolve(fallbackResponse);
      }
    });
  }

  async healthCheck() {
    try {
      console.log('🔧 Health check connecting to:', OLLAMA_BASE_URL);
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      
      const headers = {
        'User-Agent': 'Medical-Chatbot-Server/1.0'
      };
      
      if (process.env.NGROK_AUTH_TOKEN) {
        headers['Authorization'] = `Bearer ${process.env.NGROK_AUTH_TOKEN}`;
      }
      
      const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
        headers: headers,
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      if (response.ok) {
        const data = await response.json();
        return {
          healthy: true,
          models: data.models?.map(m => m.name) || [],
          message: `Ollama is connected to ${OLLAMA_BASE_URL}`
        };
      } else {
        let errorBody = '';
        try {
          errorBody = await response.text();
        } catch (e) {
          errorBody = 'Could not read error response';
        }
        
        return {
          healthy: false,
          message: `Ollama responded with status: ${response.status} - ${response.statusText}`,
          details: errorBody,
          url: OLLAMA_BASE_URL
        };
      }
    } catch (error) {
      return {
        healthy: false,
        message: `Cannot connect to Ollama at ${OLLAMA_BASE_URL}: ${error.message}`,
        errorType: error.name,
        url: OLLAMA_BASE_URL
      };
    }
  }
}

const medicalService = new RemoteOllamaService();

// Store active connections
const activeConnections = new Map();

// Store chat history for admin monitoring
const chatHistory = [];
const MAX_HISTORY_SIZE = 1000;

// ENHANCED: Complete Block Management System
const adminControls = {
  getConnectedUsers() {
    const users = Array.from(activeConnections.entries()).map(([id, info]) => ({
      socketId: id,
      ...info,
      connectionTime: Math.floor((new Date() - info.connectedAt) / 1000) + 's',
      isBlocked: blockedIPs.has(info.ip) || blockedUsers.has(id)
    }));
    console.log('👥 Admin: Current connected users:', users.length);
    return users;
  },

  kickUser(socketId, adminSocket) {
    console.log(`🚫 Admin: Attempting to kick user: ${socketId}`);
    
    const targetSocket = io.sockets.sockets.get(socketId);
    if (targetSocket) {
      console.log(`🔍 Found target socket: ${socketId}`);
      
      // Send chat message to user before disconnecting
      targetSocket.emit('chat_message', {
        text: "🚫 تم فصل اتصالك من قبل المسؤول. إذا كنت بحاجة إلى مساعدة، يرجى الاتصال بالدعم.",
        isUser: false,
        timestamp: new Date().toISOString(),
        type: 'admin_action'
      });
      
      targetSocket.emit('streaming_response', {
        text: "🚫 تم فصل اتصالك من قبل المسؤول. إذا كنت بحاجة إلى مساعدة، يرجى الاتصال بالدعم.",
        partial: false,
        complete: true,
        type: 'admin_action'
      });
      
      // Disconnect the user
      setTimeout(() => {
        targetSocket.disconnect(true);
        activeConnections.delete(socketId);
      }, 1000);
      
      addToHistory(socketId, 'admin_action', `User ${socketId} was kicked by admin`);
      
      console.log(`🔴 Admin: SUCCESS - Kicked user: ${socketId}`);
      return true;
    }
    console.log(`❌ Admin: User not found: ${socketId}`);
    return false;
  },

  blockUser(socketId, adminSocket, reason = "Blocked by admin") {
    console.log(`⛔ Admin: Attempting to block user: ${socketId}`);
    
    const targetSocket = io.sockets.sockets.get(socketId);
    let userInfo = null;
    
    if (targetSocket) {
      userInfo = activeConnections.get(socketId);
    } else {
      // User is not currently connected, but we can still block the socket ID
      console.log(`ℹ️ User ${socketId} is not connected, but blocking socket ID anyway`);
    }
    
    // Block by socket ID with timestamp and reason
    blockedUsers.set(socketId, {
      timestamp: new Date().toISOString(),
      reason: reason,
      blockedBy: adminSocket?.id || 'admin'
    });
    
    console.log(`⛔ Blocked socket ID: ${socketId}`);
    
    // If user is connected, disconnect them
    if (targetSocket && userInfo) {
      // Also block by IP for extra protection
      blockedIPs.set(userInfo.ip, {
        timestamp: new Date().toISOString(),
        reason: reason,
        blockedBy: adminSocket?.id || 'admin',
        socketId: socketId
      });
      
      console.log(`⛔ Also blocked IP: ${userInfo.ip}`);
      
      // Send chat message to user
      targetSocket.emit('chat_message', {
        text: "⛔ تم حظر اتصالك من قبل المسؤول. لا يمكنك إعادة الاتصال.",
        isUser: false,
        timestamp: new Date().toISOString(),
        type: 'admin_action'
      });
      
      targetSocket.emit('streaming_response', {
        text: "⛔ تم حظر اتصالك من قبل المسؤول. لا يمكنك إعادة الاتصال.",
        partial: false,
        complete: true,
        type: 'admin_action'
      });
      
      // Disconnect the user
      setTimeout(() => {
        targetSocket.disconnect(true);
        activeConnections.delete(socketId);
      }, 1000);
      
      addToHistory(socketId, 'admin_action', `User ${socketId} (IP: ${userInfo.ip}) was blocked by admin: ${reason}`);
    } else {
      addToHistory(socketId, 'admin_action', `Socket ID ${socketId} was blocked by admin: ${reason}`);
    }
    
    console.log(`⛔ Admin: SUCCESS - Blocked user: ${socketId}`);
    return true;
  },

  unblockUser(socketIdOrIP, adminSocket) {
    console.log(`🔓 Admin: Attempting to unblock: ${socketIdOrIP}`);
    
    let unblocked = false;
    
    // Try to unblock by socket ID
    if (blockedUsers.has(socketIdOrIP)) {
      blockedUsers.delete(socketIdOrIP);
      console.log(`🔓 Unblocked socket ID: ${socketIdOrIP}`);
      unblocked = true;
    }
    
    // Try to unblock by IP
    if (blockedIPs.has(socketIdOrIP)) {
      blockedIPs.delete(socketIdOrIP);
      console.log(`🔓 Unblocked IP: ${socketIdOrIP}`);
      unblocked = true;
    }
    
    if (unblocked) {
      addToHistory('admin', 'admin_action', `Admin unblocked: ${socketIdOrIP}`);
      console.log(`🔓 Admin: SUCCESS - Unblocked: ${socketIdOrIP}`);
      return true;
    } else {
      console.log(`❌ Admin: Not found in blocked lists: ${socketIdOrIP}`);
      return false;
    }
  },

  getBlockedList() {
    const blockedList = {
      ips: Array.from(blockedIPs.entries()).map(([ip, info]) => ({
        ip,
        ...info
      })),
      users: Array.from(blockedUsers.entries()).map(([socketId, info]) => ({
        socketId,
        ...info
      }))
    };
    
    console.log(`📋 Admin: Blocked list requested - IPs: ${blockedList.ips.length}, Users: ${blockedList.users.length}`);
    return blockedList;
  },

  broadcastToAll(message, adminSocket) {
    console.log(`📢 Admin: Broadcasting to ${activeConnections.size} users:`, message);
    
    const adminMessage = {
      text: `📢 إشعار من المسؤول: ${message}`,
      isUser: false,
      timestamp: new Date().toISOString(),
      type: 'admin_broadcast',
      from: 'المسؤول'
    };
    
    activeConnections.forEach((info, socketId) => {
      const userSocket = io.sockets.sockets.get(socketId);
      if (userSocket && userSocket.connected) {
        user
