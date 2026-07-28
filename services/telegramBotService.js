const https = require('https');
const AppSettings = require('../models/AppSettings');
const Stream = require('../models/Stream');
const { getSystemStats } = require('./systemMonitor');

let pollingInterval = null;
let lastUpdateId = 0;

async function init() {
  if (pollingInterval) clearInterval(pollingInterval);
  
  // Poll every 3 seconds for new updates
  pollingInterval = setInterval(() => handleUpdates(), 3000);
  console.log('Telegram Bot Polling Service initialized');
}

async function handleUpdates() {
  try {
    const token = await AppSettings.get('telegram_bot_token');
    const chatId = await AppSettings.get('telegram_chat_id');
    
    if (!token || !chatId) return;

    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=0`;
    
    https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (!data.ok || !data.result) return;

          for (const update of data.result) {
            lastUpdateId = update.update_id;
            
            // Handle callback buttons (Start/Stop button clicks)
            if (update.callback_query) {
              const callbackQuery = update.callback_query;
              const command = callbackQuery.data;
              const fromChatId = String(callbackQuery.message.chat.id);
              
              if (fromChatId === String(chatId)) {
                await processCommand(command, token, chatId);
                await answerCallbackQuery(token, callbackQuery.id);
              }
              continue;
            }

            // Handle text commands
            if (update.message && update.message.text) {
              const messageChatId = String(update.message.chat.id);
              
              // Only respond to messages from the authorized user
              if (messageChatId !== String(chatId)) {
                console.warn(`[TelegramBot] Unauthorized message from chat ID: ${messageChatId}`);
                continue;
              }
              
              await processCommand(update.message.text, token, chatId);
            }
          }
        } catch (e) {
          // ignore parse errors
        }
      });
    }).on('error', () => {
      // ignore network errors
    });
  } catch (error) {
    console.error('[TelegramBot] Error in updates handler:', error.message);
  }
}

async function answerCallbackQuery(token, callbackQueryId) {
  const data = JSON.stringify({
    callback_query_id: callbackQueryId
  });
  
  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${token}/answerCallbackQuery`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };
  
  return new Promise((resolve) => {
    const req = https.request(options, () => resolve());
    req.on('error', () => resolve());
    req.write(data);
    req.end();
  });
}

async function sendTelegramReply(token, chatId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  };
  
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  
  const data = JSON.stringify(payload);
  
  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };
  
  return new Promise((resolve) => {
    const req = https.request(options, () => resolve());
    req.on('error', () => resolve());
    req.write(data);
    req.end();
  });
}

async function processCommand(text, token, chatId) {
  const parts = text.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ');

  if (command === '/start' || command === '/help') {
    const helpMessage = `🤖 <b>Autostream Bot Kontrol</b>\n\n` +
      `Halo! Anda bisa mengontrol server Autostream Anda lewat perintah berikut:\n\n` +
      `📊 <b>/status</b> - Cek penggunaan CPU, RAM, & status siaran saat ini.\n` +
      `📋 <b>/list</b> - Daftar semua siaran (live & terjadwal) lengkap dengan tombol kontrol.\n` +
      `▶️ <b>/start_stream [ID]</b> - Mulai siaran secara manual.\n` +
      `⏹️ <b>/stop_stream [ID]</b> - Hentikan siaran secara manual.\n` +
      `⚠️ <b>/stop_all</b> - Matikan semua siaran yang sedang jalan.`;
    await sendTelegramReply(token, chatId, helpMessage);
  } 
  else if (command === '/status') {
    try {
      const stats = await getSystemStats();
      const liveStreams = await Stream.findAll(null, 'live');
      
      const statusMessage = `📊 <b>Status Server & Siaran:</b>\n\n` +
        `🖥️ <b>CPU:</b> <code>${stats.cpu.usage}%</code> (${stats.cpu.cores} Cores)\n` +
        `💾 <b>RAM:</b> <code>${stats.memory.used} / ${stats.memory.total}</code> (${stats.memory.usagePercent}%)\n` +
        `💽 <b>Disk:</b> <code>${stats.disk.used} / ${stats.disk.total}</code> (${stats.disk.usagePercent}%)\n` +
        `🌐 <b>Sinyal Live:</b> <code>${liveStreams.length} siaran aktif</code>`;
      
      await sendTelegramReply(token, chatId, statusMessage);
    } catch (err) {
      await sendTelegramReply(token, chatId, `❌ Gagal mengambil status server: ${err.message}`);
    }
  } 
  else if (command === '/list') {
    try {
      const liveStreams = await Stream.findAll(null, 'live');
      const scheduledStreams = await Stream.findAll(null, 'scheduled');
      const buttons = [];
      
      let listMessage = `📋 <b>Daftar Siaran Aktif & Terjadwal:</b>\n\n`;
      
      if (liveStreams.length === 0 && scheduledStreams.length === 0) {
        listMessage += `<i>Tidak ada siaran saat ini.</i>`;
      } else {
        if (liveStreams.length > 0) {
          listMessage += `🟢 <b>LIVE:</b>\n`;
          for (const s of liveStreams) {
            const details = await Stream.getStreamWithVideo(s.id);
            const videoTitle = details ? (details.video_type === 'playlist' ? details.playlist_name : (details.video_title || 'N/A')) : 'N/A';
            const timeStr = s.start_time ? new Date(s.start_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '--:--';
            listMessage += `- Task: <b>${s.title}</b>\n  Video/Playlist: <i>${videoTitle}</i>\n  Jam Mulai: <code>${timeStr} WIB</code>\n\n`;
            
            // Add red button to stop the running stream
            buttons.push([
              { text: `🛑 Stop: ${s.title}`, callback_data: `/stop_stream ${s.id}` }
            ]);
          }
        }
        if (scheduledStreams.length > 0) {
          listMessage += `⏳ <b>TERJADWAL:</b>\n`;
          for (const s of scheduledStreams) {
            const details = await Stream.getStreamWithVideo(s.id);
            const videoTitle = details ? (details.video_type === 'playlist' ? details.playlist_name : (details.video_title || 'N/A')) : 'N/A';
            const timeStr = s.schedule_time ? new Date(s.schedule_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '--:--';
            listMessage += `- Task: <b>${s.title}</b>\n  Video/Playlist: <i>${videoTitle}</i>\n  Jadwal: <code>${timeStr} WIB</code>\n\n`;
            
            // Add green button to start the scheduled stream manually
            buttons.push([
              { text: `▶️ Start: ${s.title}`, callback_data: `/start_stream ${s.id}` }
            ]);
          }
        }
      }
      
      const replyMarkup = buttons.length > 0 ? { inline_keyboard: buttons } : null;
      await sendTelegramReply(token, chatId, listMessage, replyMarkup);
    } catch (err) {
      await sendTelegramReply(token, chatId, `❌ Gagal mengambil daftar siaran: ${err.message}`);
    }
  } 
  else if (command === '/start_stream') {
    if (!arg) {
      return await sendTelegramReply(token, chatId, `⚠️ Harap masukkan ID siaran.\nContoh: <code>/start_stream autolive_xxx</code>`);
    }
    try {
      const streamingService = require('./streamingService');
      const baseUrl = process.env.BASE_URL || 'http://localhost:7575';
      
      await sendTelegramReply(token, chatId, `⏳ Sedang menyalakan siaran...`);
      const result = await streamingService.startStream(arg, false, baseUrl);
      
      if (result.success) {
        await sendTelegramReply(token, chatId, `▶️ Siaran berhasil dimulai!`);
      } else {
        await sendTelegramReply(token, chatId, `❌ Gagal memulai siaran: <code>${result.error}</code>`);
      }
    } catch (err) {
      await sendTelegramReply(token, chatId, `❌ Error: ${err.message}`);
    }
  } 
  else if (command === '/stop_stream') {
    if (!arg) {
      return await sendTelegramReply(token, chatId, `⚠️ Harap masukkan ID siaran.\nContoh: <code>/stop_stream autolive_xxx</code>`);
    }
    try {
      const streamingService = require('./streamingService');
      
      await sendTelegramReply(token, chatId, `⏳ Sedang menghentikan siaran...`);
      await streamingService.stopStream(arg);
      await sendTelegramReply(token, chatId, `⏹️ Siaran berhasil dihentikan!`);
    } catch (err) {
      await sendTelegramReply(token, chatId, `❌ Error saat menghentikan siaran: ${err.message}`);
    }
  } 
  else if (command === '/stop_all') {
    try {
      const liveStreams = await Stream.findAll(null, 'live');
      if (liveStreams.length === 0) {
        return await sendTelegramReply(token, chatId, `ℹ️ Tidak ada siaran aktif yang sedang berjalan.`);
      }
      const streamingService = require('./streamingService');
      for (const s of liveStreams) {
        await streamingService.stopStream(s.id);
      }
      await sendTelegramReply(token, chatId, `⏹️ Semua (${liveStreams.length}) siaran aktif berhasil dihentikan.`);
    } catch (err) {
      await sendTelegramReply(token, chatId, `❌ Error: ${err.message}`);
    }
  } 
  else {
    await sendTelegramReply(token, chatId, `❓ Perintah tidak dikenal. Kirim <b>/help</b> untuk melihat daftar perintah.`);
  }
}

module.exports = { init };
