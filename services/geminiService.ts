
import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { SrtSegment, ReferenceImage } from "../types";

export const ensureApiKey = async (): Promise<boolean> => {
  if (typeof window !== 'undefined' && window.aistudio && window.aistudio.hasSelectedApiKey) {
    const hasKey = await window.aistudio.hasSelectedApiKey();
    if (!hasKey) {
      try {
        await window.aistudio.openSelectKey();
        // After opening, we assume success or the user will try again
        return true;
      } catch (e) { 
        console.error("Error opening key selector:", e);
        return false; 
      }
    }
  }
  return true; 
};

const SAFETY_INSTRUCTIONS = `
CRITICAL VISUAL SAFETY RULES:
1. PROHIBITED: Explicit blood, open wounds, weapons pointing directly at the camera.
2. PROHIBITED: Violence against children.
3. STYLE: Absolutely CINEMATIC, photorealistic, dramatic lighting, professional cinematography. DO NOT USE 3D OR CARTOON STYLE.
`;

const IMAGE_MODELS_CONFIG = [
  { name: "imagen-3.0-generate-001", method: "generateImages" },
  { name: "imagen-3.0-fast-generate-001", method: "generateImages" },
  { name: "gemini-2.5-flash-image", method: "generateContent" }
];

const VIDEO_MODELS_CONFIG = [
  { name: "veo-3.1-lite-generate-preview", method: "generateVideo" }
];

export const VISUAL_STYLES = {
  // HISTÓRICOS/VINTAGE
  vintage_70s: "Vintage 70s Kodachrome aesthetic, heavy film grain, warm saturated colors, slight light leaks, nostalgic documentary look.",
  newspaper: "Historical newspaper archive aesthetic, high ISO black and white grain, harsh direct flash, high contrast, 1950s press photography style.",
  surveillance: "Surveillance CCTV footage, 4:3 aspect ratio artifacts, VHS tracking noise, greenish low-resolution tint, security camera overhead angle.",
  
  // VIOLENTOS/SOMBRIOS
  dark_noir: "Dark Noir, extreme chiaroscuro, heavy silhouettes, wet asphalt reflections, dramatic moody shadows, cinematic crime thriller atmosphere.",
  police_raid: "Police Raid documentary style, shaky handheld camera, tactical lighting, intense motion, high-speed shutter, gritty urban realism.",
  street_warfare: "Street Warfare zone, smoke and debris, muted desaturated colors, long lens compression, handheld gritty cinematography, chaos and intensity.",
  cemetery: "Cemetery Funeral aesthetic, solemn and mourning atmosphere, black and white or muted cold tones, respectful wide shots, dramatic soft lighting.",
  prison: "Prison Institutional look, cold fluorescent lighting, greenish/gray concrete textures, harsh shadows, clinical and suffocating atmosphere.",
  
  // LUXO/OSTENTAÇÃO
  mansion: "Modern Mansion luxury, gold and marble accents, warm opulent lighting, wide angle architectural shots, shallow depth of field on expensive details.",
  luxury_lifestyle: "Luxury Lifestyle, high-gloss Instagram aesthetic, vibrant saturated colors, sun-drenched lens flares, glamorous high-fashion lighting.",
  nightclub: "Neon Nightclub party, purple and blue LED lighting, anamorphic lens flares, motion blur, fast-paced strobe effects, vibrant nightlife mood.",
  
  // OPERACIONAIS/TÉCNICOS
  drug_lab: "Clandestine Drug Lab, chemical green and orange color grading, industrial equipment, hazy vapor atmosphere, dimly lit gritty realism.",
  helicopter: "Helicopter Surveillance, high altitude thermal imaging (FLIR) or high-zoom gimbal look, slight vibration, long-distance aerial perspective.",
  courtroom: "Formal Courtroom drama, balanced traditional lighting, wooden textures, institutional atmosphere, medium-shot legal drama aesthetic.",
  airport: "Industrial Airport Port, massive containers, heavy machinery, cold blue morning light, sprawling logistical scale, hazy distance.",
  modern: "Modern Cinematic Blockbuster, IMAX composition, polished high-end lighting, teal and orange color grading, epic scale.",
  
  // LOCAÇÕES ESPECÍFICAS
  border: "Border Desert crossing, warm nocturnal palette, orange moonlight, heat haze, high-contrast silhouettes, wide cinematic vistas.",
  jungle: "Jungle Operation, dense tropical foliage, dappled sunlight, humid mist, deep greens and earthy browns, tactical jungle stealth mood.",
  desert: "Arid Desert route, extreme heat shimmer, blinding sunlight, yellowish dust, parched earth textures, high-key sun-drenched cinematography.",
  underground: "Underground Tunnel, claustrophobic framing, low-key lighting, dripping water, earthy damp textures, emergency red or dim yellow lights."
};

export const generateCinematicImage = async (
  promptText: string, 
  referenceImages: ReferenceImage[] = [], 
  apiKey?: string, 
  startTime: number = 0, 
  totalDuration: number = 0,
  sceneId?: number,
  visualStyle: string = "modern"
): Promise<string> => {
  const key = apiKey || process.env.API_KEY;
  const ai = new GoogleGenAI({ apiKey: key });

  const styleDescription = VISUAL_STYLES[visualStyle as keyof typeof VISUAL_STYLES] || VISUAL_STYLES.modern;

  // Prepend Cena XX if not present and clean prompt from high-res keywords
  let processedPrompt = promptText.replace(/\b(8k|4k|2k|ultra hd|hd|high resolution|hdr|high res|uhd|16k)\b/gi, "").trim();
  if (sceneId !== undefined && !processedPrompt.toLowerCase().startsWith("cena")) {
    processedPrompt = `Cena ${sceneId.toString().padStart(2, '0')}: ${processedPrompt}`;
  }

  // Detección de CTA en Español
  const isEarlyOrLate = startTime < 45 || (totalDuration > 0 && (totalDuration - startTime) < 45);
  const ctaKeywords = ['suscríbete', 'suscribete', 'like', 'me gusta', 'campanita', 'notificaciones', 'compartir', 'canal', 'síguenos', 'siguenos'];
  const hasCtaKeywords = ctaKeywords.some(k => processedPrompt.toLowerCase().includes(k));
  const isCTA = isEarlyOrLate && hasCtaKeywords;
  
  // Estilo CINEMÁTICO UNIVERSAL
  let stylePrompt = `Hyper-realistic cinematic shot, professional film cinematography, high-end production value, masterfully composed. STYLE GUIDE: ${styleDescription}`;
  let textConstraint = "ABSOLUTELY NO TEXT, NO SUBTITLES, NO WATERMARKS, NO LOGOS. ";

  if (isCTA) {
    stylePrompt = `Cinematic high-end production with professional motion graphics and typography integrated naturally into the scene. The style should reach the following aesthetic: ${styleDescription}`;
    textConstraint = "THE ONLY ALLOWED TEXT IS IN SPANISH: 'Suscríbete', 'Dale Like' or 'Síguenos'. IT MUST LOOK LIKE A PROFESSIONAL MOTION GRAPHIC OVERLAY INTEGRATED INTO THE FILM. ";
  }

  const finalPrompt = `
    ${SAFETY_INSTRUCTIONS}
    STYLE: ${stylePrompt}. 
    VISUAL SCENE: ${processedPrompt}. 
    COMPOSITION: Use professional cinematic framing (Rule of Thirds, Golden Ratio, Deep Depth of Field or Bokeh as appropriate for the scene). 
    LIGHTING: Professional film lighting (Three-point lighting, naturalistic light, or dramatic shadows depending on the mood).
    TEXT CONSTRAINT: ${textConstraint}. 
    Aspect ratio 16:9. 
  `;

  // Prepara partes para Gemini (generateContent)
  const geminiParts: any[] = [];
  if (!isCTA) {
    const promptLower = promptText.toLowerCase();
    const scoredRefs = referenceImages.map(ref => {
      const nameLower = ref.name.toLowerCase();
      const nameWords = nameLower.split(/[\s_-]+/).filter(w => w.length > 2);
      let score = 0;
      if (promptLower.includes(nameLower)) score += 10;
      nameWords.forEach(word => {
        if (promptLower.includes(word)) score += 2;
      });
      return { ref, score };
    });

    const refsToUse = scoredRefs
      .filter(item => item.score > 0 || referenceImages.length <= 3)
      .sort((a, b) => b.score - a.score)
      .map(item => item.ref)
      .slice(0, 3);

    const finalRefs = refsToUse.length > 0 ? refsToUse : referenceImages.slice(0, 3);
    finalRefs.forEach(ref => {
      const matches = ref.data.match(/^data:(.+);base64,(.+)$/);
      if (matches) {
        geminiParts.push({ inlineData: { mimeType: matches[1], data: matches[2] } });
        geminiParts.push({ text: `Visual reference for "${ref.name}". Maintain strict visual consistency.` });
      }
    });
  }
  geminiParts.push({ text: finalPrompt });

  // TENTA MODELOS EM SEQUÊNCIA SE HOUVER QUOTA EXCEEDED
  for (let m = 0; m < IMAGE_MODELS_CONFIG.length; m++) {
    const { name: currentModel, method } = IMAGE_MODELS_CONFIG[m];
    try {
      if (method === "generateContent") {
        const response: GenerateContentResponse = await ai.models.generateContent({
          model: currentModel,
          contents: { parts: geminiParts },
          config: { imageConfig: { aspectRatio: "16:9" } }
        });

        const imgPart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
        if (imgPart?.inlineData) return `data:image/png;base64,${imgPart.inlineData.data}`;
      } else if (method === "generateImages") {
        // Fallback para Imagen (Suporta menos referências por padrão, enviamos só o prompt por enquanto)
        const response = await (ai.models as any).generateImages({
          model: currentModel,
          prompt: finalPrompt,
          config: {
            numberOfImages: 1,
            aspectRatio: '16:9',
          },
        });
        const base64 = response.generatedImages?.[0]?.image?.imageBytes;
        if (base64) return `data:image/png;base64,${base64}`;
      }
      
      if (m === IMAGE_MODELS_CONFIG.length - 1) {
        throw new Error("A IA não gerou uma imagem nesse prompt.");
      }
    } catch (error: any) {
      const errorMsg = (error.message || "").toUpperCase();
      console.error(`Image Generation Error [${currentModel}]:`, error);

      // Se o modelo não for encontrado (404) ou se houver erro de cota (429), tentamos o próximo
      const isQuotaError = errorMsg.includes("429") || errorMsg.includes("QUOTA") || errorMsg.includes("LIMIT");
      const isNotFoundError = errorMsg.includes("404") || errorMsg.includes("NOT_FOUND") || errorMsg.includes("NOT FOUND");

      if (isQuotaError || isNotFoundError) {
        if (m < IMAGE_MODELS_CONFIG.length - 1) {
          console.warn(`Erro no modelo ${currentModel} (${isNotFoundError ? 'Não encontrado' : 'Cota'}). Alternando para ${IMAGE_MODELS_CONFIG[m+1].name}...`);
          continue; 
        } else {
          throw isQuotaError ? new Error("QUOTA_EXCEEDED") : error;
        }
      }
      
      if (errorMsg.includes("PERMISSION_DENIED") || errorMsg.includes("403")) {
        if (errorMsg.includes("DENIED ACCESS")) {
          throw new Error("PROJETO_BLOQUEADO: Seu projeto no Google Cloud foi negado acesso aos modelos de IA. Isso geralmente acontece se a API de IA Generativa não estiver habilitada ou se a conta tiver restrições de faturamento/região.");
        }
        if (typeof window !== 'undefined' && window.aistudio && window.aistudio.openSelectKey) {
          continue; // Tenta o próximo modelo se for erro de permissão (talvez o modelo seja restrito)
        }
      }
      throw error;
    }
  }
  
  throw new Error("Falha total na geração da imagem após tentar todos os modelos.");
};

export const generateCinematicVideo = async (
  promptText: string,
  baseImage?: string,
  referenceImages: ReferenceImage[] = [],
  apiKey?: string,
  sceneId?: number,
  onProgress?: (msg: string) => void,
  visualStyle: string = "modern"
): Promise<string> => {
  const key = apiKey || process.env.API_KEY;
  const ai = new GoogleGenAI({ apiKey: key });

  const styleDescription = VISUAL_STYLES[visualStyle as keyof typeof VISUAL_STYLES] || VISUAL_STYLES.modern;

  let processedPrompt = promptText;
  if (sceneId !== undefined && !processedPrompt.toLowerCase().startsWith("cena")) {
    processedPrompt = `Cena ${sceneId.toString().padStart(2, '0')}: ${processedPrompt}`;
  }

  const finalPrompt = `
    ${SAFETY_INSTRUCTIONS}
    STYLE GUIDE: ${styleDescription}
    TASK: ANALYZE THE IMAGE AND ANIMATE IT NATURALLY.
    STYLE: Hyper-realistic cinematic video, standard fluid motion, professional camera movement.
    SCENE: ${processedPrompt}.
    ANIMATION GUIDELINES: Subtle but powerful cinematic movement. If it's a person, add natural breathing and eye blinking. If it's a landscape, add wind, clouds or water movement. 
    NO TEXT, NO LOGOS.
  `;

  const geminiParts: any[] = [];
  
  // If we have a base image to animate, add it as priority
  if (baseImage) {
    const matches = baseImage.match(/^data:(.+);base64,(.+)$/);
    if (matches) {
       geminiParts.push({ inlineData: { mimeType: matches[1], data: matches[2] } });
       geminiParts.push({ text: "PROMPT: Animate this image specifically. Follow the visual details strictly." });
    }
  }

  // Add cast references if provided
  referenceImages.slice(0, 2).forEach(ref => {
    const matches = ref.data.match(/^data:(.+);base64,(.+)$/);
    if (matches) {
      geminiParts.push({ inlineData: { mimeType: matches[1], data: matches[2] } });
      geminiParts.push({ text: `Visual reference for character "${ref.name}".` });
    }
  });

  geminiParts.push({ text: finalPrompt });

  for (let m = 0; m < VIDEO_MODELS_CONFIG.length; m++) {
    const { name: currentModel, method } = VIDEO_MODELS_CONFIG[m];
    try {
      if (method === "generateVideo") {
        const videoInput: any = {
          model: currentModel,
          prompt: finalPrompt,
          config: {
            numberOfVideos: 1,
            aspectRatio: '16:9',
            resolution: '720p'
          }
        };

        if (baseImage) {
          const matches = baseImage.match(/^data:(.+);base64,(.+)$/);
          if (matches) {
            videoInput.image = {
              imageBytes: matches[2],
              mimeType: matches[1]
            };
          }
        }

        let operation = await (ai.models as any).generateVideos(videoInput);
        
        // Poll for completion
        let pollCount = 0;
        const MAX_POLLS = 60; // 5-10 minutes max usually 
        while (!operation.done && pollCount < MAX_POLLS) {
          if (onProgress) {
            onProgress(`Processando... (aprox. ${pollCount * 10}s) - A geração de vídeo Veo pode levar alguns minutos.`);
          }
          await new Promise(resolve => setTimeout(resolve, 10000));
          try {
            operation = await (ai.operations as any).getVideosOperation({ operation: operation });
          } catch (pollError: any) {
            console.error("Erro ao verificar status da operação:", pollError);
            // Se der erro no poll, tentamos mais algumas vezes
            if (pollCount > 5) throw pollError;
          }
          pollCount++;
        }

        if (!operation.done) {
          throw new Error("Geração de vídeo demorou demais e expirou.");
        }

        if (operation.error) {
          console.error("Erro retornado pela operação Veo:", operation.error);
          throw new Error(`[VIDEO_ERROR] Falha no processamento: ${operation.error.message || JSON.stringify(operation.error)}`);
        }

        const filteredReasons = operation.response?.raiMediaFilteredReasons;
        if (filteredReasons && filteredReasons.length > 0) {
          const reasonMsg = filteredReasons.join(". ");
          console.warn("Vídeo filtrado por políticas de segurança (RAI):", reasonMsg);
          throw new Error(`[VIDEO_SAFETY_ERROR] ${reasonMsg}`);
        }

        const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (!downloadLink) {
          console.error("Operação finalizada mas sem link de resposta. Payload completo:", JSON.stringify(operation, null, 2));
          throw new Error("Link de download do vídeo não encontrado no retorno da IA.");
        }

        // Fetch the video bytes using the API key
        const videoResponse = await fetch(downloadLink, {
          method: 'GET',
          headers: {
            'x-goog-api-key': key!,
          },
        });
        
        if (!videoResponse.ok) throw new Error(`Falha ao baixar vídeo: ${videoResponse.statusText}`);
        
        const videoBlob = await videoResponse.blob();
        
        // Convert Blob to Base64 to return to the App (which then converts to BlobUrl for standard handling)
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64data = reader.result?.toString() || "";
            resolve(base64data);
          };
          reader.onerror = reject;
          reader.readAsDataURL(videoBlob);
        });
      }
    } catch (error: any) {
      const errorMsg = (error.message || "").toUpperCase();
      console.error(`Video Generation Error [${currentModel}]:`, error);
      
      if (errorMsg.includes("PERMISSION_DENIED") || errorMsg.includes("403")) {
        if (errorMsg.includes("DENIED ACCESS")) {
          throw new Error("PROJETO_BLOQUEADO: Seu projeto no Google Cloud foi negado acesso aos modelos de vídeo (Veo). Verifique as permissões de acesso antecipado.");
        }
      }

      if (m < VIDEO_MODELS_CONFIG.length - 1) continue;
      throw error;
    }
  }

  throw new Error("Falha total na animação de vídeo. Verifique se o modelo de vídeo está disponível na sua conta.");
};

export const rewritePromptWithGemini = async (
  originalPrompt: string, 
  errorReason: string, 
  sceneId: number,
  apiKey?: string
): Promise<string> => {
  const key = apiKey || process.env.API_KEY;
  const ai = new GoogleGenAI({ apiKey: key });
  const model = "gemini-3.1-flash-lite-preview"; // Versão 3.1 Flash mais atual e econômica
  
  const systemPrompt = `
    Eres un experto en ingeniería de prompts cinematográficos. 
    Tu tarea es REESCRIBIR un prompt que fue rechazado por filtros de seguridad o políticas de contenido (como mencionar personas reales o violencia), manteniendo la esencia visual pero eliminando cualquier palabra o concepto que pueda activar sensores de seguridad.
    
    REGLAS CRÍTICAS DE SEGURIDAD:
    1. PROHIBIDO: NO uses nombres de personas reales (criminales, figuras públicas, celebridades). 
    2. ACCIÓN: Sustituye nombres propios por descripciones físicas genéricas (ej: "A mature man with a dark suit" en lugar de un nombre específico).
    3. NO uses palabras como "8k", "4k", "2k", "HDR", "high resolution".
    4. Mantén un estilo fotorrealista y cinematográfico.
    5. El resultado debe ser un prompt en INGLÉS.
    6. El prompt DEBE COMENZAR con el prefijo "Cena ${sceneId.toString().padStart(2, '0')}: ".
    7. NO incluyas introducciones, solo el nuevo prompt.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: `System Instruction: ${systemPrompt}\n\nOriginal Prompt to rewrite: "${originalPrompt}"\nReason for failure: ${errorReason}\n\nTask: Rewrite this prompt to be safe, cinematic, and in English.` }] }],
    });
    const result = response.candidates?.[0]?.content?.parts[0]?.text?.trim() || "";
    
    if (!result || result.includes(originalPrompt)) {
      // Se a IA não gerou nada útil ou retornou o mesmo original, força uma versão ultra-segura
      return `Cena ${sceneId.toString().padStart(2, '0')}: A cinematic artistic shot of a neutral professional set in a dramatic movie scene, photorealistic, cinematic lighting, anonymous character.`;
    }

    if (!result.toLowerCase().startsWith("cena")) {
      return `Cena ${sceneId.toString().padStart(2, '0')}: ${result}`;
    }
    return result;
  } catch (error) {
    console.error("Gemini Rewrite Error:", error);
    // Se falhar o re-write, gera um prompt "coringa" ultra seguro para evitar loop infinito de erro de segurança
    return `Cena ${sceneId.toString().padStart(2, '0')}: Cinematic atmospheric shot, professional lighting, photorealistic, dramatic movie environment.`;
  }
};

export const optimizeSinglePrompt = async (
  sceneId: number, 
  text: string, 
  referenceImages: ReferenceImage[], 
  apiKey?: string
): Promise<string> => {
  const key = apiKey || process.env.API_KEY;
  const ai = new GoogleGenAI({ apiKey: key });
  const model = "gemini-3.1-flash-lite-preview";
  
  const castList = referenceImages.map(r => r.name).join(", ");
  const prompt = `
    Actúa como un Director de Cine de Élite. Transforma el siguiente texto de guion en un prompt visual cinemático altamente detallado.
    
    REGLAS:
    1. COMPOSICIÓN: Describe encuadres profesionales (Wide Shot, Close-up, etc.).
    2. ILUMINACIÓN: Describe atmósfera y luz (Neon, Golden hour, etc.).
    3. CONSISTENCIA: Usa nombres de la lista de referencias: [${castList}].
    4. ESTILO: Fotorealista, estilo de cine de alto presupuesto. NO uses "8k" o "4k".
    5. IDIOMA: Responde ÚNICAMENTE con el prompt en INGLÉS.
    6. NO uses introducciones ni explicaciones. Solo el prompt.

    TEXTO DE LA ESCENA #${sceneId}:
    "${text}"
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });
    const result = response.candidates?.[0]?.content?.parts[0]?.text?.trim() || text;
    if (!result.toLowerCase().startsWith("cena")) {
      return `Cena ${sceneId.toString().padStart(2, '0')}: ${result}`;
    }
    return result;
  } catch (error) {
    console.error("Single optimization error:", error);
    if (!text.toLowerCase().startsWith("cena")) {
      return `Cena ${sceneId.toString().padStart(2, '0')}: ${text}`;
    }
    return text;
  }
};

export const optimizeScriptWithAI = async (
  segments: SrtSegment[], 
  referenceImages: ReferenceImage[], 
  apiKey?: string
): Promise<SrtSegment[]> => {
  const key = apiKey || process.env.API_KEY;
  const ai = new GoogleGenAI({ apiKey: key });
  
  // Usamos o Gemini 3.1 Flash Lite para economia máxima no processamento massivo
  const model = "gemini-3.1-flash-lite-preview";
  
  const castList = referenceImages.map(r => r.name).join(", ");
  const CHUNK_SIZE = 12; // Pouco menor para garantir que o JSON não seja cortado
  
  const chunks: SrtSegment[][] = [];
  for (let i = 0; i < segments.length; i += CHUNK_SIZE) {
    chunks.push(segments.slice(i, i + CHUNK_SIZE));
  }

  // Processamento com concorrência controlada (Batches de 4 por vez) para evitar 429
  const CONCURRENCY_LIMIT = 4;
  const results: any[] = [];

  for (let i = 0; i < chunks.length; i += CONCURRENCY_LIMIT) {
    const batch = chunks.slice(i, i + CONCURRENCY_LIMIT);
    
    const batchPromises = batch.map(async (chunk, batchIdx) => {
      const chunkActualIndex = i + batchIdx;
      const prompt = `
        Actúa como un Director de Cine de Hollywood y experto en Publicidad. Tu tarea es convertir diálogos/textos en PROMPTS VISUALES CINEMATOGRÁFICOS REALISTAS.
        
        REGLAS DE ORO:
        1. IDIOMA: Escribe el visual_prompt EXCLUSIVAMENTE en INGLÉS.
        2. ESTILO: Photorealistic, cinematic lighting, professional camera angles (Medium shot, Close-up, Wide shot). NO uses "8k" o "4k".
        3. PERSONAJES CONSISTENTES: Si el texto sugiere un personaje, USA EXACTAMENTE estos nombres de referencia si encajan: [${castList}]. Ejemplo: "Cinema close up of the character [Nombre]..."
        4. ATMÓSFERA Y LUZ: Describe la luz (Golden hour, neon, dramatic shadows) y la textura (35mm grain, sharp details).
        5. VARIEDAD: Cambia los ángulos y colores entre escenas.
        6. FORMATO: Responde ÚNICAMENTE con un array JSON válido: [{"id": número, "visual_prompt": "descripción..."}].
        7. NO TEXTO: Sin subtítulos, marcas de agua ni texto en la imagen.
        
        ESCENAS A PROCESAR (BLOQUE ${chunkActualIndex + 1}):
        ${JSON.stringify(chunk.map(s => ({ id: s.id, text: s.text })))}
      `;

      let attempt = 0;
      const maxAttempts = 2;
      
      while (attempt < maxAttempts) {
        try {
          const response: GenerateContentResponse = await ai.models.generateContent({
            model,
            contents: prompt,
            config: { 
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.INTEGER },
                    visual_prompt: { type: Type.STRING }
                  },
                  required: ["id", "visual_prompt"]
                }
              }
            }
          });

          const data = JSON.parse(response.text || "[]");
          return data;
        } catch (err) {
          attempt++;
          console.warn(`Erro no bloco ${chunkActualIndex}, tentativa ${attempt}:`, err);
          if (attempt === maxAttempts) {
            // Se falhou tudo, retorna os originais para esse chunk
            return chunk.map(s => ({ id: s.id, visual_prompt: s.text }));
          }
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      return [];
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.flat());
    
    // Pequena pausa entre lotes para evitar 429
    if (i + CONCURRENCY_LIMIT < chunks.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Mapeia de volta para os segmentos originais mantendo prefixos e tipos
  const optimizedSegments = segments.map(originalSeg => {
    const aiMatch = results.find((item: any) => item.id === originalSeg.id);
    
    // Ensure "Cena XX: " prefix
    let finalPrompt = aiMatch?.visual_prompt || originalSeg.text;
    if (!finalPrompt.toLowerCase().startsWith("cena")) {
      finalPrompt = `Cena ${originalSeg.id.toString().padStart(2, '0')}: ${finalPrompt}`;
    }

    return {
      ...originalSeg,
      text: finalPrompt,
      isGenerating: false,
      imageData: undefined,
      videoData: undefined,
      generationType: originalSeg.generationType || 'image',
      isRecommendedForVideo: false
    };
  });

  // Lógica de distribuição para sugestões de vídeo (Máximo 5)
  // Garante que as sugestões sejam bem distribuídas (Início, Meio, Fim)
  const total = optimizedSegments.length;
  if (total > 0) {
    const numToRecommend = Math.min(5, total);
    if (numToRecommend === 1) {
      optimizedSegments[Math.floor(total / 2)].isRecommendedForVideo = true;
    } else {
      for (let i = 0; i < numToRecommend; i++) {
        // Calcula o índice distribuído proporcionalmente
        const index = Math.floor(i * (total - 1) / (numToRecommend - 1));
        optimizedSegments[index].isRecommendedForVideo = true;
        // Também define o tipo de geração como vídeo para facilitar para o usuário
        optimizedSegments[index].generationType = 'video';
      }
    }
  }

  return optimizedSegments;
};
