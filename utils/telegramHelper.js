const AppSettings = require('../models/AppSettings');
const https = require('https');

async function sendTelegramMessage(message) {
  try {
    const token = await AppSettings.get('telegram_bot_token');
    const chatId = await AppSettings.get('telegram_chat_id');
    
    if (!token || !chatId) {
      return { success: false, error: 'Telegram settings not configured' };
    }
    
    const data = JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    });
    
    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot\${token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };
    
    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (parsed.ok) {
              resolve({ success: true });
            } else {
              resolve({ success: false, error: parsed.description });
            }
          } catch (e) {
            resolve({ success: false, error: 'Failed to parse Telegram response' });
          }
        });
      });
      
      req.on('error', (e) => {
        resolve({ success: false, error: e.message });
      });
      
      req.write(data);
      req.end();
    });
  } catch (error) {
    console.error('[TelegramHelper] Error sending message:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { sendTelegramMessage };
