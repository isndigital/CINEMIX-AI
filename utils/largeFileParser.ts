
import { SrtSegment, ReferenceImage } from '../types';
import { base64ToBlobUrl } from './blobHelpers';

interface ParseResult {
  segments: SrtSegment[];
  referenceImages: ReferenceImage[];
  metadata: any;
}

// Configuração do Parser
const CHUNK_SIZE = 5 * 1024 * 1024; // Leitura em blocos de 5MB
const YIELD_EVERY_MS = 50; 
const MAX_BUFFER_SIZE = 200 * 1024 * 1024; // Aumentado para 200MB para suportar imagens 8K Base64

export const parseLargeProjectFile = async (
  file: File, 
  onProgress: (percent: number, found: number) => void
): Promise<ParseResult> => {
  
  return new Promise(async (resolve, reject) => {
    const fileSize = file.size;
    let offset = 0;
    let buffer = '';
    
    // Armazéns de dados
    const segments: SrtSegment[] = [];
    let referenceImages: ReferenceImage[] = [];
    let metadata: any = {};

    // Estado da Máquina de Parsing
    let inString = false;
    let isEscaped = false;
    let braceDepth = 0;
    let objectStartIndex = -1;
    let hasFoundSegmentsArray = false;
    
    // Cursor de leitura para evitar re-scan (O(N) performance)
    let scanIndex = 0;
    
    let lastYieldTime = Date.now();

    try {
        while (offset < fileSize) {
        // 1. Ler Chunk
        const chunk = file.slice(offset, offset + CHUNK_SIZE);
        const text = await readChunk(chunk);
        
        // Check Memory Safety
        if (buffer.length + text.length > MAX_BUFFER_SIZE) {
            if (!hasFoundSegmentsArray) {
                // Se ainda estamos no header e estourou, tenta cortar
                const cutSize = (buffer.length + text.length) - MAX_BUFFER_SIZE + (1024 * 1024);
                if (cutSize < buffer.length) {
                    buffer = buffer.substring(cutSize);
                    scanIndex = Math.max(0, scanIndex - cutSize);
                } else {
                    buffer = ""; // Emergency clear
                    scanIndex = 0;
                }
            } else {
                console.warn("Buffer warning: Processing huge object > 200MB");
            }
        }

        buffer += text;
        offset += CHUNK_SIZE;

        // UI Updates
        const percent = Math.min(99, (offset / fileSize) * 100);
        if (Date.now() - lastYieldTime > YIELD_EVERY_MS) {
            onProgress(percent, segments.length);
            await new Promise(r => setTimeout(r, 0));
            lastYieldTime = Date.now();
        }

        // 2. Busca inicial pelo array "segments"
        if (!hasFoundSegmentsArray) {
            const segIndex = buffer.indexOf('"segments"');
            
            if (segIndex !== -1) {
                // Tenta ler metadados do header (Best effort)
                try {
                    const headerPreview = buffer.substring(0, Math.min(segIndex, 10 * 1024 * 1024)); 
                    const refsMatch = headerPreview.match(/"referenceImages"\s*:\s*\[(.*?)\]/s);
                    if (refsMatch && refsMatch[1]) {
                        const rawRefs = JSON.parse(`[${refsMatch[1]}]`);
                        // Migração simples caso venha string antiga
                        referenceImages = rawRefs.map((r: any, idx: number) => {
                            if (typeof r === 'string') return { id: `legacy_${idx}`, name: `Ref ${idx}`, data: r };
                            return r;
                        });
                    }
                } catch (e) { /* ignore */ }
                
                const arrayStart = buffer.indexOf('[', segIndex);
                if (arrayStart !== -1) {
                    hasFoundSegmentsArray = true;
                    // Descarta header já processado
                    buffer = buffer.substring(arrayStart + 1);
                    scanIndex = 0; // Reinicia scan no novo buffer limpo
                    
                    // Reset estados
                    inString = false;
                    isEscaped = false;
                    braceDepth = 0;
                    objectStartIndex = -1;
                }
            }
        }

        // 3. Processamento de Objetos (State Machine otimizada)
        if (hasFoundSegmentsArray) {
            let i = scanIndex;
            
            while (i < buffer.length) {
            const char = buffer[i];

            if (inString) {
                if (isEscaped) {
                    isEscaped = false;
                } else if (char === '\\') {
                    isEscaped = true;
                } else if (char === '"') {
                    inString = false;
                }
            } else {
                if (char === '"') {
                    inString = true;
                } else if (char === '{') {
                    if (braceDepth === 0) {
                        objectStartIndex = i;
                    }
                    braceDepth++;
                } else if (char === '}') {
                    braceDepth--;
                    if (braceDepth === 0 && objectStartIndex !== -1) {
                        // Objeto encontrado
                        const objectStr = buffer.substring(objectStartIndex, i + 1);
                        try {
                            const segment = JSON.parse(objectStr);
                            if (segment && (segment.id !== undefined || segment.text)) {
                                segment.isGenerating = false;
                                
                                // Convert massive base64 to Blob URL immediately (Save heap memory)
                                if (segment.imageData && segment.imageData.startsWith('data:')) {
                                    segment.imageData = base64ToBlobUrl(segment.imageData);
                                }
                                if (segment.videoData && segment.videoData.startsWith('data:')) {
                                    segment.videoData = base64ToBlobUrl(segment.videoData);
                                }
                                
                                segments.push(segment);
                            }
                        } catch (e) { /* ignore bad json */ }

                        // Limpeza de Buffer
                        buffer = buffer.substring(i + 1);
                        
                        // Ajuste de índices
                        i = -1; 
                        scanIndex = 0; 
                        objectStartIndex = -1;
                    }
                } else if (char === ']' && braceDepth === 0) {
                    // Fim do array segments
                    resolve({ segments, referenceImages, metadata });
                    return;
                }
            }
            i++;
            }
            scanIndex = buffer.length;
        }
        }

        resolve({ segments, referenceImages, metadata });
    } catch (err) {
        reject(err);
    }
  });
};

const readChunk = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string || '');
        reader.onerror = reject;
        reader.readAsText(blob);
    });
};
