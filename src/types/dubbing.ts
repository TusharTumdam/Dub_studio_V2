export type AdaptationStyle =
  | 'bollywood_cinematic'
  | 'conversational_hinglish'
  | 'ott_natural_realism'
  | 'poetic_hindustani';

export type GeminiVoiceId = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';

export type PipelineStageNumber = 1 | 2 | 3 | 4 | 5 | 6;

export type StageState = 'idle' | 'processing' | 'completed' | 'error';

export type GlobalSourceLanguage =
  | 'auto'
  | 'en'
  | 'es'
  | 'ja'
  | 'ko'
  | 'zh'
  | 'fr'
  | 'de'
  | 'ar'
  | 'ru'
  | 'pt'
  | 'ta'
  | 'te';

export type IndianVocalDialect =
  | 'mumbai_cinema'
  | 'delhi_urban'
  | 'lucknowi_tehzeeb'
  | 'ott_gritty_real'
  | 'pan_india_storyteller';

export interface SourceLanguageOption {
  code: GlobalSourceLanguage;
  label: string;
  nativeName: string;
  regionTag: string;
}

export interface IndianDialectOption {
  id: IndianVocalDialect;
  label: string;
  description: string;
  phoneticInstruction: string;
}

export interface VoicePersona {
  id: GeminiVoiceId;
  gender: 'male' | 'female';
  hindiName: string;
  archetype: string;
  timbre: string;
  recommendedFor: string;
  defaultEmotion: string;
  indianVocalSignature: string;
}

export interface DubbingSegment {
  id: string;
  index: number;
  startTime: number;
  endTime: number;
  speaker: string;
  gender?: 'male' | 'female';
  detectedLanguage?: string;
  englishText: string; // Holds original global language transcript (with English gloss if non-English)
  hindiDevanagari: string;
  hinglishRoman: string;
  emotionPrompt: string;
  indianDialect: IndianVocalDialect;
  humanBreathEnabled: boolean;
  voiceId: GeminiVoiceId;
  englishSyllables: number;
  hindiSyllables: number;
  generatedWavBase64?: string;
  generatedMimeType?: string;
  rawAudioDuration?: number;
  playbackRate: number;
  isSynthesizing?: boolean;
  isTranslating?: boolean;
}

export type SfxFoleyPreset =
  | 'none'
  | 'creator_studio'
  | 'cinematic_riser'
  | 'warm_room_tone'
  | 'rain_foley'
  | 'custom_mcp';

export interface AudioMixConfig {
  hindiVocalGainDb: number; // -12 to +6 dB
  bgmBaseGainDb: number; // -24 to +3 dB
  duckingReductionDb: number; // -28 to 0 dB attenuation during active Hindi dialogue
  duckingAttackMs: number; // 15 to 200 ms
  duckingReleaseMs: number; // 100 to 800 ms
  vocalIsolationEnabled: boolean; // Attenuates 300Hz-3.4kHz center vocal band on original video audio
  studioWarmthEqEnabled: boolean; // Adds Neumann U87-style chest warmth (185Hz) + natural presence (3.2kHz)
  autoTimeStretchLipSync: boolean; // Dynamically warps segment playbackRate to fit mouth open/close timestamps
  lipSyncWarpIntensity: number; // 0 to 100% mouth viseme articulation intensity
  sfxAmbienceEnabled?: boolean; // Mixes SFX Engine MCP / Studio Foley & Transition SFX underneath Hindi dub
  sfxPreset?: SfxFoleyPreset;
  sfxGainDb?: number; // -24 to 0 dB
  customSfxPrompt?: string;
  customSfxAudioBase64?: string;
}

export interface ExternalProviderConfig {
  elevenLabsEnabled: boolean;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsModelId?: string;
  useHighExpressiveGeminiTts: boolean; // Defaults to true (gemini-3.8-flash-tts) for realistic human breath & acting
  externalLipSyncEnabled: boolean;
  externalLipSyncEndpoint: string;
  externalLipSyncApiKey: string;
}

export interface SampleReelPreset {
  id: string;
  title: string;
  category: string;
  sourceLanguage: GlobalSourceLanguage;
  sourceLanguageBadge: string;
  durationSeconds: number;
  recommendedStyle: AdaptationStyle;
  defaultDialect: IndianVocalDialect;
  defaultVoice: GeminiVoiceId;
  visualTheme: {
    primaryHue: string;
    accentColor: string;
    sceneLabel: string;
    characterName: string;
    characterRole: string;
  };
  segments: Array<{
    startTime: number;
    endTime: number;
    speaker: string;
    detectedLanguage: string;
    englishText: string;
    hindiDevanagari: string;
    hinglishRoman: string;
    emotionPrompt: string;
  }>;
}

export const GLOBAL_SOURCE_LANGUAGES: SourceLanguageOption[] = [
  { code: 'auto', label: 'Auto-Detect Global Language', nativeName: 'Multilingual AI', regionTag: 'Global' },
  { code: 'en', label: 'English (Hollywood / UK / Creator)', nativeName: 'English', regionTag: 'US / UK' },
  { code: 'ja', label: 'Japanese (Anime / J-Cinema)', nativeName: '日本語', regionTag: 'Japan' },
  { code: 'ko', label: 'Korean (K-Drama / Seoul Cinema)', nativeName: '한국어', regionTag: 'Korea' },
  { code: 'es', label: 'Spanish (La Casa / Latin Thriller)', nativeName: 'Español', regionTag: 'Spain / LatAm' },
  { code: 'fr', label: 'French (European Art Cinema)', nativeName: 'Français', regionTag: 'France' },
  { code: 'zh', label: 'Mandarin Chinese (Wuxia / Sci-Fi)', nativeName: '中文', regionTag: 'China' },
  { code: 'de', label: 'German (Dark / Industrial Tech)', nativeName: 'Deutsch', regionTag: 'Germany' },
  { code: 'ru', label: 'Russian (Historical / Action)', nativeName: 'Русский', regionTag: 'Russia' },
  { code: 'ar', label: 'Arabic (Middle East Documentary)', nativeName: 'العربية', regionTag: 'MENA' },
  { code: 'pt', label: 'Portuguese (Brazil / Portugal)', nativeName: 'Português', regionTag: 'Brazil' },
  { code: 'ta', label: 'Tamil (Kollywood Pan-India Dub)', nativeName: 'தமிழ்', regionTag: 'India (South)' },
  { code: 'te', label: 'Telugu (Tollywood Action Blockbuster)', nativeName: 'तेलुगु / తెలుగు', regionTag: 'India (South)' },
];

export const INDIAN_VOCAL_DIALECTS: IndianDialectOption[] = [
  {
    id: 'mumbai_cinema',
    label: 'Mumbai Studio Standard (Khari Boli Cinema)',
    description: 'Authentic Yash Raj / Mumbai dubbing theatre diction with rich emotional warmth',
    phoneticInstruction:
      'Authentic native Indian Hindi speaker from a Mumbai film dubbing studio. Crisp Indian retroflex consonants (ट, ड, ण), natural aspirated stops (ख, घ, ध, भ), warm chest resonance, zero Western/American accent.',
  },
  {
    id: 'ott_gritty_real',
    label: 'Realistic Indian OTT Series (Natural & Grounded)',
    description: 'Unpolished, deeply human Indian conversational realism like sacred Indian web series',
    phoneticInstruction:
      'Hyper-realistic everyday Indian human voice. Natural micro-pauses, subtle breathiness, organic rhythm, colloquial Hindi-Hindustani intimacy, sounds like a real person talking on location in India.',
  },
  {
    id: 'delhi_urban',
    label: 'Delhi NCR Urban & Creator (Punchy Hinglish)',
    description: 'Lively, expressive North Indian urban inflection for creators, tech & modern drama',
    phoneticInstruction:
      'Native North Indian Delhi NCR speaker. Warm, expressive, lively pace, natural Indian English + Hindi code-switching cadence, friendly human energy.',
  },
  {
    id: 'lucknowi_tehzeeb',
    label: 'Hindustani / Awadhi Tehzeeb (Poetic & Nuanced)',
    description: 'Velvety Urdu-inflected Hindustani pronunciation (क़, ख़, ग़, ज़, फ़) for period & drama',
    phoneticInstruction:
      'Cultured native Indian Hindustani voice with graceful nuqta pronunciation (क़, ख़, ग़, ज़, फ़), soft poetic cadence, and deep emotional maturity.',
  },
  {
    id: 'pan_india_storyteller',
    label: 'Pan-India Epic Narrator (Deep & Commanding)',
    description: 'High-impact theatrical baritone/alto for South/Global action blockbusters',
    phoneticInstruction:
      'Commanding Indian cinema narrator with powerful diaphragmatic projection, dramatic pauses, and razor-sharp Devanagari diction.',
  },
];

export const VOICE_PERSONAS: VoicePersona[] = [
  {
    id: 'Charon',
    gender: 'male',
    hindiName: 'Kabir (कबीर — मेल लीड)',
    archetype: 'Deep Indian Cinema Baritone (Male Lead)',
    timbre: 'Resonant · Warm Chest Tone · Lead Actor',
    recommendedFor: 'Hollywood/K-Drama male leads, trailers, intense OTT drama',
    defaultEmotion: 'Natural Indian male actor, warm baritone, subtle human breath before emotional phrases, authentic Mumbai cinema diction',
    indianVocalSignature: 'Native Indian Hindi male baritone with rich low-mid warmth and crisp retroflex articulation.',
  },
  {
    id: 'Fenrir',
    gender: 'male',
    hindiName: 'Vikram (विक्रम — एक्शन मेल)',
    archetype: 'Gritty OTT & Action Heavyweight (Male)',
    timbre: 'Raw · Husky · Intense Thriller Realism',
    recommendedFor: 'Spanish/Korean crime thrillers, anime villains, action epics',
    defaultEmotion: 'Gritty, grounded Indian thriller actor speaking low, intense Hindi with realistic human tension and breath',
    indianVocalSignature: 'Deep, textured Indian male voice with raw dramatic edge and strong consonant impact.',
  },
  {
    id: 'Puck',
    gender: 'male',
    hindiName: 'Rohan (रोहन — यंग मेल)',
    archetype: 'Realistic Urban Indian Youth / Creator (Male)',
    timbre: 'Spontaneous · Relatable · Conversational Hinglish',
    recommendedFor: 'YouTube creators, anime dubs, modern youth characters',
    defaultEmotion: 'Spontaneous, realistic young Indian speaker from Delhi/Mumbai, lively conversational pacing with natural human pauses',
    indianVocalSignature: 'Authentic young Indian male voice with lively conversational rhythm and natural Hinglish flow.',
  },
  {
    id: 'Kore',
    gender: 'female',
    hindiName: 'Arya (आर्या — फीमेल लीड)',
    archetype: 'Expressive Indian Female Lead (Heroine)',
    timbre: 'Soulful · Natural Breath · Cinema & K-Drama Heroine',
    recommendedFor: 'Global cinema female leads, emotional dialogues, storytelling',
    defaultEmotion: 'Expressive native Indian woman speaking natural Hindi with soft human breathiness and genuine emotional warmth',
    indianVocalSignature: 'Native Indian female voice with delicate micro-inflections, natural warmth, and clear Hindi vowels.',
  },
  {
    id: 'Zephyr',
    gender: 'female',
    hindiName: 'Meera (मीरा — फीमेल नैरेटर)',
    archetype: 'Warm Indian Documentary & Storyteller (Female)',
    timbre: 'Soothing · Articulate · Literary Hindustani',
    recommendedFor: 'Global documentaries, cultural films, calm narration',
    defaultEmotion: 'Warm, soothing native Indian female storyteller with unhurried human pacing and gentle acoustic intimacy',
    indianVocalSignature: 'Calm, intimate Indian female narrator with crystal-clear Hindi-Urdu pronunciation.',
  },
];

export const EMOTION_PRESETS: string[] = [
  '😂 Laughing warmly: Burst into genuine joyful laughter <laugh>, audible chuckles and playful giggles',
  '😭 Crying & weeping: Heartbroken crying through real tears <sob>, choked sobbing voice and sorrowful trembling',
  '😡 Furious anger & rage: Boiling with intense fury <angry>, aggressively shouting with fierce harsh conviction',
  '😱 Terrified shock & gasp: Sudden sharp breathless gasp <gasp>, panicking and trembling in deep fear',
  '😮‍💨 Deep emotional sigh: Releasing an audible heavy sigh of relief and exhaustion <sigh>',
  '🤫 Intense dramatic whisper: Secretive, thrilling close-to-mic cinematic whisper <whisper>',
  '🎬 Mumbai cinema lead dialog: Confident, resonant movie dialogue with natural warm pauses',
  '🇮🇳 Natural everyday Indian conversation: Smooth, colloquial Hinglish rhythm with realistic cadence',
];

export const STUDIO_SAMPLE_REELS: SampleReelPreset[] = [
  {
    id: 'scifi-trailer',
    title: 'Aethelgard Protocol — Hollywood Sci-Fi Trailer (EN → HI)',
    category: 'English Blockbuster · 24 fps · Stereo Stem',
    sourceLanguage: 'en',
    sourceLanguageBadge: 'English (US)',
    durationSeconds: 16.0,
    recommendedStyle: 'bollywood_cinematic',
    defaultDialect: 'mumbai_cinema',
    defaultVoice: 'Charon',
    visualTheme: {
      primaryHue: '#F59E0B',
      accentColor: '#38BDF8',
      sceneLabel: 'HOLLYWOOD MASTER · ENGLISH TO HINDI',
      characterName: 'CDR. VANCE (KABIR)',
      characterRole: 'Mission Lead',
    },
    segments: [
      {
        startTime: 0.6,
        endTime: 5.2,
        speaker: 'Speaker 1',
        detectedLanguage: 'English',
        englishText: 'For thirty years, we looked to the stars for an answer.',
        hindiDevanagari: '<breath> तीस सालों तक... हम अपने सवालों के जवाब आसमान में ढूँढते रहे।',
        hinglishRoman: 'Tees saalon tak... hum apne sawaalon ke jawaab aasmaan mein dhoondhte rahe.',
        emotionPrompt: 'Natural Indian male actor, warm baritone, subtle human breath before emotional phrases',
      },
      {
        startTime: 5.8,
        endTime: 10.6,
        speaker: 'Speaker 1',
        detectedLanguage: 'English',
        englishText: 'We never realized the signal was coming from beneath our own oceans.',
        hindiDevanagari: 'हमें अंदाज़ा भी नहीं था, कि वो आवाज़ हमारे ही समंदर की गहराइयों से आ रही है।',
        hinglishRoman: 'Humein andaaza bhi nahi tha, ki woh aawaaz humare hi samandar ki gehraiyon se aa rahi hai.',
        emotionPrompt: 'Grounded Indian OTT series realism — hushed, intimate, and suspenseful human tone',
      },
      {
        startTime: 11.2,
        endTime: 15.4,
        speaker: 'Speaker 1',
        detectedLanguage: 'English',
        englishText: 'Prepare the launch sequence. Tonight, humanity wakes up.',
        hindiDevanagari: '<breath> लॉन्च की तैयारी शुरू करो... आज रात, इंसानियत की नई सुबह होगी।',
        hinglishRoman: 'Launch ki taiyaari shuru karo... aaj raat, insaaniyat ki nayi subah hogi.',
        emotionPrompt: 'Commanding Indian cinema climax delivery with authentic emotional conviction',
      },
    ],
  },
  {
    id: 'kdrama-seoul',
    title: 'Midnight in Itaewon — Korean Thriller (KO → HI)',
    category: 'Global K-Drama · Korean Source · Hindi Dub',
    sourceLanguage: 'ko',
    sourceLanguageBadge: 'Korean (한국어)',
    durationSeconds: 15.5,
    recommendedStyle: 'ott_natural_realism',
    defaultDialect: 'ott_gritty_real',
    defaultVoice: 'Kore',
    visualTheme: {
      primaryHue: '#10B981',
      accentColor: '#F43F5E',
      sceneLabel: 'SEOUL NOIR · KOREAN TO HINDI DUB',
      characterName: 'JI-YOON (ARYA)',
      characterRole: 'Lead Detective',
    },
    segments: [
      {
        startTime: 0.5,
        endTime: 5.0,
        speaker: 'Speaker 1',
        detectedLanguage: 'Korean (한국어)',
        englishText: '그날 밤 비가 내리지 않았다면, 우리는 진실을 몰랐을 거예요. (If it had not rained that night, we would never have known the truth.)',
        hindiDevanagari: '<breath> अगर उस रात बारिश न हुई होती... तो सच हमारे सामने कभी नहीं आता।',
        hinglishRoman: 'Agar us raat baarish na hui hoti... toh sach humare saamne kabhi nahi aata.',
        emotionPrompt: 'Expressive native Indian woman speaking natural Hindi with soft human breathiness and genuine emotion',
      },
      {
        startTime: 5.6,
        endTime: 10.2,
        speaker: 'Speaker 1',
        detectedLanguage: 'Korean (한국어)',
        englishText: '모든 증거가 사라졌지만, 내 기억은 아직 선명해요. (Every piece of evidence vanished, but my memory is still clear.)',
        hindiDevanagari: 'सारे सबूत मिटा दिए गए, <sigh> पर मेरी यादों में वो चेहरा आज भी ज़िंदा है।',
        hinglishRoman: 'Saare saboot mita diye gaye, par meri yaadon mein woh chehra aaj bhi zinda hai.',
        emotionPrompt: 'Heartfelt, emotional Indian voice with a gentle sigh and vulnerable realism',
      },
      {
        startTime: 10.8,
        endTime: 15.0,
        speaker: 'Speaker 1',
        detectedLanguage: 'Korean (한국어)',
        englishText: '이제 도망치지 않아요. 끝까지 가볼게요. (I am not running away anymore. I will see this to the end.)',
        hindiDevanagari: 'अब मैं पीछे नहीं हटूँगी... चाहे अंजाम जो भी हो, मैं आख़िर तक लड़ूँगी।',
        hinglishRoman: 'Ab main peeche nahi hatoongi... chahe anjaam jo bhi ho, main aakhir tak ladoongi.',
        emotionPrompt: 'Determined, grounded Indian female lead with firm Hindustani diction',
      },
    ],
  },
  {
    id: 'spanish-heist',
    title: 'El Oro de Madrid — Spanish Heist Drama (ES → HI)',
    category: 'Global Series · Spanish Source · Hindi Dub',
    sourceLanguage: 'es',
    sourceLanguageBadge: 'Spanish (Español)',
    durationSeconds: 15.5,
    recommendedStyle: 'bollywood_cinematic',
    defaultDialect: 'lucknowi_tehzeeb',
    defaultVoice: 'Fenrir',
    visualTheme: {
      primaryHue: '#F43F5E',
      accentColor: '#F59E0B',
      sceneLabel: 'MADRID VAULT · SPANISH TO HINDI DUB',
      characterName: 'EL PROFESOR (VIKRAM)',
      characterRole: 'Mastermind',
    },
    segments: [
      {
        startTime: 0.6,
        endTime: 5.1,
        speaker: 'Speaker 1',
        detectedLanguage: 'Spanish (Español)',
        englishText: 'Un plan perfecto no depende de la suerte, sino de la paciencia. (A perfect plan does not depend on luck, but on patience.)',
        hindiDevanagari: '<breath> एक मुकम्मल साज़िश क़िस्मत के भरोसे नहीं... सब्र के दम पर कामयाब होती है।',
        hinglishRoman: 'Ek mukammal saazish qismat ke bharose nahi... sabr ke dam par kaamyaab hoti hai.',
        emotionPrompt: 'Gritty, intelligent Indian actor with composed Hindustani gravitas and subtle breath',
      },
      {
        startTime: 5.7,
        endTime: 10.4,
        speaker: 'Speaker 1',
        detectedLanguage: 'Spanish (Español)',
        englishText: 'Cuando abran esa puerta, el mundo entero estará mirando. (When they open that door, the whole world will be watching.)',
        hindiDevanagari: 'जब वो दरवाज़ा खुलेगा ना... तो पूरी दुनिया की नज़रें सिर्फ़ हम पर होंगी।',
        hinglishRoman: 'Jab woh darwaaza khulega na... toh poori duniya ki nazrein sirf hum par hongi.',
        emotionPrompt: 'Intimate, conversational Indian thriller mastermind speaking with quiet confidence',
      },
      {
        startTime: 11.0,
        endTime: 15.0,
        speaker: 'Speaker 1',
        detectedLanguage: 'Spanish (Español)',
        englishText: 'Nadie se rinde hoy. Esta historia la escribimos nosotros. (Nobody surrenders today. We write this story ourselves.)',
        hindiDevanagari: '<breath> आज कोई घुटने नहीं टेकेगा। ये कहानी हमारी है, और इसे हम ही लिखेंगे।',
        hinglishRoman: 'Aaj koi ghutne nahi tekega. Yeh kahaani humari hai, aur ise hum hi likhenge.',
        emotionPrompt: 'Powerful, inspiring Indian human voice with warm chest projection',
      },
    ],
  },
  {
    id: 'creator-tech',
    title: 'Tokyo Robotics Lab — Japanese / Global Creator (JA/EN → Hinglish)',
    category: 'Global Creator · 60 fps · Hinglish Dub',
    sourceLanguage: 'ja',
    sourceLanguageBadge: 'Japanese (日本語)',
    durationSeconds: 15.0,
    recommendedStyle: 'conversational_hinglish',
    defaultDialect: 'delhi_urban',
    defaultVoice: 'Puck',
    visualTheme: {
      primaryHue: '#38BDF8',
      accentColor: '#10B981',
      sceneLabel: 'TOKYO LAB · JAPANESE TO HINGLISH',
      characterName: 'KENJI (ROHAN)',
      characterRole: 'Robotics Creator',
    },
    segments: [
      {
        startTime: 0.5,
        endTime: 4.8,
        speaker: 'Speaker 1',
        detectedLanguage: 'Japanese (日本語)',
        englishText: 'この新しいバイオニックハンドは、人間の指と同じくらい繊細に動きます。 (This new bionic hand moves as delicately as real human fingers.)',
        hindiDevanagari: '<breath> यार, ये नया बायोनिक हाथ देखो... बिल्कुल असली इंसानी उँगलियों की तरह काम करता है।',
        hinglishRoman: 'Yaar, yeh naya bionic haath dekho... bilkul asli insaani ungliyon ki tarah kaam karta hai.',
        emotionPrompt: 'Spontaneous, realistic young Indian creator from Delhi speaking natural Hinglish',
      },
      {
        startTime: 5.3,
        endTime: 10.0,
        speaker: 'Speaker 1',
        detectedLanguage: 'Japanese (日本語)',
        englishText: 'センサーの遅延はゼロで、卵を割らずに掴むことができます。 (Sensor latency is zero, so it can hold an egg without cracking it.)',
        hindiDevanagari: 'सेंसर में ज़रा भी लैग नहीं है, यहाँ तक कि ये कच्चे अंडे को भी बिना तोड़े पकड़ लेता है।',
        hinglishRoman: 'Sensor mein zara bhi lag nahi hai, yahaan tak ki yeh kachche ande ko bhi bina tode pakad leta hai.',
        emotionPrompt: 'Enthusiastic, natural Indian human voice explaining tech to a friend',
      },
      {
        startTime: 10.5,
        endTime: 14.5,
        speaker: 'Speaker 1',
        detectedLanguage: 'Japanese (日本語)',
        englishText: '未来のテクノロジーは、もう目の前に来ています。 (The technology of the future is already right in front of our eyes.)',
        hindiDevanagari: '<breath> सच कहूँ तो आने वाले कल की टेक्नोलॉजी अब हमारे सामने खड़ी है।',
        hinglishRoman: 'Sach kahoon toh aane wale kal ki technology ab humare saamne khadi hai.',
        emotionPrompt: 'Warm, relatable Indian youth creator concluding with genuine excitement',
      },
    ],
  },
];
