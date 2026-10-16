const fs = require('fs');
const path = require('path');
const https = require('https');

const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
  'gemini-3-flash-preview',
  'gemini-2.5-pro'
];

async function callSingleModel(model, payload, apiKey) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.error) {
              return reject(new Error(data.error.message || `Error dari ${model}`));
            }
            if (data.candidates && data.candidates[0] && data.candidates[0].content) {
              const rawText = data.candidates[0].content.parts[0].text;
              resolve(rawText);
            } else {
              reject(new Error(`Format respons tidak terduga dari ${model}: ` + body.substring(0, 150)));
            }
          } catch (err) {
            reject(new Error(`Gagal parse JSON dari ${model}: ` + err.message));
          }
        });
      }
    );

    req.on('error', err => reject(err));
    req.setTimeout(25000, () => {
      req.destroy();
      reject(new Error(`Koneksi timeout ke ${model}`));
    });

    req.write(payload);
    req.end();
  });
}

async function generateTitlesFromImage({ imagePath, count = 10, guidance = '', language = 'id', videoName = '' }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY belum dikonfigurasi di file .env server');
  }

  const requestedCount = Math.max(1, Math.min(50, parseInt(count) || 10));

  let imgBase64 = null;
  let mimeType = 'image/jpeg';

  if (imagePath) {
    const cleanRelPath = imagePath.startsWith('/') ? imagePath.substring(1) : imagePath;
    const candidatePath = path.join(__dirname, '..', 'public', cleanRelPath);
    if (fs.existsSync(candidatePath)) {
      imgBase64 = fs.readFileSync(candidatePath).toString('base64');
      const ext = path.extname(candidatePath).toLowerCase();
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.webp') mimeType = 'image/webp';
    }
  }

  const topicContext = [
    guidance ? `Instruksi / Topik Khusus: ${guidance}` : '',
    videoName ? `Nama File / Video Terkait: ${videoName}` : ''
  ].filter(Boolean).join('\n');

  let prompt = '';
  if (language === 'en') {
    if (imgBase64) {
      prompt = `You are a professional YouTube SEO & viral content strategist.
Analyze this video thumbnail image thoroughly: its visual elements, mood, topic, atmosphere, and any text inside it.
Generate exactly ${requestedCount} unique, highly engaging, click-worthy, and SEO-friendly YouTube live streaming titles that perfectly match this thumbnail.
${topicContext ? `\nContext:\n${topicContext}` : ''}

Output format rules:
- Provide exactly ${requestedCount} titles.
- Exactly one title per line.
- Do NOT include numbers, bullet points, asterisks, or quotes.
- Keep titles natural, compelling, and relevant.`;
    } else {
      prompt = `You are a professional YouTube SEO & viral content strategist.
Generate exactly ${requestedCount} unique, highly engaging, click-worthy, and SEO-friendly YouTube live streaming titles.
${topicContext ? `Context / Topic:\n${topicContext}` : 'Topic: General Live Stream'}

Output format rules:
- Provide exactly ${requestedCount} titles.
- Exactly one title per line.
- Do NOT include numbers, bullet points, asterisks, or quotes.
- Keep titles natural, compelling, and relevant.`;
    }
  } else {
    if (imgBase64) {
      prompt = `Kamu adalah seorang pakar YouTube SEO dan spesialis judul viral untuk siaran langsung (live streaming).
Analisis gambar thumbnail ini secara menyeluruh: perhatikan tema visual, suasana, tulisan di gambar, dan konteksnya.
Buatkan tepat ${requestedCount} judul live streaming YouTube yang SANGAT COCOK dan relevan dengan gambar ini. Judul harus menarik, click-worthy, natural, dan ramah algoritma YouTube.
${topicContext ? `\nKonteks Tambahan:\n${topicContext}` : ''}

Aturan format output:
- Tuliskan tepat ${requestedCount} judul.
- Setiap baris HANYA berisi 1 judul.
- JANGAN sertakan nomor (1., 2.), tanda strip, bullet points, tanda bintang (**), atau tanda kutip.
- Tulis langsung teks judulnya saja.`;
    } else {
      prompt = `Kamu adalah seorang pakar YouTube SEO dan spesialis judul viral untuk siaran langsung (live streaming).
Buatkan tepat ${requestedCount} judul live streaming YouTube yang SANGAT MENARIK, click-worthy, bervariasi, dan ramah algoritma YouTube.
${topicContext ? `Konteks / Topik / Tema Video:\n${topicContext}` : 'Topik: Live Streaming Populer'}

Aturan format output:
- Tuliskan tepat ${requestedCount} judul.
- Setiap baris HANYA berisi 1 judul.
- JANGAN sertakan nomor (1., 2.), tanda strip, bullet points, tanda bintang (**), atau tanda kutip.
- Tulis langsung teks judulnya saja.`;
    }
  }

  const parts = [{ text: prompt }];
  if (imgBase64) {
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: imgBase64
      }
    });
  }

  const payload = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.75,
      maxOutputTokens: 2048
    }
  });

  let lastError = null;
  for (const model of FALLBACK_MODELS) {
    try {
      const rawText = await callSingleModel(model, payload, apiKey);
      const titles = rawText
        .split('\n')
        .map(line => line.replace(/^[\d\s.\-*#">•"']+|\s*["']$/g, '').trim())
        .filter(line => line.length > 5);

      if (titles.length > 0) {
        return {
          success: true,
          count: titles.length,
          modelUsed: model,
          titles: titles.slice(0, requestedCount)
        };
      }
    } catch (err) {
      console.warn(`[Gemini AI] Model ${model} gagal: ${err.message}. Mencoba model berikutnya...`);
      lastError = err;
    }
  }

  throw new Error(lastError ? lastError.message : 'Semua model Gemini sedang sibuk. Silakan coba sesaat lagi.');
}

module.exports = {
  generateTitlesFromImage
};
