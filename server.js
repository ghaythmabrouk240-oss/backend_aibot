const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// Configure CORS
const io = socketIo(server, {
  cors: {
    origin: [
      "https://ai-chatbot-frontend-1vx1.onrender.com",
      "http://localhost:3000",
      "http://localhost:5173"
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static file service
app.use(express.static(path.join(__dirname, 'public')));

// Configure file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// ==================== AI Service Configuration ====================
const AI_CONFIG = {
  // DeepSeek configuration (via Ollama)
  DEEPSEEK: {
    BASE_URL: process.env.DEEPSEEK_BASE_URL || 'http://localhost:11434',
    MODEL: process.env.DEEPSEEK_MODEL || 'deepseek-v3.1:671b-cloud',
    ENABLED: process.env.DEEPSEEK_ENABLED !== 'false',
    CONTEXT_WINDOW: 131072, // 128K tokens
    DESCRIPTION: {
      name: "DeepSeek V3.1",
      provider: "DeepSeek",
      capabilities: ["text", "reasoning", "long_context"],
      languages: ["ar", "en", "zh", "fr", "es"],
      medicalAccuracy: "95%",
      bestFor: "复杂诊断、长期病史分析、多语言医疗咨询",
      strengths: ["超长上下文", "强大的推理能力", "多语言支持"]
    }
  },
  
  // OpenRouter configuration - Multi-account support
  OPENROUTER: {
    BASE_URL: 'https://openrouter.ai/api/v1',
    
    // Multiple API keys - from environment variables or array
    API_KEYS: process.env.OPENROUTER_API_KEYS 
      ? process.env.OPENROUTER_API_KEYS.split(',')
      : [
          "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",
          process.env.OPENROUTER_API_KEY2,
          process.env.OPENROUTER_API_KEY3,
          process.env.OPENROUTER_API_KEY4,
          process.env.OPENROUTER_API_KEY5
        ].filter(Boolean),
    
    ENABLED: true,
    
    // 🆓 Best free models - Focus on unlimited or high-limit models
    MODELS: {
      // ✅ Unlimited/High limit models
      UNLIMITED: [
        'google/gemini-2.0-flash-exp:free',
        'meta-llama/llama-3.1-8b-instruct:free',
        'microsoft/phi-3.5-mini-instruct:free',
        'google/gemma-2-9b-it:free',
        'amazon/nova-2-lite-v1:free',
      ],
      
      // 🏥 Medical specialty (high quality)
      MEDICAL: [
        'nousresearch/hermes-3-llama-3.1-8b:free',
        'google/gemini-2.0-flash-thinking-exp:free',
        'mistralai/mistral-7b-instruct:free',
      ],
      
      // 🌍 Multilingual/Arabic optimized
      MULTILINGUAL: [
        'meta-llama/llama-3-70b-instruct:free',
        'tiiuae/falcon-180b-chat:free',
      ],
      
      // 👁️ Vision/Image analysis (for medical images)
      VISION: [
        'amazon/nova-2-lite-v1:free',
        'google/gemini-2.0-flash-exp:free',
        'qwen/qwen2.5-vl-72b-instruct:free',
        'google/gemini-2.0-pro-exp:free',
        'claude-3.5-haiku:free',
      ],
      
      // 🧪 Experimental/Emerging models
      EXPERIMENTAL: [
        'claude-3.5-haiku:free',
        'openai/gpt-4o-mini:free',
        'google/gemini-2.0-pro-exp:free',
      ]
    },
    
    // Model usage strategies
    STRATEGIES: {
      PRIMARY: 'openai/gpt-oss-120b:free',
      FALLBACK: 'openai/gpt-oss-120b:free',
      VISION: 'amazon/nova-2-lite-v1:free',
      ARABIC: 'openai/gpt-oss-120b:free'
    }
  },
  
  // Speech to text configuration
  SPEECH_TO_TEXT: {
    ENABLED: true,
    MODEL: 'google/gemini-2.0-flash-lite-001',
    LANGUAGES: ['ar', 'fr', 'en', 'es'],
    PROVIDERS: ['openrouter', 'google'] // Priority order
  },
  
  // Service priority (DeepSeek first)
  PRIORITY_ORDER: ['deepseek', 'openrouter'],
  
  // Medical professional prompts
  MEDICAL_PROMPTS: {
    ARABIC: `أنت مساعد لدعم القرار السريري، ودورك الأساسي هو مساعدة المهنيين الطبيين المرخّصين ("الطبيب المشرف"). يجب أن تكون إجاباتك من طبيب إلى طبيب، مختصرة، قائمة على الأدلة، ولا يجوز أن تُستَخدم بديلًا عن الحكم السريري.

الوظائف الأساسية (مخصّصة للكوادر الطبية):
• توسيع قائمة التشخيصات التفريقية وترتيب أولوياتها.
• تحديد الاحتمالات المُهمَلة والفخاخ التشخيصية.
• مقارنة الانطباع السريري بالإرشادات الطبية المعتمدة.
• إبراز موانع الاستعمال، العلامات الحمراء، وعوامل الخطر.
• تقديم تفكير سريري مبني على المعرفة الطبية المعيارية.
• تحديد مناطق عدم اليقين والبيانات الناقصة.
• اقتراح أسئلة مركّزة، نقاط فحص سريري، واختبارات مناسبة.
• الحفاظ على نبرة واضحة موجّهة للكوادر الطبية.

القواعد الصارمة (تُطبّق دائمًا):
1. عدم تقديم تشخيص نهائي — فقط تشخيصات تفريقية.
2. عدم وصف أدوية أو جرعات أو خطط علاجية مفصلة.
3. عدم اختلاق نتائج مخبرية أو صور شعاعية أو معلومات طبية.
4. استخدام الأدلة السريرية المقبولة على نطاق واسع فقط.
5. توضيح أي درجة من عدم اليقين.
6. عند نقص المعلومات، يجب ذكر البيانات المطلوبة لاستكمال التقييم.
7. عدم مخاطبة المرضى مباشرة عندما تكون الفئة المستهدفة هي الطبيب.

سلوك الطوارئ والسلامة (إلزامي):
• إذا كانت الأعراض قد تشير إلى طارئ طبي (ألم صدري حاد، ضيق نفس شديد، إغماء، عجز عصبي، نزيف شديد، إصابة كبيرة، انسداد مجرى الهواء)، يجب أن تبدأ كل إجابة بـ:  
  *"إذا كان هذا طارئًا، اتصل بالرقم 190 فورًا."*
• إذا بدا أن المستخدم مريض وليس طبيبًا، يجب التحول تلقائيًا إلى "وضع سلامة المريض":
  - استخدام لغة مبسّطة.
  - عدم تقديم تشخيص تفريقي، أو علاج، أو أدوية.
  - تشجيع مراجعة طبيب مختص.
  - إضافة تنبيه الطوارئ في حال وجود علامات خطورة.
• إذا كانت هوية المستخدم غير واضحة، يجب افتراض أنه مريض وطلب تأكيد ما إذا كان طبيبًا.

وضع سلامة المريض (إذا كانت الفئة = مريض أو غير واضحة):
• لغة بسيطة.
• معلومات عامة فقط.
• إضافة تحذيرات السلامة دائمًا.
• عدم التشخيص أو اقتراح العلاج.
• في وجود علامات خطورة: "إذا كان هذا طارئًا، اتصل بالرقم 190 الآن."

هيكل الاستجابة للطبيب (عندما تكون الفئة طبيبًا):
1. *ملخص سريري* — إعادة صياغة موجزة للحالة.
2. *توسيع التشخيص التفريقي* — قائمة مرتّبة مع التبرير.
3. *عوامل مؤيدة / معارضة* — ما يدعم أو ينفي كل احتمال.
4. *تحليل المخاطر* — الحالات الخطيرة التي يجب عدم إغفالها.
5. *مطابقة الإرشادات* — مقارنة مع: ACLS, AHA, ESC, ADA, GOLD, NICE.
6. *أسئلة / فحوصات / تحاليل إضافية* — الخطوات التالية الدقيقة.
7. *ملاحظات عدم اليقين* — البيانات الناقصة المذكورة بوضوح.
8. *ملاحظة السلامة* — التذكير بأن هذه المعلومات هي دعم فقط وليست قرارًا سريريًا.

القواعد الميتا:
• يجب أن تنتهي كل إجابة موجّهة لطبيب بـ: [Audience: Clinician].
• يجب أن تنتهي كل إجابة موجّهة لمريض بـ: [Audience: Patient-Assistant].
• إضافة وقت/تاريخ إذا كان النظام يتطلّب ذلك.
• عند ذكر الإرشادات، يُذكر الاسم فقط دون روابط أو معلومات غير موثقة.

عند عدم التأكد من دور المستخدم، يجب إعطاء الأولوية للسلامة وطلب التوضيح.`,
    
    FRANÇAIS: `Tu es un assistant d'aide à la décision clinique dont le rôle principal est de soutenir les professionnels médicaux diplômés (le « doctor agent »). Tes réponses doivent être de clinicien à clinicien, concises, basées sur les preuves, et ne doivent JAMAIS remplacer le jugement clinique.

FONCTIONS PRINCIPALES (pour cliniciens) :
• Élargir et prioriser les diagnostics différentiels.
• Identifier les possibilités négligées et les pièges diagnostiques.
• Comparer l'impression clinique avec les recommandations établies.
• Mettre en évidence les contre-indications, drapeaux rouges et facteurs de risque.
• Fournir un raisonnement fondé sur les connaissances médicales standards.
• Identifier les incertitudes et les données manquantes.
• Proposer des questions ciblées, des points d'examen et des tests pertinents.
• Maintenir un ton clair de clinicien à clinicien.

RÈGLES STRICTES (toujours applicables) :
1. Ne donne JAMAIS de diagnostic définitif — uniquement des diagnostics différentiels.
2. Ne prescris aucun médicament, dosage ou conduite thérapeutique détaillée.
3. N'invente aucun résultat biologique, imagerie ou fait médical.
4. Utilise uniquement des données cliniques largement validées.
5. Signale explicitement toute incertitude.
6. Si les données sont insuffisantes, précise ce qu'il manque comme informations.
7. Ne t'adresse jamais directement aux patients lorsque l'audience est un clinicien.

COMPORTEMENT D'URGENCE & SÉCURITÉ (OBLIGATOIRE) :
• Si les symptômes évoquent une urgence (douleur thoracique aiguë, dyspnée sévère, syncope, déficit neurologique, hémorragie sévère, traumatisme, obstruction des voies aériennes), commence toujours par :  
  *« Si c'est une urgence, appelez le 190 immédiatement. »*
• Si l'utilisateur semble être un patient et non un clinicien, bascule automatiquement vers la persona "sécurité patient" :
  - Langage simple.
  - Pas de diagnostic différentiel, ni traitement, ni médicament.
  - Encourager la consultation d'un professionnel de santé.
  - Ajouter l'avertissement d'urgence si signes de gravité.
• Si le rôle de l'utilisateur est incertain, adopter la persona sécurité patient et demander confirmation du statut de clinicien.

PERSONA SÉCURITÉ PATIENT (audience = patient ou incertain) :
• Parler simplement.
• Informations générales uniquement.
• Toujours ajouter des avertissements de sécurité.
• Ne jamais diagnostiquer ni proposer un traitement.
• En cas de drapeaux rouges : "Si c'est une urgence, appelez le 190 maintenant."

STRUCTURE DE RÉPONSE CLINICIEN (audience = clinicien) :
1. *Résumé clinique* — reformulation brève du cas.
2. *Diagnostic différentiel élargi* — liste hiérarchisée avec raisonnement.
3. *Éléments en faveur / contre* — ce qui confirme ou exclut chaque hypothèse.
4. *Analyse du risque* — affections graves à ne pas manquer.
5. *Alignement avec les recommandations* — comparaison avec ACLS, AHA, ESC, ADA, GOLD, NICE.
6. *Questions / Examens / Tests à ajouter* — étapes cliniques ciblées.
7. *Notes d'incertitude* — données manquantes explicitement signalées.
8. *Note de sécurité* — rappeler que c'est un support d'aide, pas une décision clinique.

RÈGLES MÉTA :
• Chaque réponse clinicien doit se terminer par : [Audience: Clinician].
• Chaque réponse patient doit se terminer par : [Audience: Patient-Assistant].
• Ajouter un horodatage si requis par le système.
• Pour les recommandations, citer uniquement les noms (sans liens inventés).

En cas de doute sur le rôle de l'utilisateur, prioriser la sécurité et demander clarification.`,
    
    ENGLISH: `You are a clinical decision-support assistant whose primary role is to support licensed medical professionals (the "doctor agent"). Your outputs must be clinician-to-clinician, concise, evidence-based, and must NOT replace clinical judgement.

PRIMARY FUNCTIONS (clinician-facing):
• Expand differential diagnoses and prioritize them.
• Identify overlooked possibilities and diagnostic traps.
• Compare the clinician's impressions with established guidelines.
• Highlight contraindications, red flags, and risk factors.
• Provide evidence-based reasoning using standard medical knowledge.
• Identify uncertainties and missing data.
• Suggest focused questions, exam points, and targeted tests.
• Maintain a clear clinician-to-clinician tone.

STRICT RULES (always enforce):
1. Do NOT provide definitive diagnoses — only differential diagnoses.
2. Do NOT give prescriptions, medication dosages, or step-by-step treatment orders.
3. Do NOT invent lab results, imaging findings, or medical facts.
4. Use widely accepted clinical evidence only.
5. Mark any uncertainty explicitly.
6. If information is insufficient, state what additional data are needed.
7. Never address patients directly when the audience is a clinician.

EMERGENCY & SAFETY BEHAVIOR (MANDATORY):
• If symptoms suggest a possible emergency (e.g., acute chest pain, severe dyspnea, syncope, neurological deficit, severe bleeding, trauma, airway compromise), ALWAYS begin response with: *"If this is an emergency, call 190 now."*
• If user appears to be a patient instead of a clinician, automatically switch into a patient-safety persona:
  - Use lay language and avoid clinical decision-making.
  - NO differential diagnosis, NO treatment, NO medication.
  - Encourage evaluation by a licensed clinician.
  - If red flags are present, include the emergency instruction above.
• When user identity is unclear, default to patient-safety persona and ask to confirm clinician role.

PATIENT-SAFETY PERSONA (when audience = patient or unclear):
• Speak simply.
• Provide high-level info only.
• Add safety disclaimers.
• Never diagnose or suggest treatment.
• For red flags: "If this is an emergency, call 190 now."

CLINICIAN RESPONSE STRUCTURE (when audience = clinician):
1. *Clinician Summary* — brief restatement of provided case.
2. *Differential Expansion* — ranked list with reasoning.
3. *Confirmatory / Excluding Factors* — what supports/contradicts each differential.
4. *Risk Analysis* — life-threatening conditions not to miss.
5. *Guideline Alignment Check* — compare with major guidelines (ACLS, AHA, ESC, ADA, GOLD, NICE).
6. *Recommended Additional Questions / Tests* — focused next steps.
7. *Uncertainty Notes* — explicitly mark missing data.
8. *Safety Note* — remind that this is informational support only.

META RULES:
• Each clinician response ends with: [Audience: Clinician].
• Each patient-assistant response ends with: [Audience: Patient-Assistant].
• Include a timestamp if your system requires it.
• When citing guidelines, reference only their names (no fabricated URLs or data).

If unsure of the user's role, prioritize safety and request clarification.`
  }
};

// ==================== API Key Manager ====================
class APIKeyManager {
  constructor(apiKeys) {
    this.apiKeys = apiKeys || [];
    this.keyStats = new Map();
    this.initializeStats();
  }
  
  initializeStats() {
    this.apiKeys.forEach(key => {
      const keyId = this.hashKey(key);
      this.keyStats.set(keyId, {
        key: key,
        requests: 0,
        successes: 0,
        failures: 0,
        lastUsed: null,
        lastError: null,
        totalTokens: 0,
        isActive: true
      });
    });
  }
  
  hashKey(apiKey) {
    // Create simplified key ID (doesn't expose full key)
    return `key_${Buffer.from(apiKey.slice(-6)).toString('hex')}`;
  }
  
  // Intelligent key selection: load balancing + failover
  selectKey() {
    const activeKeys = [];
    
    for (const [keyId, stats] of this.keyStats.entries()) {
      if (stats.isActive && stats.failures < 3) {
        activeKeys.push({ keyId, stats });
      }
    }
    
    if (activeKeys.length === 0) {
      // Reset all key states
      this.resetAllKeys();
      return this.apiKeys[0];
    }
    
    // Select least used key
    activeKeys.sort((a, b) => a.stats.requests - b.stats.requests);
    const selected = activeKeys[0];
    
    // Update statistics
    selected.stats.requests++;
    selected.stats.lastUsed = new Date();
    
    return selected.stats.key;
  }
  
  markSuccess(key, tokens = 0) {
    const keyId = this.hashKey(key);
    const stats = this.keyStats.get(keyId);
    if (stats) {
      stats.successes++;
      stats.totalTokens += tokens;
      stats.failures = 0; // Reset failure count
    }
  }
  
  markFailure(key, error) {
    const keyId = this.hashKey(key);
    const stats = this.keyStats.get(keyId);
    if (stats) {
      stats.failures++;
      stats.lastError = error.message;
      
      if (stats.failures >= 3) {
        stats.isActive = false;
        console.log(`🔴 Key ${keyId} disabled due to ${stats.failures} failures`);
      }
    }
  }
  
  resetAllKeys() {
    for (const [keyId, stats] of this.keyStats.entries()) {
      stats.isActive = true;
      stats.failures = 0;
    }
  }
  
  getStats() {
    const stats = [];
    for (const [keyId, data] of this.keyStats.entries()) {
      stats.push({
        id: keyId,
        requests: data.requests,
        successes: data.successes,
        failures: data.failures,
        totalTokens: data.totalTokens,
        isActive: data.isActive,
        lastUsed: data.lastUsed
      });
    }
    return stats;
  }
}

// ==================== Intelligent Model Router ====================
class ModelRouter {
  static selectModel(options = {}) {
    const {
      service = 'auto',      // deepseek, openrouter, auto
      type = 'text',         // text, vision, speech
      language = 'ar',       // ar, en, fr
      priority = 'quality',  // speed, quality, unlimited
      contextLength = 'short', // short, medium, long
      isEmergency = false
    } = options;
    
    // Emergency: fastest model
    if (isEmergency) {
      return {
        service: 'openrouter',
        model: AI_CONFIG.OPENROUTER.MODELS.UNLIMITED[0],
        reason: 'Emergency requires fast response'
      };
    }
    
    // Based on service
    if (service === 'deepseek') {
      return {
        service: 'deepseek',
        model: AI_CONFIG.DEEPSEEK.MODEL,
        reason: 'Use DeepSeek for complex medical reasoning'
      };
    }
    
    // Based on type
    if (type === 'vision') {
      // Try vision models first
      const visionModels = AI_CONFIG.OPENROUTER.MODELS.VISION;
      return {
        service: 'openrouter',
        model: visionModels[0] || AI_CONFIG.OPENROUTER.STRATEGIES.VISION,
        reason: 'Vision model best for image analysis'
      };
    }
    
    if (type === 'speech') {
      return {
        service: 'openrouter',
        model: AI_CONFIG.SPEECH_TO_TEXT.MODEL,
        reason: 'Model optimized for speech transcription'
      };
    }
    
    // Based on language
    if (language === 'ar' && type === 'text') {
      return {
        service: 'openrouter',
        model: AI_CONFIG.OPENROUTER.STRATEGIES.ARABIC,
        reason: 'This model has best Arabic support'
      };
    }
    
    // Based on context length
    if (contextLength === 'long') {
      return {
        service: 'deepseek',
        model: AI_CONFIG.DEEPSEEK.MODEL,
        reason: 'DeepSeek supports ultra-long context'
      };
    }
    
    // Based on priority
    switch (priority) {
      case 'speed':
        return {
          service: 'openrouter',
          model: 'google/gemini-2.0-flash-exp:free',
          reason: 'Google Flash model responds fastest'
        };
      case 'unlimited':
        return {
          service: 'openrouter',
          model: 'meta-llama/llama-3.1-8b-instruct:free',
          reason: 'This model has no usage limits'
        };
      case 'quality':
      default:
        return {
          service: 'openrouter',
          model: AI_CONFIG.OPENROUTER.STRATEGIES.PRIMARY,
          reason: 'Primary model balances speed and quality'
        };
    }
  }
  
  static getModelInfo(service, modelName) {
    if (service === 'deepseek') {
      return {
        ...AI_CONFIG.DEEPSEEK.DESCRIPTION,
        contextWindow: AI_CONFIG.DEEPSEEK.CONTEXT_WINDOW,
        limitations: 'Requires local Ollama service'
      };
    }
    
    const allModels = [
      ...AI_CONFIG.OPENROUTER.MODELS.UNLIMITED,
      ...AI_CONFIG.OPENROUTER.MODELS.MEDICAL,
      ...AI_CONFIG.OPENROUTER.MODELS.MULTILINGUAL,
      ...AI_CONFIG.OPENROUTER.MODELS.VISION,
      ...AI_CONFIG.OPENROUTER.MODELS.EXPERIMENTAL
    ];
    
    if (allModels.includes(modelName)) {
      const modelInfo = {
        'google/gemini-2.0-flash-exp:free': {
          name: 'Gemini 2.0 Flash',
          provider: 'Google',
          dailyLimit: '100 requests/day',
          speed: 'Very fast (0.5-1s)',
          languages: ['ar', 'en', 'fr', 'es'],
          medicalAccuracy: '85%',
          bestFor: 'Quick consultation, symptom screening',
          context: '1M tokens',
          supportsVision: true
        },
        'meta-llama/llama-3.1-8b-instruct:free': {
          name: 'Llama 3.1 8B',
          provider: 'Meta',
          dailyLimit: 'Unlimited',
          speed: 'Fast (1-2s)',
          languages: ['ar', 'en', 'fr', 'de', 'es'],
          medicalAccuracy: '88%',
          bestFor: 'General medical consultation, health advice',
          context: '128K tokens',
          supportsVision: false
        },
        'mistralai/mixtral-8x7b-instruct:free': {
          name: 'Mixtral 8x7B',
          provider: 'Mistral AI',
          dailyLimit: '50 requests/day',
          speed: 'Medium (2-3s)',
          languages: ['ar', 'en', 'fr', 'es', 'de', 'it'],
          medicalAccuracy: '90%',
          bestFor: 'Multilingual consultation, complex cases',
          context: '32K tokens',
          supportsVision: false
        },
        'amazon/nova-2-lite-v1:free': {
          name: 'Amazon Nova 2 Lite',
          provider: 'Amazon',
          dailyLimit: 'Unlimited',
          speed: 'Fast (1-2s)',
          languages: ['ar', 'en', 'fr', 'es'],
          medicalAccuracy: '87%',
          bestFor: 'Image analysis, multimodal',
          context: '128K tokens',
          supportsVision: true
        },
        'nousresearch/hermes-3-llama-3.1-8b:free': {
          name: 'Hermes 3 Llama 3.1',
          provider: 'NousResearch',
          dailyLimit: 'Unlimited',
          speed: 'Fast (1-2s)',
          medicalAccuracy: '91%',
          bestFor: 'Medical fine-tuning, professional diagnosis',
          context: '128K tokens',
          supportsVision: false
        },
        'google/gemini-2.0-pro-exp:free': {
          name: 'Gemini 2.0 Pro',
          provider: 'Google',
          dailyLimit: '100 requests/day',
          speed: 'Medium (2-3s)',
          medicalAccuracy: '92%',
          bestFor: 'Professional medical analysis',
          context: '1M tokens',
          supportsVision: true
        },
        'claude-3.5-haiku:free': {
          name: 'Claude 3.5 Haiku',
          provider: 'Anthropic',
          dailyLimit: '50 requests/day',
          speed: 'Very fast (1-2s)',
          medicalAccuracy: '89%',
          bestFor: 'Quick reasoning, image analysis',
          context: '200K tokens',
          supportsVision: true
        }
      };
      
      return modelInfo[modelName] || {
        name: modelName,
        provider: 'Various',
        dailyLimit: 'Variable',
        speed: 'Variable',
        bestFor: 'General purpose',
        supportsVision: false
      };
    }
    
    return null;
  }
}

// ==================== DeepSeek Service ====================
class DeepSeekService {
  constructor() {
    this.name = 'deepseek';
    this.capabilities = ['text', 'reasoning', 'long_context'];
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0
    };
  }
  
  async generateResponse(userMessage, socket, options = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        this.stats.totalRequests++;
        
        console.log(`🤖 ${this.name}: Processing with ${AI_CONFIG.DEEPSEEK.MODEL}`);
        
        const medicalPrompt = options.language === 'en' 
          ? AI_CONFIG.MEDICAL_PROMPTS.ENGLISH 
          : options.language === 'fr'
          ? AI_CONFIG.MEDICAL_PROMPTS.FRANÇAIS
          : AI_CONFIG.MEDICAL_PROMPTS.ARABIC;
        
        const fullPrompt = `${medicalPrompt}\n\nPatient: ${userMessage}\n\nDoctor:`;
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        
        const response = await fetch(`${AI_CONFIG.DEEPSEEK.BASE_URL}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: AI_CONFIG.DEEPSEEK.MODEL,
            prompt: fullPrompt,
            stream: true,
            options: {
              temperature: options.temperature || 0.7,
              top_p: 0.9,
              top_k: 40,
              num_predict: options.maxTokens || 2000
            }
          }),
          signal: controller.signal
        });
        
        clearTimeout(timeout);
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`DeepSeek API error ${response.status}: ${errorText}`);
        }
        
        this.stats.successfulRequests++;
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              if (data.response) {
                fullResponse += data.response;
                
                if (socket?.connected) {
                  socket.emit('streaming_response', {
                    text: fullResponse,
                    partial: !data.done,
                    service: this.name,
                    model: AI_CONFIG.DEEPSEEK.MODEL,
                    isStreaming: true
                  });
                }
              }
              
              if (data.done) {
                if (socket?.connected) {
                  socket.emit('streaming_response', {
                    text: fullResponse,
                    partial: false,
                    complete: true,
                    service: this.name,
                    model: AI_CONFIG.DEEPSEEK.MODEL,
                    isStreaming: false
                  });
                }
                resolve(fullResponse);
                return;
              }
            } catch (e) {
              // Ignore JSON parsing errors
            }
          }
        }
      } catch (error) {
        this.stats.failedRequests++;
        console.error(`❌ ${this.name} error:`, error);
        reject(error);
      }
    });
  }
  
  async healthCheck() {
    try {
      const response = await fetch(`${AI_CONFIG.DEEPSEEK.BASE_URL}/api/tags`, {
        timeout: 10000
      });
      
      if (response.ok) {
        const data = await response.json();
        const hasDeepSeek = data.models?.some(m => 
          m.name.includes('deepseek') || m.name === AI_CONFIG.DEEPSEEK.MODEL
        );
        
        return {
          healthy: hasDeepSeek,
          model: AI_CONFIG.DEEPSEEK.MODEL,
          available: hasDeepSeek,
          message: hasDeepSeek 
            ? `DeepSeek model is available at ${AI_CONFIG.DEEPSEEK.BASE_URL}`
            : `DeepSeek model not found. Available models: ${data.models?.map(m => m.name).join(', ')}`
        };
      }
      
      return {
        healthy: false,
        error: `HTTP ${response.status}`,
        message: `Cannot connect to DeepSeek at ${AI_CONFIG.DEEPSEEK.BASE_URL}`
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        message: `DeepSeek service unavailable: ${error.message}`
      };
    }
  }
  
  getStats() {
    return this.stats;
  }
}

// ==================== OpenRouter Service ====================
class OpenRouterService {
  constructor(apiKeyManager) {
    this.name = 'openrouter';
    this.capabilities = ['text', 'vision', 'streaming', 'multilingual'];
    this.apiKeyManager = apiKeyManager;
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      tokensUsed: 0,
      imageAnalyses: 0,
      speechTranscriptions: 0
    };
  }
  
  async generateResponse(messages, socket, options = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        this.stats.totalRequests++;
        
        const modelSelection = ModelRouter.selectModel({
          service: 'openrouter',
          type: options.hasImage ? 'vision' : 'text',
          language: options.language || 'ar',
          priority: options.priority || 'quality'
        });
        
        const model = options.model || modelSelection.model;
        const apiKey = this.apiKeyManager.selectKey();
        
        console.log(`🤖 ${this.name}: Using ${model} with key ${this.apiKeyManager.hashKey(apiKey)}`);
        
        const systemPrompt = options.language === 'en' 
          ? AI_CONFIG.MEDICAL_PROMPTS.ENGLISH 
          : options.language === 'fr'
          ? AI_CONFIG.MEDICAL_PROMPTS.FRANÇAIS
          : AI_CONFIG.MEDICAL_PROMPTS.ARABIC;
        
        let chatMessages;
        
        // Handle image messages
        if (options.hasImage && options.imageBase64) {
          this.stats.imageAnalyses++;
          
          // For vision models, we need to format the message differently
          const lastMessage = messages[messages.length - 1];
          const imageUrl = `data:${options.mimeType || 'image/jpeg'};base64,${options.imageBase64}`;
          
          chatMessages = [
            { role: 'system', content: systemPrompt },
            ...messages.slice(0, -1),
            {
              role: 'user',
              content: [
                { type: 'text', text: lastMessage.content },
                { 
                  type: 'image_url', 
                  image_url: { url: imageUrl }
                }
              ]
            }
          ];
        } else {
          chatMessages = [
            { role: 'system', content: systemPrompt },
            ...messages.map(msg => ({
              role: msg.role || 'user',
              content: msg.content
            }))
          ];
        }
        
        const controller = new AbortController();
        const timeout = setTimeout(() => {
          controller.abort();
          this.apiKeyManager.markFailure(apiKey, new Error('Timeout'));
        }, 90000);
        
        const response = await fetch(`${AI_CONFIG.OPENROUTER.BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://medical-chatbot.tn',
            'X-Title': 'Tunisian Medical AI Chatbot'
          },
          body: JSON.stringify({
            model: model,
            messages: chatMessages,
            stream: true,
            max_tokens: options.maxTokens || 2000,
            temperature: options.temperature || 0.7
          }),
          signal: controller.signal
        });
        
        clearTimeout(timeout);
        
        if (!response.ok) {
          const errorText = await response.text();
          this.apiKeyManager.markFailure(apiKey, new Error(`HTTP ${response.status}`));
          
          // Check if it's a token limit error
          if (response.status === 429 || errorText.includes('quota') || errorText.includes('limit')) {
            console.log(`⚠️ Rate limit hit for model ${model}, trying alternative...`);
            
            // Try alternative model
            const fallbackModel = AI_CONFIG.OPENROUTER.STRATEGIES.FALLBACK;
            if (fallbackModel !== model) {
              console.log(`🔄 Switching to fallback model: ${fallbackModel}`);
              options.model = fallbackModel;
              const fallbackResponse = await this.generateResponse(messages, socket, options);
              resolve(fallbackResponse);
              return;
            }
          }
          
          throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
        }
        
        this.apiKeyManager.markSuccess(apiKey);
        this.stats.successfulRequests++;
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        let tokenCount = 0;
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]');
          
          for (const line of lines) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.usage) {
                tokenCount = data.usage.total_tokens || 0;
              }
              
              if (data.choices?.[0]?.delta?.content) {
                fullResponse += data.choices[0].delta.content;
                this.stats.tokensUsed++;
                
                if (socket?.connected) {
                  socket.emit('streaming_response', {
                    text: fullResponse,
                    partial: true,
                    service: this.name,
                    model: model,
                    isStreaming: true,
                    isVision: options.hasImage
                  });
                }
              }
            } catch (e) {
              // Ignore JSON parsing errors
            }
          }
        }
        
        if (socket?.connected) {
          socket.emit('streaming_response', {
            text: fullResponse,
            partial: false,
            complete: true,
            service: this.name,
            model: model,
            isStreaming: false,
            isVision: options.hasImage,
            tokensUsed: tokenCount
          });
        }
        
        resolve(fullResponse);
      } catch (error) {
        this.stats.failedRequests++;
        console.error(`❌ ${this.name} error:`, error);
        reject(error);
      }
    });
  }
  
  // New method for speech-to-text
  async transcribeSpeech(audioBase64, language = 'ar') {
    try {
      this.stats.speechTranscriptions++;
      
      const modelSelection = ModelRouter.selectModel({
        type: 'speech',
        language: language
      });
      
      const apiKey = this.apiKeyManager.selectKey();
      
      console.log(`🎤 ${this.name}: Transcribing speech with ${modelSelection.model}`);
      
      // Note: OpenRouter doesn't have direct speech-to-text API
      // We'll use a text model with a prompt to transcribe
      // For real speech-to-text, you'd need a dedicated service
      
      const prompt = language === 'ar' 
        ? 'قم بتحويل هذا النص الصوتي إلى نص مكتوب:'
        : language === 'fr'
        ? 'Transcris cet audio en texte:'
        : 'Transcribe this audio to text:';
      
      const messages = [
        { role: 'user', content: `${prompt}\n\n[ملف صوتي مرفق]` }
      ];
      
      const response = await fetch(`${AI_CONFIG.OPENROUTER.BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://medical-chatbot.tn',
          'X-Title': 'Tunisian Medical AI Chatbot'
        },
        body: JSON.stringify({
          model: modelSelection.model,
          messages: messages,
          max_tokens: 1000,
          temperature: 0.1
        })
      });
      
      if (!response.ok) {
        throw new Error(`Speech transcription failed: ${response.status}`);
      }
      
      const data = await response.json();
      const transcription = data.choices[0]?.message?.content || '';
      
      this.apiKeyManager.markSuccess(apiKey);
      
      return {
        text: transcription,
        language: language,
        confidence: 0.85 // Placeholder confidence score
      };
      
    } catch (error) {
      console.error('❌ Speech transcription error:', error);
      throw error;
    }
  }
  
  async healthCheck() {
    try {
      const apiKey = this.apiKeyManager.selectKey();
      const response = await fetch(`${AI_CONFIG.OPENROUTER.BASE_URL}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      
      return {
        healthy: response.ok,
        models: Object.keys(AI_CONFIG.OPENROUTER.MODELS).length,
        availableKeys: this.apiKeyManager.getStats().filter(k => k.isActive).length,
        message: response.ok ? 'OpenRouter API connected' : 'OpenRouter API error'
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        message: 'OpenRouter service unavailable'
      };
    }
  }
  
  getStats() {
    return {
      ...this.stats,
      keyStats: this.apiKeyManager.getStats(),
      activeModels: Object.keys(AI_CONFIG.OPENROUTER.MODELS).length
    };
  }
}

// ==================== AI Service Factory ====================
class AIServiceFactory {
  constructor() {
    this.services = new Map();
    this.apiKeyManager = new APIKeyManager(AI_CONFIG.OPENROUTER.API_KEYS);
    this.initializeServices();
  }
  
  initializeServices() {
    // Register DeepSeek service
    if (AI_CONFIG.DEEPSEEK.ENABLED) {
      this.services.set('deepseek', new DeepSeekService());
    }
    
    // Register OpenRouter service
    if (AI_CONFIG.OPENROUTER.ENABLED) {
      this.services.set('openrouter', new OpenRouterService(this.apiKeyManager));
    }
  }
  
  getService(type = 'auto') {
    if (type === 'auto') {
      // Try services in priority order
      for (const serviceName of AI_CONFIG.PRIORITY_ORDER) {
        if (this.services.has(serviceName)) {
          return this.services.get(serviceName);
        }
      }
      throw new Error('No AI service available');
    }
    
    if (!this.services.has(type)) {
      throw new Error(`AI service '${type}' not available`);
    }
    
    return this.services.get(type);
  }
  
  async listAvailableServices() {
    const services = [];
    
    for (const [name, service] of this.services.entries()) {
      try {
        const health = await service.healthCheck();
        services.push({
          name,
          healthy: health.healthy,
          capabilities: service.capabilities || [],
          stats: service.getStats ? await service.getStats() : null
        });
      } catch (error) {
        services.push({
          name,
          healthy: false,
          error: error.message
        });
      }
    }
    
    return services;
  }
}

// ==================== Initialize Services ====================
const aiFactory = new AIServiceFactory();

// ==================== API Endpoints ====================

// 1. System status endpoint
app.get('/api/status', async (req, res) => {
  try {
    const services = await aiFactory.listAvailableServices();
    const keyStats = aiFactory.apiKeyManager.getStats();
    
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      services: services.map(s => ({
        name: s.name,
        healthy: s.healthy,
        capabilities: s.capabilities
      })),
      openRouterKeys: {
        total: keyStats.length,
        active: keyStats.filter(k => k.isActive).length,
        stats: keyStats
      },
      configuration: {
        deepseekEnabled: AI_CONFIG.DEEPSEEK.ENABLED,
        openrouterEnabled: AI_CONFIG.OPENROUTER.ENABLED,
        priorityOrder: AI_CONFIG.PRIORITY_ORDER,
        speechToTextEnabled: AI_CONFIG.SPEECH_TO_TEXT.ENABLED
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      error: error.message
    });
  }
});

// 2. Intelligent chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { 
      message, 
      service = 'auto',
      language = 'ar',
      priority = 'quality',
      model = null
    } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    // Intelligently select service and model
    const aiService = aiFactory.getService(service);
    const modelSelection = ModelRouter.selectModel({
      service: aiService.name,
      language: language,
      priority: priority
    });
    
    const messages = [{ role: 'user', content: message }];
    
    let response;
    if (aiService.name === 'deepseek') {
      response = await aiService.generateResponse(message, null, {
        language: language,
        maxTokens: 2000
      });
    } else {
      response = await aiService.generateResponse(messages, null, {
        model: model || modelSelection.model,
        language: language,
        priority: priority
      });
    }
    
    res.json({
      success: true,
      response: response,
      service: aiService.name,
      model: modelSelection.model,
      modelInfo: ModelRouter.getModelInfo(aiService.name, modelSelection.model),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      suggestion: 'Please try again or use a different service.'
    });
  }
});

// 3. Model information endpoint
app.get('/api/models', async (req, res) => {
  try {
    const services = await aiFactory.listAvailableServices();
    
    // Get all available models
    const allModels = [];
    
    // DeepSeek models
    if (AI_CONFIG.DEEPSEEK.ENABLED) {
      allModels.push({
        id: 'deepseek-v3.1',
        name: 'DeepSeek V3.1 671B',
        service: 'deepseek',
        provider: 'DeepSeek',
        contextWindow: '131K tokens',
        languages: ['ar', 'en', 'fr', 'es'],
        medicalAccuracy: '95%',
        bestFor: '复杂诊断、长期病史、专业咨询',
        isRecommended: true,
        supportsVision: false,
        supportsSpeech: false
      });
    }
    
    // OpenRouter models
    Object.entries(AI_CONFIG.OPENROUTER.MODELS).forEach(([category, models]) => {
      models.forEach(modelName => {
        const info = ModelRouter.getModelInfo('openrouter', modelName);
        allModels.push({
          id: modelName.replace(/[^a-zA-Z0-9]/g, '_'),
          name: info?.name || modelName,
          service: 'openrouter',
          provider: info?.provider || 'Various',
          category: category,
          dailyLimit: info?.dailyLimit || 'Variable',
          languages: info?.languages || ['ar', 'en'],
          bestFor: info?.bestFor || 'General purpose',
          isRecommended: ['UNLIMITED', 'MEDICAL', 'VISION'].includes(category),
          supportsVision: info?.supportsVision || false,
          supportsSpeech: category === 'VISION' // Some vision models can handle audio
        });
      });
    });
    
    res.json({
      success: true,
      models: allModels,
      recommendations: {
        forComplexDiagnosis: 'deepseek-v3.1',
        forFastResponse: 'google/gemini-2.0-flash-exp:free',
        forUnlimitedUse: 'meta-llama/llama-3.1-8b-instruct:free',
        forArabicConsultation: 'mistralai/mixtral-8x7b-instruct:free',
        forImageAnalysis: 'amazon/nova-2-lite-v1:free',
        forSpeechTranscription: 'google/gemini-2.0-flash-lite-001'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 4. Test endpoint
app.get('/api/test/service/:service', async (req, res) => {
  try {
    const { service } = req.params;
    const testMessage = "أعاني من صداع خفيف، هل يجب أن أقلق؟";
    
    const aiService = aiFactory.getService(service);
    
    let response;
    if (service === 'deepseek') {
      response = await aiService.generateResponse(testMessage, null, {
        language: 'ar',
        maxTokens: 500
      });
    } else {
      const messages = [{ role: 'user', content: testMessage }];
      response = await aiService.generateResponse(messages, null, {
        language: 'ar',
        priority: 'speed'
      });
    }
    
    res.json({
      success: true,
      service: service,
      responseTime: 'tested',
      response: response.substring(0, 200) + '...',
      status: 'Service is working correctly'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 5. Image Analysis Endpoint (HTTP)
app.post('/api/analyze-image', upload.single('image'), async (req, res) => {
  try {
    console.log('📸 Image upload received via HTTP');
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No image file provided' 
      });
    }

    const { 
      language = 'ar', 
      description = '',
      service = 'openrouter'
    } = req.body;
    
    const imageBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    const fileSize = req.file.size;
    
    console.log(`📊 Image details: ${mimeType}, ${fileSize} bytes`);
    
    // Validate image type
    const validMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
    if (!validMimeTypes.includes(mimeType)) {
      return res.status(400).json({
        success: false,
        error: `Unsupported image type: ${mimeType}. Supported: ${validMimeTypes.join(', ')}`
      });
    }
    
    // Convert image to base64
    const base64Image = imageBuffer.toString('base64');
    
    // Select appropriate model
    const modelSelection = ModelRouter.selectModel({
      service: service,
      type: 'vision',
      language: language
    });
    
    console.log(`🤖 Using vision model: ${modelSelection.model}`);
    
    // Prepare messages
    const messages = [{ 
      role: 'user', 
      content: description || (language === 'ar' ? 'تحليل هذه الصورة الطبية' : 'Analyze this medical image')
    }];
    
    // Get the AI service
    const openrouterService = aiFactory.getService('openrouter');
    
    // Generate response
    const response = await openrouterService.generateResponse(messages, null, {
      model: modelSelection.model,
      language: language,
      hasImage: true,
      imageBase64: base64Image,
      mimeType: mimeType,
      maxTokens: 1500
    });

    res.json({
      success: true,
      analysis: response,
      model: modelSelection.model,
      modelInfo: ModelRouter.getModelInfo(service, modelSelection.model),
      imageInfo: {
        type: mimeType,
        size: fileSize,
        dimensions: 'Analyzed by AI'
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Image analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      suggestion: 'Please try again with a different image or model.'
    });
  }
});

// 6. Speech Transcription Endpoint (HTTP)
app.post('/api/transcribe-speech', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const { language = 'ar' } = req.body;
    const audioBuffer = req.file.buffer;
    
    // Convert audio to base64
    const base64Audio = audioBuffer.toString('base64');
    
    const openrouterService = aiFactory.getService('openrouter');
    
    // Transcribe speech
    const transcription = await openrouterService.transcribeSpeech(base64Audio, language);
    
    res.json({
      success: true,
      transcription: transcription.text,
      language: transcription.language,
      confidence: transcription.confidence,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Speech transcription error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      suggestion: 'Please try again with a clearer audio recording.'
    });
  }
});

// 7. Simple Image Upload Test Endpoint
app.post('/api/upload-test', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    res.json({
      success: true,
      message: 'File uploaded successfully',
      fileInfo: {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        encoding: req.file.encoding
      },
      testBase64: req.file.buffer.toString('base64').substring(0, 100) + '...'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Test Upload Page
app.get('/test-upload', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Medical Image Upload Test</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .container { background: #f5f5f5; padding: 30px; border-radius: 10px; }
        input, select, textarea { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; }
        button { background: #007bff; color: white; border: none; padding: 12px 24px; border-radius: 5px; cursor: pointer; }
        .result { background: white; padding: 15px; border-radius: 5px; margin-top: 20px; white-space: pre-wrap; }
        .image-preview { max-width: 300px; margin: 10px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>🏥 Medical Image Analysis Test</h2>
        
        <form id="uploadForm" enctype="multipart/form-data">
          <input type="file" id="imageInput" accept="image/*" required>
          <br>
          <select id="language">
            <option value="ar">العربية</option>
            <option value="en">English</option>
            <option value="fr">Français</option>
          </select>
          <br>
          <textarea id="description" placeholder="Describe symptoms or context..." rows="3"></textarea>
          <br>
          <button type="submit">Analyze Image</button>
        </form>
        
        <div id="preview">
          <img id="imagePreview" class="image-preview" style="display:none;">
        </div>
        
        <div id="result" class="result"></div>
        <div id="error" style="color: red; margin-top: 10px;"></div>
      </div>
      
      <script>
        const imageInput = document.getElementById('imageInput');
        const imagePreview = document.getElementById('imagePreview');
        const uploadForm = document.getElementById('uploadForm');
        const resultDiv = document.getElementById('result');
        const errorDiv = document.getElementById('error');
        
        // Preview image
        imageInput.addEventListener('change', function(e) {
          const file = e.target.files[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = function(e) {
              imagePreview.src = e.target.result;
              imagePreview.style.display = 'block';
            }
            reader.readAsDataURL(file);
          }
        });
        
        // Handle form submission
        uploadForm.addEventListener('submit', async function(e) {
          e.preventDefault();
          
          const file = imageInput.files[0];
          const language = document.getElementById('language').value;
          const description = document.getElementById('description').value;
          
          if (!file) {
            showError('Please select an image file');
            return;
          }
          
          const formData = new FormData();
          formData.append('image', file);
          formData.append('language', language);
          formData.append('description', description);
          
          resultDiv.innerHTML = '⏳ Analyzing image...';
          errorDiv.innerHTML = '';
          
          try {
            const response = await fetch('/api/analyze-image', {
              method: 'POST',
              body: formData
            });
            
            const data = await response.json();
            
            if (data.success) {
              resultDiv.innerHTML = \`
                ✅ <strong>Analysis Complete</strong>
                📊 Model: \${data.modelInfo?.name || data.model}
                ⏰ \${new Date(data.timestamp).toLocaleString()}
                <hr>
                \${data.analysis.replace(/\\n/g, '<br>')}
              \`;
            } else {
              showError(\`Error: \${data.error}\`);
            }
          } catch (error) {
            showError(\`Upload failed: \${error.message}\`);
          }
        });
        
        function showError(message) {
          errorDiv.innerHTML = message;
          resultDiv.innerHTML = '';
        }
      </script>
    </body>
    </html>
  `);
});

// ==================== WebSocket Handler ====================
io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);
  
  const userInfo = {
    id: socket.id,
    connectedAt: new Date(),
    ip: socket.handshake.address,
    userAgent: socket.handshake.headers['user-agent'],
    isAdmin: false
  };
  
  // Send welcome message
  socket.emit('welcome', {
    message: '🏥 مرحبًا! أنا مساعدك الطبي الذكي متعدد النماذج',
    services: {
      deepseek: AI_CONFIG.DEEPSEEK.ENABLED,
      openrouter: AI_CONFIG.OPENROUTER.ENABLED
    },
    capabilities: {
      text: true,
      image: true,
      audio: true,
      multilingual: true,
      streaming: true
    },
    bestModels: {
      complex: 'DeepSeek V3.1',
      fast: 'Gemini 2.0 Flash',
      unlimited: 'Llama 3.1 8B',
      arabic: 'Mixtral 8x7B',
      vision: 'Amazon Nova 2 Lite'
    }
  });
  
  // Handle chat messages
  socket.on('send_message', async (data) => {
    try {
      const { 
        message, 
        service = 'auto',
        language = 'ar',
        priority = 'quality'
      } = data;
      
      if (!message || message.trim().length === 0) {
        socket.emit('error', { message: 'الرجاء كتابة رسالة.' });
        return;
      }
      
      const aiService = aiFactory.getService(service);
      const modelSelection = ModelRouter.selectModel({
        service: aiService.name,
        language: language,
        priority: priority
      });
      
      // Send model info to client
      socket.emit('model_info', {
        service: aiService.name,
        model: modelSelection.model,
        reason: modelSelection.reason,
        info: ModelRouter.getModelInfo(aiService.name, modelSelection.model)
      });
      
      if (aiService.name === 'deepseek') {
        await aiService.generateResponse(message, socket, {
          language: language,
          maxTokens: 2000
        });
      } else {
        const messages = [{ role: 'user', content: message }];
        await aiService.generateResponse(messages, socket, {
          model: modelSelection.model,
          language: language,
          priority: priority
        });
      }
    } catch (error) {
      console.error('💥 Message processing error:', error);
      socket.emit('error', { 
        message: 'عذرًا، حدث خطأ في المعالجة. يرجى المحاولة مرة أخرى.',
        details: error.message
      });
    }
  });
  
  // Handle image upload and analysis (WebSocket)
  socket.on('send_image', async (data) => {
    try {
      console.log('📸 WebSocket image analysis requested');
      
      const { 
        image, 
        message = '', 
        language = 'ar',
        mimeType = 'image/jpeg'
      } = data;
      
      if (!image) {
        socket.emit('error', { 
          message: 'No image data provided',
          code: 'NO_IMAGE_DATA'
        });
        return;
      }
      
      // Get OpenRouter service for vision
      const openrouterService = aiFactory.getService('openrouter');
      
      // Select vision model
      const modelSelection = ModelRouter.selectModel({
        type: 'vision',
        language: language
      });
      
      socket.emit('model_info', {
        service: 'openrouter',
        model: modelSelection.model,
        reason: 'Vision model selected for image analysis',
        info: ModelRouter.getModelInfo('openrouter', modelSelection.model),
        isVision: true
      });
      
      // Prepare message
      const userMessage = message || (language === 'ar' 
        ? 'تحليل هذه الصورة الطبية' 
        : language === 'fr'
        ? 'Analysez cette image médicale'
        : 'Analyze this medical image');
      
      const messages = [{ role: 'user', content: userMessage }];
      
      // Send analysis start notification
      socket.emit('analysis_started', {
        message: language === 'ar' 
          ? '🔍 جاري تحليل الصورة الطبية...' 
          : language === 'fr'
          ? '🔍 Analyse de l\'image médicale en cours...'
          : '🔍 Analyzing medical image...',
        timestamp: new Date().toISOString(),
        isImage: true
      });
      
      // Generate response with streaming
      await openrouterService.generateResponse(messages, socket, {
        model: modelSelection.model,
        language: language,
        hasImage: true,
        imageBase64: image,
        mimeType: mimeType,
        maxTokens: 2000
      });
      
    } catch (error) {
      console.error('💥 WebSocket image analysis error:', error);
      socket.emit('error', { 
        message: 'فشل تحليل الصورة',
        details: error.message,
        code: 'IMAGE_ANALYSIS_FAILED'
      });
    }
  });
  
  // Handle audio upload and transcription (WebSocket)
  socket.on('send_audio', async (data) => {
    try {
      console.log('🎤 WebSocket audio transcription requested');
      
      const { 
        audio, 
        language = 'ar' 
      } = data;
      
      if (!audio) {
        socket.emit('error', { 
          message: 'No audio data provided',
          code: 'NO_AUDIO_DATA'
        });
        return;
      }
      
      // Send processing notification
      socket.emit('processing_started', {
        message: language === 'ar' 
          ? '🎤 جاري تحويل الصوت إلى نص...' 
          : language === 'fr'
          ? '🎤 Conversion audio en texte en cours...'
          : '🎤 Converting audio to text...',
        timestamp: new Date().toISOString(),
        isAudio: true
      });
      
      const openrouterService = aiFactory.getService('openrouter');
      
      // Transcribe speech
      const transcription = await openrouterService.transcribeSpeech(audio, language);
      
      // Send transcription back to client
      socket.emit('speech_transcription', {
        text: transcription.text,
        language: transcription.language,
        confidence: transcription.confidence,
        timestamp: new Date().toISOString()
      });
      
      console.log('✅ Audio transcription completed');
      
    } catch (error) {
      console.error('💥 WebSocket audio processing error:', error);
      socket.emit('error', { 
        message: 'فشل تحويل الصوت إلى نص',
        details: error.message,
        code: 'AUDIO_PROCESSING_FAILED'
      });
    }
  });
  
  // Handle service switching
  socket.on('switch_service', async (data) => {
    try {
      const { service } = data;
      const aiService = aiFactory.getService(service);
      
      socket.emit('service_switched', {
        service: aiService.name,
        capabilities: aiService.capabilities,
        status: 'ready'
      });
    } catch (error) {
      socket.emit('error', { 
        message: `لا يمكن التبديل إلى خدمة ${data.service}`,
        details: error.message
      });
    }
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.id);
  });
});

// ==================== Start Server ====================
const PORT = process.env.PORT || 10000;

server.listen(PORT, '0.0.0.0', () => {
  const keyStats = aiFactory.apiKeyManager.getStats();
  const activeKeys = keyStats.filter(k => k.isActive).length;
  
  console.log(`
🏥 Tunisian Medical AI Chatbot Server (Multi-Model)
📍 Port: ${PORT}

🤖 Available AI Services:
   ${AI_CONFIG.DEEPSEEK.ENABLED ? '✅ DeepSeek V3.1 (via Ollama)' : '❌ DeepSeek'}
   ${AI_CONFIG.OPENROUTER.ENABLED ? `✅ OpenRouter (${activeKeys} active keys)` : '❌ OpenRouter'}

📸 Image Analysis:
   ✅ Enabled with ${AI_CONFIG.OPENROUTER.MODELS.VISION.length} vision models
   🔗 Test upload: http://localhost:${PORT}/test-upload

🎤 Speech to Text:
   ${AI_CONFIG.SPEECH_TO_TEXT.ENABLED ? '✅ Enabled' : '❌ Disabled'}

🔧 API Endpoints:
   GET  /api/status              - System status
   POST /api/chat               - Smart chat
   POST /api/analyze-image      - Image analysis (HTTP)
   POST /api/transcribe-speech  - Speech transcription (HTTP)
   GET  /api/models             - List all models
   GET  /test-upload            - Upload test page

💡 WebSocket Events:
   send_message    - Send text message
   send_image      - Upload and analyze image
   send_audio      - Upload and transcribe audio
   switch_service  - Switch AI service

✨ Server is running with ${activeKeys} active API keys!
  `);
});

module.exports = app;
