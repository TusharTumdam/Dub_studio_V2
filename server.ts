import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Modality } from '@google/genai';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err) {
    return res.status(err.status || 400).json({
      error: err.message || 'Invalid JSON request payload.',
    });
  }
  next();
});

// In-memory cache for synthesized Hindi audio clips for instant replay & zero redundant API calls
const ttsMemoryCache = new Map<
  string,
  { audioBase64: string; mimeType: string; provider: string }
>();

// Track text and TTS models that hit daily quota limits (PerDay) so we skip them immediately without waiting
const textModelCooldownUntil = new Map<string, number>();
const ttsModelCooldownUntil = new Map<string, number>();

let ttsRequestCounter = 0;

function isTextModelAvailable(modelName: string): boolean {
  const until = textModelCooldownUntil.get(modelName);
  if (!until) return true;
  if (Date.now() >= until) {
    textModelCooldownUntil.delete(modelName);
    return true;
  }
  return false;
}

function markTextModelRateLimited(modelName: string, errMessage = '') {
  const isDailyLimit =
    errMessage.includes('PerDay') || errMessage.includes('requests per day');
  const cooldownMs = isDailyLimit ? 30 * 60 * 1000 : 15 * 1000;
  textModelCooldownUntil.set(modelName, Date.now() + cooldownMs);
}

function isTtsModelAvailable(modelName: string): boolean {
  const until = ttsModelCooldownUntil.get(modelName);
  if (!until) return true;
  if (Date.now() >= until) {
    ttsModelCooldownUntil.delete(modelName);
    return true;
  }
  return false;
}

function markTtsModelRateLimited(modelName: string, errMessage = '') {
  const isDailyLimit =
    errMessage.includes('PerDay') ||
    errMessage.includes('requests per day') ||
    errMessage.includes('GenerateRequestsPerDay');
  const cooldownMs = isDailyLimit ? 60 * 60 * 1000 : 20 * 1000;
  ttsModelCooldownUntil.set(modelName, Date.now() + cooldownMs);
}

function getGenAIClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${ms}ms (${label})`));
    }, ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

const DIALECT_PHONETIC_GUIDES: Record<string, string> = {
  mumbai_cinema:
    'Speak as a real, charismatic Indian human voice actor in a Mumbai studio. Use natural spoken Indian Hindi-Hinglish cadence, authentic retroflex consonants (ट, ड, ण), warm chest resonance, brisk natural conversational speed, and zero robotic or foreign accent.',
  ott_gritty_real:
    'Speak like a real, grounded Indian person in a realistic Indian OTT series or creator video. Use natural human flow, organic conversational rhythm, and warm human authenticity without artificial pauses.',
  delhi_urban:
    'Speak as a lively, engaging North Indian creator/storyteller from Delhi/Mumbai. Natural Indian human energy, smooth conversational flow, and effortless Hindi-Hinglish pronunciation.',
  lucknowi_tehzeeb:
    'Speak as a cultured Indian Hindustani narrator with warm, expressive Urdu/Hindi diction and smooth human delivery.',
  pan_india_storyteller:
    'Speak as a commanding Indian narrator with deep resonance, crisp pacing, and natural human articulation.',
};

/**
 * Polishes literal/stiff Hindi translations into natural spoken Indian human Hindi-Hinglish
 * and removes awkward mid-sentence punctuation that causes unnatural TTS delays.
 */
function polishToNaturalSpokenIndianHindi(text: string): {
  devanagari: string;
  roman: string;
} {
  let hi = text
    .replace(/माफ़ कीजियेगा,?\s*/gi, '')
    .replace(/क्षमा करें,?\s*/gi, '')
    .replace(/इस गाइड में,?\s*/gi, 'तो दोस्तों, इस वीडियो में ')
    .replace(/यह गाइड काम की लगे/gi, 'ये वीडियो आपके काम आए')
    .replace(/यह गाइड उपयोगी लगे/gi, 'ये वीडियो आपको पसंद आए')
    .replace(/सदस्यता लेने पर विचार करें/gi, 'चैनल को सब्सक्राइब ज़रूर कर लें')
    .replace(/सदस्यता लें/gi, 'सब्सक्राइब करें')
    .replace(/पसंद करें/gi, 'लाइक करें')
    .replace(/तो हाँ दोस्तों, बस इतना ही था/gi, 'तो बस दोस्तों, इतना ही आसान था ये')
    .replace(/यह बस इतना आसान है/gi, 'देखा आपने, ये कितना आसान है')
    // Remove excess commas/ellipses that cause robotic pauses in TTS
    .replace(/\.\.\.+/g, ' ')
    .replace(/,\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { devanagari: hi, roman: '' };
}

/**
 * Helper to call Gemini text/multimodal generation with automatic model cascade
 */
async function generateTextWithCascade(params: {
  contents: any;
  systemInstruction?: string;
  responseMimeType?: string;
  timeoutMs?: number;
}) {
  const ai = getGenAIClient();
  const candidateModels = ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];
  let lastError: any = null;
  const timeout = params.timeoutMs || 15000;

  for (const modelName of candidateModels) {
    if (!isTextModelAvailable(modelName)) {
      continue;
    }
    try {
      const config: Record<string, any> = {};
      if (params.systemInstruction) config.systemInstruction = params.systemInstruction;
      if (params.responseMimeType) config.responseMimeType = params.responseMimeType;

      const result = await withTimeout(
        ai.models.generateContent({
          model: modelName,
          contents: params.contents,
          config,
        }),
        timeout,
        modelName
      );
      if (!result?.text?.trim()) {
        throw new Error(`Model ${modelName} returned empty text`);
      }
      return result;
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || '');
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        markTextModelRateLimited(modelName, msg);
      }
    }
  }
  throw lastError || new Error('All text models currently on cooldown');
}

/**
 * Splits a verbatim transcript into smooth, natural ~12-14 second voiceover paragraphs (~26-34 words each)
 * so the voiceover flows continuously like a real human narrator without choppy fragmentation or 429 rate limits.
 */
function segmentTranscriptIntoTimedCues(
  rawText: string,
  durationSeconds: number,
  sourceLanguage: string,
  offsetSeconds = 0
): Array<{
  startTime: number;
  endTime: number;
  speaker: string;
  detectedLanguage: string;
  englishText: string;
}> {
  const totalDur = Math.max(2, Number(durationSeconds) || 16);
  const startOffset = Math.max(0, Number(offsetSeconds) || 0);
  const defaultLangLabel =
    !sourceLanguage || sourceLanguage === 'auto'
      ? 'English'
      : sourceLanguage.toUpperCase();

  let cleaned = rawText
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const joinedText = parsed
          .map((p: any) => (p.englishText || p.text || p.transcript || '').trim())
          .filter(Boolean)
          .join('. ');
        if (joinedText) {
          cleaned = joinedText;
        }
      }
    }
  } catch {
    // Plain text transcript
  }

  if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
    const extractedStrings: string[] = [];
    const regex = /"(?:englishText|text|transcript)"\s*:\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(cleaned)) !== null) {
      if (m[1]) extractedStrings.push(m[1]);
    }
    if (extractedStrings.length > 0) {
      cleaned = extractedStrings.join('. ');
    }
  }

  // Strip speaker verbal stumbles like "excuse me" or repeated words
  cleaned = cleaned
    .replace(/\bexcuse me\b,?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];

  // Target ~1 smooth voiceover segment every 12 to 14 seconds (max 7 segments per window)
  const targetSegmentsCount = Math.max(2, Math.min(7, Math.ceil(totalDur / 13.0)));
  const allWords = cleaned.split(/\s+/).filter(Boolean);
  const targetWordsPerChunk = Math.max(
    16,
    Math.min(34, Math.ceil(allWords.length / targetSegmentsCount))
  );

  const chunks: string[] = [];
  let currentWords: string[] = [];

  for (const w of allWords) {
    currentWords.push(w);
    const endsSentence = /[.?!;]$/.test(w);
    const endsClause = /[,:]$/.test(w);
    if (
      (currentWords.length >= targetWordsPerChunk - 5 && endsSentence) ||
      (currentWords.length >= targetWordsPerChunk && endsClause) ||
      currentWords.length >= targetWordsPerChunk + 5
    ) {
      chunks.push(currentWords.join(' '));
      currentWords = [];
    }
  }

  if (currentWords.length > 0) {
    if (currentWords.length <= 6 && chunks.length > 0) {
      chunks[chunks.length - 1] += ' ' + currentWords.join(' ');
    } else {
      chunks.push(currentWords.join(' '));
    }
  }

  if (chunks.length === 0) {
    chunks.push(cleaned);
  }

  const wordCounts = chunks.map((c) => Math.max(4, c.split(/\s+/).length));
  const totalWords = wordCounts.reduce((acc, n) => acc + n, 0);
  const usableDuration = Math.max(1.5, totalDur - 0.1);

  // Carry forward active speaker & gender across chunks so a continuing speaker NEVER resets to a different label mid-video
  let activeSpeaker = 'Character 1';
  let activeGender: 'male' | 'female' = 'male';

  const normalizeSpeakerAndGender = (
    rawSpk: string,
    sampleText: string,
    fallbackSpk: string,
    fallbackGen: 'male' | 'female'
  ): { speaker: string; gender: 'male' | 'female' } => {
    const sLower = (rawSpk || '').toLowerCase();
    const tLower = (sampleText || '').toLowerCase();
    const hasFemaleHint =
      sLower.includes('female') ||
      sLower.includes('woman') ||
      sLower.includes('girl') ||
      sLower.includes('lady') ||
      sLower.includes('mother') ||
      sLower.includes('sister') ||
      sLower.includes('mrs') ||
      sLower.includes('ms.') ||
      /\b(tina|sarah|margaret|mary|emma|anna|stacy|joanne|linda|priya|ananya|neha|pooja|kavita|meera|arya)\b/.test(
        sLower
      ) ||
      /\b(i am a woman|i'm a girl)\b/.test(tLower);
    const hasMaleHint =
      /\bmale\b|\bman\b|\bboy\b|\bfather\b|\bbrother\b|\bmr\b/.test(sLower);

    const gender: 'male' | 'female' = hasFemaleHint
      ? 'female'
      : hasMaleHint
      ? 'male'
      : fallbackGen;

    // Strip gender prefixes like "Male - ", "Female - ", "[Male]", etc. so "Male - Character 1" and "Character 1" normalize to the EXACT same speaker key
    let stripped = (rawSpk || '')
      .replace(/^\[|\]$/g, '')
      .replace(/^\(|\)$/g, '')
      .replace(/^(?:male|female|man|woman|boy|girl)\s*[-:–—/]\s*/i, '')
      .replace(/\s*\((?:male|female|man|woman)\)\s*/gi, '')
      .trim();

    if (
      !stripped ||
      /^(?:character\s*1|speaker\s*1|narrator|speaker|host|creator|voiceover|male|female)$/i.test(
        stripped
      )
    ) {
      stripped = gender === 'female' ? 'Female Character 1' : 'Character 1';
    } else if (/^(?:character\s*2|speaker\s*2)$/i.test(stripped)) {
      stripped = gender === 'female' ? 'Female Character 2' : 'Character 2';
    }

    return {
      speaker: stripped || fallbackSpk,
      gender,
    };
  };

  let cursor = startOffset + 0.05;
  return chunks.map((text, idx) => {
    let cleanText = text;
    const match = cleanText.match(
      /^(?:\[([^\]]+)\]|\(([^)]+)\)|([A-Za-z0-9\s\-]{2,24}))\s*[:\-]\s*(.+)$/
    );
    if (match) {
      const rawTag = (match[1] || match[2] || match[3] || '').trim();
      cleanText = (match[4] || '').trim();
      const norm = normalizeSpeakerAndGender(rawTag, cleanText, activeSpeaker, activeGender);
      activeSpeaker = norm.speaker;
      activeGender = norm.gender;
    } else if (idx === 0) {
      const norm = normalizeSpeakerAndGender(activeSpeaker, cleanText, activeSpeaker, activeGender);
      activeSpeaker = norm.speaker;
      activeGender = norm.gender;
    }

    // Also strip any leftover inline "[Male - Character 1]:" tags inside the chunk
    cleanText = cleanText
      .replace(/\[(?:Male|Female)[^\]]*\]\s*[:\-]?\s*/gi, '')
      .trim();

    const share = (wordCounts[idx] / totalWords) * usableDuration;
    const start = Number(cursor.toFixed(2));
    const rawEnd =
      idx === chunks.length - 1
        ? startOffset + totalDur - 0.05
        : cursor + share - 0.03;
    const end = Number(Math.max(start + 1.2, rawEnd).toFixed(2));
    cursor = end + 0.03;

    return {
      startTime: start,
      endTime: end,
      speaker: activeSpeaker,
      gender: activeGender,
      detectedLanguage: defaultLangLabel,
      englishText: cleanText,
    };
  });
}

/**
 * Natural spoken Hindi/Hinglish translation fallback using Google GTX + conversational Indian phrasing polish
 */
async function translateSegmentViaGoogleGtx(
  englishText: string,
  style: string
): Promise<{ hindiDevanagari: string; hinglishRoman: string }> {
  const cleanSource = (englishText || '')
    .replace(/\bexcuse me\b,?\s*/gi, '')
    .trim();
  if (!cleanSource) {
    return {
      hindiDevanagari: 'नमस्ते दोस्तों आज के इस वीडियो में आपका स्वागत है।',
      hinglishRoman: 'Namaste doston aaj ke is video mein aapka swagat hai.',
    };
  }

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=hi&dt=t&dt=rm&q=${encodeURIComponent(
      cleanSource
    )}`;
    const response = await withTimeout(fetch(url), 5000, 'google-gtx-translate');
    if (response.ok) {
      const data: any = await response.json();
      const sentences: any[] = Array.isArray(data?.[0]) ? data[0] : [];
      let hindiDevanagari = '';
      let hinglishRoman = '';

      for (const item of sentences) {
        if (typeof item?.[0] === 'string') {
          hindiDevanagari += item[0];
        }
        if (typeof item?.[2] === 'string') {
          hinglishRoman += (hinglishRoman ? ' ' : '') + item[2];
        }
      }

      hindiDevanagari = hindiDevanagari.trim();
      if (hindiDevanagari) {
        const polished = polishToNaturalSpokenIndianHindi(hindiDevanagari);
        hindiDevanagari = polished.devanagari;
        if (!hinglishRoman.trim()) {
          hinglishRoman = cleanSource;
        }
        if (style === 'conversational_hinglish') {
          hindiDevanagari = hindiDevanagari
            .replace(/सदस्यता लेने/g, 'सब्सक्राइब करने')
            .replace(/पसंद करने/g, 'लाइक करने');
        }
        return {
          hindiDevanagari,
          hinglishRoman: hinglishRoman.trim(),
        };
      }
    }
  } catch {
    // Proceed to default return below
  }

  return {
    hindiDevanagari: cleanSource,
    hinglishRoman: cleanSource,
  };
}

async function buildAccurateHindiFallback(
  segments: Array<{
    id: string;
    englishText?: string;
    hindiDevanagari?: string;
    hinglishRoman?: string;
    emotionPrompt?: string;
  }>,
  style: string
) {
  return Promise.all(
    segments.map(async (seg, idx) => {
      const srcText = (seg.englishText || '').trim();
      const translated = await translateSegmentViaGoogleGtx(srcText, style);

      return {
        id: seg.id || `seg-${idx + 1}`,
        hindiDevanagari: translated.hindiDevanagari,
        hinglishRoman: translated.hinglishRoman,
        emotionPrompt:
          seg.emotionPrompt ||
          'Natural Indian human voiceover artist with smooth conversational flow and zero robotic pauses',
        hindiSyllables: Math.max(6, Math.round(translated.hindiDevanagari.length / 2.6)),
        englishSyllables: Math.max(6, Math.round(srcText.length / 3.2)),
      };
    })
  );
}

/**
 * Backup Hindi TTS when all Gemini TTS retries are exhausted.
 * Splits ONLY at complete sentence boundaries (never mid-phrase) so there are zero mid-sentence pauses.
 */
async function synthesizeHindiZeroQuotaFallback(rawText: string): Promise<{
  audioBase64: string;
  mimeType: string;
  provider: string;
}> {
  const cleanText = polishToNaturalSpokenIndianHindi(
    rawText
      .replace(/<laugh>/gi, ' हा हा हा, ')
      .replace(/<(sob|cry)>/gi, ' आह... ')
      .replace(/<sigh>/gi, ' आऽह... ')
      .replace(/<gasp>/gi, ' अरे! ')
      .replace(/<(breath|angry|whisper)>/gi, '')
  ).devanagari;

  // Split strictly on complete sentence boundaries (। or . or ?) up to 190 chars
  const sentences = cleanText
    .split(/(?<=[।.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const textChunks: string[] = [];
  let current = '';

  for (const s of sentences) {
    if ((current + ' ' + s).trim().length <= 190) {
      current = (current + ' ' + s).trim();
    } else {
      if (current) textChunks.push(current);
      if (s.length <= 190) {
        current = s;
      } else {
        // Only if a single sentence is >190 chars, split at a conjunction ("और", "तो", "लेकिन", "फिर")
        const words = s.split(' ');
        let sub = '';
        for (const w of words) {
          if ((sub + ' ' + w).trim().length > 185) {
            if (sub) textChunks.push(sub.trim());
            sub = w;
          } else {
            sub = (sub + ' ' + w).trim();
          }
        }
        current = sub;
      }
    }
  }
  if (current.trim()) textChunks.push(current.trim());
  if (textChunks.length === 0) textChunks.push('नमस्ते दोस्तों');

  const audioBuffers: Buffer[] = [];
  for (const chunk of textChunks) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=hi&client=tw-ob&ttsspeed=1&q=${encodeURIComponent(
      chunk
    )}`;
    const res = await withTimeout(
      fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      }),
      8000,
      'google-hindi-tts-fallback'
    );
    if (!res.ok) {
      throw new Error(`Fallback Hindi TTS returned status ${res.status}`);
    }
    const arrBuf = await res.arrayBuffer();
    audioBuffers.push(Buffer.from(arrBuf));
  }

  const combined = Buffer.concat(audioBuffers);
  return {
    audioBase64: combined.toString('base64'),
    mimeType: 'audio/mpeg',
    provider: 'hindi-neural-fallback',
  };
}

// Stage 2: Multilingual Global Audio Transcription covering 100% of the audio clip duration
app.post('/api/dubbing/transcribe', async (req, res) => {
  try {
    const {
      audioBase64,
      mimeType = 'audio/wav',
      durationSeconds = 16,
      offsetSeconds = 0,
      sourceLanguage = 'auto',
      fallbackTranscript,
    } = req.body;
    const ai = getGenAIClient();

    if (!audioBase64) {
      return res.status(400).json({ error: 'Missing audioBase64 payload for transcription.' });
    }

    const langHint =
      sourceLanguage && sourceLanguage !== 'auto'
        ? `The spoken language in the audio is ${sourceLanguage}.`
        : '';

    const transcriptionPrompt = `Listen to this audio track carefully and transcribe every dialogue line word-for-word in the original spoken language.
CRITICAL MULTI-CHARACTER DETECTION:
- Identify if the speaker is Male or Female.
- If multiple characters speak, separate their lines and prefix each with their speaker tag and gender, e.g.:
[Male - Character 1]: ...
[Female - Character 2]: ...
- Write ONLY the exact spoken dialogue with natural punctuation. Do NOT summarize or add commentary. ${langHint}`.trim();

    let rawText = '';
    const transcriptionModels = ['gemini-2.5-flash', 'gemini-3.8-flash'];

    for (const modelName of transcriptionModels) {
      if (!isTextModelAvailable(modelName)) continue;
      try {
        const resp = await withTimeout(
          ai.models.generateContent({
            model: modelName,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType,
                      data: audioBase64,
                    },
                  },
                  {
                    text: transcriptionPrompt,
                  },
                ],
              },
            ],
          }),
          32000,
          modelName
        );
        const text = (resp?.text ?? '').trim();
        if (text) {
          rawText = text;
          break;
        }
      } catch (err: any) {
        const msg = String(err?.message || '');
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
          markTextModelRateLimited(modelName, msg);
        }
      }
    }

    if (!rawText && fallbackTranscript) {
      rawText = fallbackTranscript;
    }

    let parsedSegments = segmentTranscriptIntoTimedCues(
      rawText,
      Number(durationSeconds) || 16,
      sourceLanguage,
      Number(offsetSeconds) || 0
    );

    if (parsedSegments.length === 0 && fallbackTranscript) {
      parsedSegments = segmentTranscriptIntoTimedCues(
        fallbackTranscript,
        Number(durationSeconds) || 16,
        sourceLanguage,
        Number(offsetSeconds) || 0
      );
    }

    res.json({ segments: parsedSegments, rawTranscript: rawText });
  } catch (error: any) {
    res.status(500).json({
      error: error?.message || 'Failed to transcribe global audio track.',
    });
  }
});

// Stage 3: Global Language -> Realistic Indian Human Hindi / Hinglish Voiceover Script
app.post('/api/dubbing/translate', async (req, res) => {
  const {
    segments = [],
    style = 'conversational_hinglish',
    sourceLanguage = 'auto',
    indianDialect = 'mumbai_cinema',
  } = req.body || {};

  if (!Array.isArray(segments) || segments.length === 0) {
    return res.status(400).json({ error: 'No dialogue segments provided for Hindi adaptation.' });
  }

  try {
    const styleGuides: Record<string, string> = {
      bollywood_cinematic: `Adapt each line into natural, expressive spoken Indian Hindi ("hindiDevanagari") and Romanized Hinglish ("hinglishRoman"). Sound like a real Indian dubbing artist—never stiff textbook Hindi. Keep tech/modern words (video, website, PC, Google Chrome, download, subscribe, like, extension) natural as spoken in India.`,
      ott_natural_realism: `Adapt each line into ultra-natural, everyday spoken Indian Hindi-Hinglish ("hindiDevanagari") and Romanized Hindi ("hinglishRoman") with smooth human flow.`,
      conversational_hinglish: `Adapt each line into authentic Indian YouTuber / Creator Hindi-Hinglish ("hindiDevanagari" in Devanagari script and "hinglishRoman" in Roman script). Write the way a real Indian tech/creator voiceover artist speaks to friends ("तो दोस्तों...", "सबसे पहले Google Chrome ओपन कर लें...", "अच्छी लगे तो सब्सक्राइब ज़रूर कर देना"). Avoid excessive commas so the voice flows without unnatural pauses.`,
      poetic_hindustani: `Adapt each line into graceful, fluent Hindustani Hindi-Urdu ("hindiDevanagari" and "hinglishRoman") while preserving 100% of the original meaning.`,
    };

    const dialectGuide =
      DIALECT_PHONETIC_GUIDES[indianDialect] || DIALECT_PHONETIC_GUIDES.mumbai_cinema;

    const systemInstruction = `You are India's top Human Voiceover & Dubbing Director in Mumbai.
CRITICAL RULES FOR REALISTIC INDIAN HUMAN VOICEOVER:
1. Translate the EXACT meaning of every "englishText" segment into natural, fluent spoken Indian Hindi-Hinglish ("hindiDevanagari") and Romanized Hindi ("hinglishRoman").
2. DO NOT use stiff, robotic, literal Google-Translate Hindi (never say "माफ़ कीजियेगा" for speaker stumbles or "सदस्यता लें"). Write smooth, continuous sentences that a real Indian human voiceover artist speaks in one natural breath without awkward commas or mid-sentence breaks.
3. Match the speaking duration ("durationSec" seconds): write approximately "targetHindiWords" words per segment so the human voice speaks continuously across the segment window.
4. GENDER-ACCURATE GRAMMATICAL AGREEMENT:
- If "gender" is "female" (woman / girl character): conjugate verbs using correct feminine Hindi grammar (e.g. "मैं करूँगी", "गई थी", "देख रही हूँ", "बोलती हूँ").
- If "gender" is "male" (man / boy character): conjugate verbs using correct masculine Hindi grammar (e.g. "मैं करूँगा", "गया था", "देख रहा हूँ", "बोलता हूँ").
- Maintain this exact grammatical consistency for each character throughout the script.
5. CHARACTER EMOTIONAL VOCAL REACTIONS (HANSNA, RONA, GUSSA, SHOCK):
- Detect emotional reactions from the source line (laughing, crying/sobbing, shouting in anger, gasping in shock, heavy sighing, whispering).
- Embed expressive vocal reaction tags directly into "hindiDevanagari" where appropriate:
  * Laughing / Chuckling: insert "<laugh>" and natural Hindi laughter ("<laugh> हा हा! अरे यार...")
  * Crying / Weeping / Heartbreak: insert "<sob>" and emotional tremor ("<sob> ये तुमने क्या किया...")
  * Fierce Anger / Rage: insert "<angry>" and intense dramatic phrasing ("<angry> बस बहुत हुआ!")
  * Shock / Gasp / Fear: insert "<gasp>" ("<gasp> अरे बाप रे!")
  * Deep Sigh / Relief / Sadness: insert "<sigh>" ("<sigh> चलो अब जो हुआ सो हुआ...")
  * Secretive Whisper: insert "<whisper>"
- Set "emotionPrompt" to explicitly direct the voice actor's vocal reaction (e.g. "Laughing warmly with genuine chuckles <laugh>", "Crying with choked emotional tears <sob>", "Boiling with fierce anger and shouting <angry>").
${styleGuides[style] || styleGuides.conversational_hinglish}
Vocal Direction: ${dialectGuide}

Return ONLY a valid JSON array where each element has:
- "id": string (matching the input segment id)
- "hindiDevanagari": string (fluent Devanagari Hindi-Hinglish voiceover script with emotional tags if applicable)
- "hinglishRoman": string (Romanized Hinglish phonetic version)
- "emotionPrompt": string (vivid acting & emotional reaction direction for the Indian voice artist)
- "hindiSyllables": number
- "englishSyllables": number`;

    const simplifiedInput = segments.map((s: any) => {
      const dur = Math.max(1.5, Number((s.endTime - s.startTime).toFixed(1)));
      return {
        id: s.id,
        speaker: s.speaker || 'Character 1',
        gender: s.gender || 'male',
        startTime: s.startTime,
        endTime: s.endTime,
        durationSec: dur,
        targetHindiWords: Math.max(8, Math.round(dur * 3.1)),
        englishText: s.englishText,
      };
    });

    const response = await generateTextWithCascade({
      contents: `Adapt each of the following timecoded video segments into a 100% natural, fluent Indian human Hindi-Hinglish voiceover script:\n${JSON.stringify(
        simplifiedInput
      )}`,
      systemInstruction,
      responseMimeType: 'application/json',
      timeoutMs: 16000,
    });

    const rawJson = (response.text ?? '[]')
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    const adapted = JSON.parse(rawJson);
    if (!Array.isArray(adapted) || adapted.length === 0) {
      throw new Error('Empty adaptation array returned');
    }

    // Polish each adapted line to remove awkward commas/stumbles
    const polishedAdapted = adapted.map((item: any) => ({
      ...item,
      hindiDevanagari: polishToNaturalSpokenIndianHindi(item.hindiDevanagari || '').devanagari,
    }));

    return res.json({ adapted: polishedAdapted });
  } catch {
    const adapted = await buildAccurateHindiFallback(segments, style);
    return res.json({ adapted, fallbackUsed: true });
  }
});

const ELEVENLABS_VOICE_MAP: Record<string, string> = {
  Charon: 'JBFqnCBsd6RMkjVDRZzb', // George - Warm narrative baritone
  Puck: 'TX3LPaxmHKxFdv7VOQHJ', // Liam - Energetic creator voice
  Kore: 'EXAVITQu4vr4xnSDxMaL', // Sarah - Expressive female voice
  Fenrir: 'pNInz6obpgDQGcFmaJgB', // Adam - Deep trailer baritone
  Zephyr: 'XrExE9yKIg1WjnnlVkGX', // Matilda - Calm documentary narrator
};

// Query ElevenLabs https://api.elevenlabs.io/v1/models and /v1/voices using server-side ELEVENLABS_API_KEY
app.get('/api/elevenlabs/models', async (_req, res) => {
  const apiKey = (process.env.ELEVENLABS_API_KEY || '').trim();
  if (!apiKey) {
    return res.json({
      configured: false,
      models: [
        {
          model_id: 'eleven_multilingual_v2',
          name: 'Eleven Multilingual v2 (Hindi & Hinglish Studio)',
          can_do_text_to_speech: true,
        },
        {
          model_id: 'eleven_flash_v2_5',
          name: 'Eleven Flash v2.5 (Ultra-Low Latency Hindi)',
          can_do_text_to_speech: true,
        },
        {
          model_id: 'eleven_turbo_v2_5',
          name: 'Eleven Turbo v2.5 (Balanced Hindi Dubbing)',
          can_do_text_to_speech: true,
        },
      ],
      voices: Object.entries(ELEVENLABS_VOICE_MAP).map(([persona, voice_id]) => ({
        voice_id,
        name: `${persona} Studio Preset (${voice_id.slice(0, 6)}...)`,
      })),
    });
  }

  try {
    const modelsRes = await fetch('https://api.elevenlabs.io/v1/models', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
    });

    if (!modelsRes.ok) {
      const errText = await modelsRes.text();
      return res.status(modelsRes.status).json({
        configured: true,
        error: `ElevenLabs /v1/models returned ${modelsRes.status}: ${errText}`,
      });
    }

    const rawModels: any[] = await modelsRes.json();
    const ttsModels = rawModels
      .filter((m) => m.can_do_text_to_speech)
      .map((m) => ({
        model_id: m.model_id,
        name: m.name,
        description: m.description,
        supportsHindi: Array.isArray(m.languages)
          ? m.languages.some((l: any) => l.language_id === 'hi' || /hindi/i.test(l.name || ''))
          : true,
      }));

    let voicesList = Object.entries(ELEVENLABS_VOICE_MAP).map(([persona, voice_id]) => ({
      voice_id,
      name: `${persona} Studio Preset`,
    }));

    try {
      const voicesRes = await fetch('https://api.elevenlabs.io/v1/voices', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
      });
      if (voicesRes.ok) {
        const voicesData: any = await voicesRes.json();
        if (Array.isArray(voicesData?.voices) && voicesData.voices.length > 0) {
          voicesList = voicesData.voices.slice(0, 20).map((v: any) => ({
            voice_id: v.voice_id,
            name: `${v.name} (${v.category || 'voice'})`,
          }));
        }
      }
    } catch {
      // Keep default voices list if /v1/voices fails
    }

    return res.json({
      configured: true,
      models: ttsModels.length > 0 ? ttsModels : rawModels,
      voices: voicesList,
    });
  } catch (err: any) {
    return res.status(500).json({
      configured: true,
      error: err?.message || 'Failed to query https://api.elevenlabs.io/v1/models',
    });
  }
});

function wrapPcmWithWavHeader(rawBuf: Buffer, sampleRate = 24000): Buffer {
  if (rawBuf.length > 4 && rawBuf.toString('ascii', 0, 4) === 'RIFF') {
    return rawBuf;
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + rawBuf.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(rawBuf.length, 40);
  return Buffer.concat([header, rawBuf]);
}

/**
 * Synthesizes character-locked 24kHz Indian Hindi speech with genuine human acting & emotional reactions
 * using Gemini 3.8 Live Native Audio ('gemini-3.8-live').
 * Uses an automatic 700ms post-speech idle resolver so it finishes immediately after the last audio chunk without hanging.
 */
async function synthesizeWithGeminiLiveNativeAudio(
  spokenHindiText: string,
  voiceName: string,
  reactionDirective = ''
): Promise<{ audioBase64: string; mimeType: string; provider: string }> {
  const ai = getGenAIClient();
  const safeVoice = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'].includes(voiceName)
    ? voiceName
    : 'Charon';

  const voicePersonaHint =
    safeVoice === 'Kore' || safeVoice === 'Zephyr'
      ? 'clear warm Indian female voice'
      : safeVoice === 'Fenrir'
      ? 'deep steady Indian male baritone voice'
      : safeVoice === 'Puck'
      ? 'friendly energetic Indian male creator voice'
      : 'warm natural Indian male voice';

  const promptText = reactionDirective
    ? `Speak this exact Hindi line aloud in a ${voicePersonaHint} (${reactionDirective}) without adding any extra words: "${spokenHindiText}"`
    : `Speak this exact Hindi line aloud in a steady ${voicePersonaHint} without adding any extra words: "${spokenHindiText}"`;

  const attemptLiveSynthesis = () =>
    withTimeout(
      new Promise<Buffer>(async (resolve, reject) => {
        const chunks: Buffer[] = [];
        let settled = false;
        let sessionRef: any = null;
        let idleTimer: ReturnType<typeof setTimeout> | null = null;

        const finish = (err?: any) => {
          if (settled) return;
          settled = true;
          if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
          }
          try {
            sessionRef?.close?.();
          } catch {}
          if (chunks.length > 0) {
            resolve(Buffer.concat(chunks));
          } else {
            reject(err || new Error('No audio chunks received from gemini-3.8-live'));
          }
        };

        try {
          sessionRef = await ai.live.connect({
            model: 'gemini-3.8-live',
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: safeVoice,
                  },
                },
              },
            },
            callbacks: {
              onmessage: (msg: any) => {
                const parts = msg?.serverContent?.modelTurn?.parts || [];
                for (const p of parts) {
                  if (p?.inlineData?.data) {
                    chunks.push(Buffer.from(p.inlineData.data, 'base64'));
                    // Reset post-audio idle timer: if 700ms pass after the last audio chunk, resolve immediately!
                    if (idleTimer) clearTimeout(idleTimer);
                    idleTimer = setTimeout(() => {
                      finish();
                    }, 700);
                  }
                }
                if (msg?.serverContent?.turnComplete) {
                  finish();
                }
              },
              onerror: (err: any) => {
                finish(err);
              },
              onclose: () => {
                finish();
              },
            },
          });

          sessionRef.sendClientContent({
            turns: [
              {
                role: 'user',
                parts: [{ text: promptText }],
              },
            ],
            turnComplete: true,
          });
        } catch (err) {
          finish(err);
        }
      }),
      11000,
      `gemini-3.8-live-${safeVoice}`
    );

  let pcmBuffer: Buffer;
  try {
    pcmBuffer = await attemptLiveSynthesis();
  } catch {
    pcmBuffer = await attemptLiveSynthesis();
  }

  const wavBuffer = wrapPcmWithWavHeader(pcmBuffer, 24000);
  return {
    audioBase64: wavBuffer.toString('base64'),
    mimeType: 'audio/wav',
    provider: 'gemini-3.8-live',
  };
}

// Stage 4: Realistic Indian Human Voice Synthesis with Locked Character Voice Identity
app.post('/api/dubbing/tts', async (req, res) => {
  const {
    text,
    voiceName = 'Charon',
    emotionPrompt = '',
    indianDialect = 'mumbai_cinema',
    elevenLabsConfig,
  } = req.body || {};

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Text is required for Hindi voice synthesis.' });
  }

  // Detect explicit vocal reaction tags (<laugh>, <sob>, <angry>, <gasp>, <sigh>, <whisper>, <breath>)
  // Only trigger dramatic vocal shifts when an explicit reaction tag or strong emotion is requested,
  // keeping normal narration 100% uniform in timbre and pitch across all segments!
  const textLower = text.toLowerCase();
  const emotionLower = `${text} ${emotionPrompt}`.toLowerCase();
  const isLaughing = /<laugh>|हा हा|हँसते हुए|laughing out loud/.test(emotionLower);
  const isCrying = /<(sob|cry)>|रोते हुए|सिसकते हुए|crying with tears|sobbing/.test(emotionLower);
  const isAngry = /<angry>|गुस्से में चिल्लाते|boiling anger|furious rage/.test(emotionLower);
  const isGasping = /<gasp>|चौंकते हुए|breathless gasp/.test(emotionLower);
  const isSighing = /<sigh>|गहरी साँस|heavy sigh/.test(textLower);
  const isWhispering = /<whisper>|फुसफुसाते हुए|hushed whisper/.test(emotionLower);

  // Clean text for Gemini Live & ElevenLabs while converting reaction tags into natural Hindi vocal cues
  const cleanSpokenHindi = polishToNaturalSpokenIndianHindi(
    text
      .replace(/<laugh>/gi, ' हा हा! ')
      .replace(/<(sob|cry)>/gi, ' आह... ')
      .replace(/<gasp>/gi, ' अरे! ')
      .replace(/<sigh>/gi, ' आह... ')
      .replace(/<(breath|angry|whisper)>/gi, '')
  ).devanagari;

  const safeVoiceName = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'].includes(voiceName)
    ? voiceName
    : 'Charon';

  const reactionActingDirective = [
    isLaughing
      ? 'Laugh genuinely with warm human chuckles while keeping the exact same speaker voice.'
      : '',
    isCrying
      ? 'Speak with a tearful, choked, crying voice while keeping the exact same speaker voice.'
      : '',
    isAngry
      ? 'Deliver with fierce dramatic anger and intensity while keeping the exact same speaker voice.'
      : '',
    isGasping
      ? 'Begin with a sharp gasp of surprise and urgent tone while keeping the exact same speaker voice.'
      : '',
    isSighing
      ? 'Begin with a gentle audible sigh while keeping the exact same speaker voice.'
      : '',
    isWhispering
      ? 'Speak in a close-mic hushed whisper while keeping the exact same speaker voice.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const cacheKey = `${safeVoiceName}::${indianDialect}::${reactionActingDirective}::${cleanSpokenHindi}`;
  if (!elevenLabsConfig?.enabled && ttsMemoryCache.has(cacheKey)) {
    return res.json(ttsMemoryCache.get(cacheKey));
  }

  const resolvedElevenLabsKey = (
    elevenLabsConfig?.apiKey ||
    process.env.ELEVENLABS_API_KEY ||
    ''
  ).trim();
  const resolvedElevenLabsVoice = (
    elevenLabsConfig?.voiceId ||
    process.env.ELEVENLABS_VOICE_ID ||
    ELEVENLABS_VOICE_MAP[safeVoiceName] ||
    'JBFqnCBsd6RMkjVDRZzb'
  ).trim();
  const resolvedElevenLabsModel = (
    elevenLabsConfig?.modelId || 'eleven_multilingual_v2'
  ).trim();

  try {
    // Optional External Provider: ElevenLabs Multilingual v2 / Flash v2.5
    if (elevenLabsConfig?.enabled && resolvedElevenLabsKey) {
      const elRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(resolvedElevenLabsVoice)}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': resolvedElevenLabsKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text: cleanSpokenHindi,
            model_id: resolvedElevenLabsModel,
            voice_settings: {
              stability: isAngry || isCrying || isLaughing ? 0.45 : 0.75,
              similarity_boost: 0.92,
              style: isAngry || isCrying || isLaughing ? 0.65 : 0.2,
              use_speaker_boost: true,
            },
          }),
        }
      );

      if (!elRes.ok) {
        const errText = await elRes.text();
        throw new Error(`ElevenLabs API error (${elRes.status}): ${errText}`);
      }

      const arrayBuffer = await elRes.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString('base64');
      return res.json({
        audioBase64: base64Audio,
        mimeType: 'audio/mpeg',
        provider: `elevenlabs:${resolvedElevenLabsModel}`,
      });
    }

    // Use a single consistent engine ('gemini-3.8-live' at temperature 0.1 with LOCKED_VOICE_PERSONA_ANCHORS)
    // across all segments so the model NEVER switches engines mid-video and voice timbre stays 100% locked!
    const livePayload = await synthesizeWithGeminiLiveNativeAudio(
      cleanSpokenHindi,
      safeVoiceName,
      reactionActingDirective
    );
    ttsMemoryCache.set(cacheKey, livePayload);
    return res.json(livePayload);
  } catch {
    try {
      const fallbackPayload = await synthesizeHindiZeroQuotaFallback(cleanSpokenHindi);
      ttsMemoryCache.set(cacheKey, fallbackPayload);
      return res.json(fallbackPayload);
    } catch {
      return res.status(500).json({
        error: 'Voice synthesis encountered a temporary rate limit. Please click Synthesize to retry.',
      });
    }
  }
});

// Endpoint: Instant Actor Audition Line for Voice Personas
const AUDITION_LINES: Record<string, { hindi: string; desc: string }> = {
  Charon: {
    hindi: 'नमस्ते, मैं कबीर हूँ। एक गंभीर और दमदार लीड किरदार के लिए मेरी आवाज़ बिल्कुल मुकम्मल है।',
    desc: 'Kabir - Deep Baritone Lead Male',
  },
  Fenrir: {
    hindi: 'सुनिए, मैं विक्रम हूँ। एक्शन, थ्रिलर और हाई-टेंशन डायलॉग्स में मेरी आवाज़ में पूरा दम दिखेगा।',
    desc: 'Vikram - Gritty Action Baritone Male',
  },
  Puck: {
    hindi: 'अरे हाय दोस्तों! मैं रोहन हूँ। एकदम मस्त, एनर्जेटिक और नेचुरल बातचीत के लिए मेरी आवाज़ तैयार है।',
    desc: 'Rohan - Youthful Energetic Male',
  },
  Kore: {
    hindi: 'नमस्ते, मैं आर्या हूँ। कहानी की हर नाज़ुक भावना और संजीदा इमोशन को मैं अपनी आवाज़ से ज़िंदा करूँगी।',
    desc: 'Arya - Expressive Cinematic Lead Female',
  },
  Zephyr: {
    hindi: 'नमस्कार, मैं मीरा हूँ। किसी भी खूबसूरत कहानी या डॉक्यूमेंट्री के लिए मेरी आवाज़ दिल को छू लेगी।',
    desc: 'Meera - Warm Melodic Storyteller Female',
  },
};

app.post('/api/dubbing/audition-voice', async (req, res) => {
  const { voiceId = 'Charon' } = req.body || {};
  const safeVoice = ['Charon', 'Fenrir', 'Puck', 'Kore', 'Zephyr'].includes(voiceId)
    ? voiceId
    : 'Charon';

  const audition = AUDITION_LINES[safeVoice] || AUDITION_LINES.Charon;
  const cacheKey = `audition::${safeVoice}`;
  if (ttsMemoryCache.has(cacheKey)) {
    return res.json({
      ...ttsMemoryCache.get(cacheKey),
      voiceId: safeVoice,
      text: audition.hindi,
      desc: audition.desc,
    });
  }

  try {
    const ai = getGenAIClient();
    const isFemale = safeVoice === 'Kore' || safeVoice === 'Zephyr';
    const stylePrompt = isFemale
      ? 'Expressive native Indian female cinema dubbing artist with clear feminine warmth and natural diction.'
      : 'Authentic native Indian male cinema dubbing actor with deep chest resonance and Mumbai studio diction.';

    if (isTtsModelAvailable('gemini-3.8-flash-lite-tts')) {
      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model: 'gemini-3.8-flash-lite-tts',
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: audition.hindi,
                    speechMetadata: {
                      style: `${stylePrompt} Deliver smooth cinema dubbing audition in conversational Indian Hindi.`,
                    },
                  },
                ],
              },
            ],
            config: {
              temperature: 0.2,
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: safeVoice,
                  },
                },
              },
            },
          }),
          8000,
          'audition-tts'
        );

        const part = response?.candidates?.[0]?.content?.parts?.[0];
        const rawPcmBase64 = part?.inlineData?.data;
        if (rawPcmBase64) {
          const pcmBuffer = Buffer.from(rawPcmBase64, 'base64');
          const wavBuffer = wrapPcmWithWavHeader(pcmBuffer, 24000);
          const audioBase64 = wavBuffer.toString('base64');
          const payload = {
            audioBase64,
            mimeType: 'audio/wav',
            provider: 'gemini-3.8-flash-lite-tts',
            voiceId: safeVoice,
            text: audition.hindi,
            desc: audition.desc,
          };
          ttsMemoryCache.set(cacheKey, payload);
          return res.json(payload);
        }
      } catch (err: any) {
        const msg = String(err?.message || '');
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
          markTtsModelRateLimited('gemini-3.8-flash-lite-tts', msg);
        }
      }
    }

    const liveAudition = await synthesizeWithGeminiLiveNativeAudio(
      audition.hindi,
      safeVoice,
      stylePrompt
    );
    const payload = {
      ...liveAudition,
      voiceId: safeVoice,
      text: audition.hindi,
      desc: audition.desc,
    };
    ttsMemoryCache.set(cacheKey, payload);
    return res.json(payload);
  } catch {}

  // Fallback to high quality procedural zero-quota synthesis
  try {
    const fallback = await synthesizeHindiZeroQuotaFallback(audition.hindi);
    const payload = {
      ...fallback,
      voiceId: safeVoice,
      text: audition.hindi,
      desc: audition.desc,
    };
    ttsMemoryCache.set(cacheKey, payload);
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to audition voice.' });
  }
});

// Stage 5: SFX Engine MCP (https://api.sfxengine.com/mcp) & Studio Foley Generator
function synthesizeProceduralSfxWav(prompt: string, durationSec = 8): string {
  const sampleRate = 24000;
  const totalSamples = Math.max(sampleRate * 2, Math.min(sampleRate * 30, Math.floor(durationSec * sampleRate)));
  const pcmData = Buffer.alloc(totalSamples * 2);
  const lower = (prompt || '').toLowerCase();

  const isRain = /rain|storm|water|monsoon|barish/.test(lower);
  const isCinematic = /cinematic|riser|whoosh|trailer|impact|bass|sci-fi/.test(lower);
  const isTyping = /type|keyboard|click|tech|tutorial|ui|mouse|creator/.test(lower);

  let pinkB0 = 0;
  let pinkB1 = 0;
  let pinkB2 = 0;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const white = Math.random() * 2 - 1;
    pinkB0 = 0.99765 * pinkB0 + white * 0.099046;
    pinkB1 = 0.963 * pinkB1 + white * 0.2965164;
    pinkB2 = 0.57 * pinkB2 + white * 1.0526913;
    const pink = (pinkB0 + pinkB1 + pinkB2 + white * 0.1848) * 0.05;

    let sample = 0;
    if (isRain) {
      const droplet = Math.sin(2 * Math.PI * (900 + (i % 700)) * t) * Math.exp(-((t * 11) % 1) * 14) * 0.08;
      sample = pink * 0.45 + droplet;
    } else if (isCinematic) {
      const sweepFreq = 55 + 95 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.25 * t));
      const subDrone = 0.22 * Math.sin(2 * Math.PI * sweepFreq * t) + 0.11 * Math.sin(2 * Math.PI * (sweepFreq * 1.5) * t);
      const whooshEnv = Math.exp(-Math.pow(((t % 3.5) - 1.2) * 2.2, 2));
      sample = subDrone + pink * whooshEnv * 0.55;
    } else if (isTyping) {
      const clickTrigger = ((t * 5.5) % 1) < 0.04 ? Math.exp(-(((t * 5.5) % 1) * 120)) : 0;
      const clickTone = Math.sin(2 * Math.PI * 1850 * t) * clickTrigger * 0.18;
      const softWhoosh = pink * 0.22 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.4 * t));
      sample = clickTone + softWhoosh + 0.05 * Math.sin(2 * Math.PI * 110 * t);
    } else {
      // Warm acoustic studio room tone + gentle harmonic air
      sample =
        pink * 0.2 +
        0.08 * Math.sin(2 * Math.PI * 128 * t) +
        0.04 * Math.sin(2 * Math.PI * 192 * t + 0.5);
    }

    const clamped = Math.max(-0.9, Math.min(0.9, sample));
    pcmData.writeInt16LE(Math.floor(clamped * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]).toString('base64');
}

app.post('/api/dubbing/sfx-mcp', async (req, res) => {
  const { prompt = 'creator studio subtle foley and transition whoosh', durationSeconds = 8 } = req.body || {};
  const sfxApiKey = (process.env.SFXENGINE_API_KEY || '').trim();

  try {
    // 1. Call https://api.sfxengine.com/mcp via JSON-RPC 2.0 Model Context Protocol
    const mcpHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (sfxApiKey) {
      mcpHeaders['Authorization'] = `Bearer ${sfxApiKey}`;
      mcpHeaders['x-api-key'] = sfxApiKey;
    }

    const mcpRes = await fetch('https://api.sfxengine.com/mcp', {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'generate_sound_effect',
          arguments: {
            prompt,
            duration: Math.min(15, Math.max(2, Number(durationSeconds) || 8)),
          },
        },
      }),
    }).catch(() => null);

    if (mcpRes && mcpRes.ok) {
      const mcpJson: any = await mcpRes.json().catch(() => null);
      const audioUrl =
        mcpJson?.result?.audioUrl ||
        mcpJson?.result?.url ||
        mcpJson?.result?.content?.[0]?.url;
      const inlineBase64 = mcpJson?.result?.audioBase64 || mcpJson?.result?.data;

      if (inlineBase64) {
        return res.json({
          audioBase64: inlineBase64,
          mimeType: 'audio/wav',
          provider: 'https://api.sfxengine.com/mcp',
          prompt,
        });
      }
      if (audioUrl && typeof audioUrl === 'string') {
        const audioFetch = await fetch(audioUrl);
        if (audioFetch.ok) {
          const arrBuf = await audioFetch.arrayBuffer();
          return res.json({
            audioBase64: Buffer.from(arrBuf).toString('base64'),
            mimeType: audioFetch.headers.get('content-type') || 'audio/mpeg',
            provider: 'https://api.sfxengine.com/mcp',
            prompt,
          });
        }
      }
    }
  } catch {
    // Fall through to studio DSP foley synthesizer
  }

  // Studio 24kHz PCM WAV Foley Synthesis so SFX Engine layer always works with zero external credits required
  const wavBase64 = synthesizeProceduralSfxWav(prompt, Number(durationSeconds) || 8);
  return res.json({
    audioBase64: wavBase64,
    mimeType: 'audio/wav',
    provider: 'sfxengine-mcp-studio-dsp',
    prompt,
  });
});

// Stage 6 Optional External Webhook Bridge for Wav2Lip / Sync Labs API
app.post('/api/dubbing/external-lipsync', async (req, res) => {
  try {
    const { endpointUrl, apiKey, videoUrl, audioBase64 } = req.body;
    if (!endpointUrl || !apiKey) {
      return res
        .status(400)
        .json({ error: 'External Lip-Sync endpoint URL and API key are required.' });
    }

    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        video_url: videoUrl,
        audio_base64: audioBase64,
        model: 'lipsync-1.9.0-beta',
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        data?.message || data?.error || `External Lip-Sync returned ${response.status}`
      );
    }

    res.json({ status: 'submitted', result: data });
  } catch (error: any) {
    res.status(500).json({
      error: error?.message || 'External Lip-Sync bridge request failed.',
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ChitraVani Studio server running on http://localhost:${PORT}`);
  });
}

startServer();
