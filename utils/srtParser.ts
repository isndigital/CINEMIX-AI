
import { SrtSegment } from '../types';

export const parseTime = (timeString: string): number => {
  const parts = timeString.split(':');
  if (parts.length < 3) return 0;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const secondsParts = parts[2].split(',');
  const seconds = parseInt(secondsParts[0], 10);
  const milliseconds = parseInt(secondsParts[1] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
};

export const parseSRT = (srtContent: string): SrtSegment[] => {
  const segments: SrtSegment[] = [];
  const normalized = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split('\n\n');

  for (const block of blocks) {
    const lines = block.split('\n').filter(line => line.trim() !== '');
    if (lines.length >= 3) {
      const timeLine = lines[1];
      const times = timeLine.split(' --> ');
      if (times.length !== 2) continue;
      const startTime = parseTime(times[0]);
      const endTime = parseTime(times[1]);
      const text = lines.slice(2).join(' ').replace(/<[^>]*>/g, '').trim();
      if (text) {
        segments.push({ id: segments.length + 1, startTime, endTime, text });
      }
    }
  }
  return segments;
};

const isCTA = (text: string, startTime: number, endTime: number, totalDuration: number): boolean => {
  // Dicionário de Elite para CTAs em Espanhol
  const keywords = [
    'suscríbete', 'suscribete', 'suscribir', 'like', 'me gusta', 'megusta', 
    'dale like', 'dalelike', 'campanita', 'notificaciones', 'canal', 
    'comparte', 'comenta', 'apóyanos', 'apoyanos', 'síguenos', 'siguenos', 
    'unirse', 'miembro', 'enlace', 'descripción', 'descripcion', 'comentarios',
    'haz clic', 'hazclic', 'bio', 'redes sociales', 'instagram', 'tiktok'
  ];
  const lower = text.toLowerCase();
  const hasKeyword = keywords.some(k => lower.includes(k));
  
  if (!hasKeyword) return false;

  // Janela de sensibilidade de 50 segundos para CTAs (Início e Fim)
  const isAtStart = startTime < 50;
  const isAtEnd = totalDuration > 0 && (totalDuration - endTime) < 50;
  
  return isAtStart || isAtEnd;
};

const hasNaturalPause = (text: string): boolean => {
  const trimmed = text.trim();
  return /[.!?]/.test(trimmed.slice(-1)) || trimmed.endsWith('...') || trimmed.endsWith(':');
};

export const optimizeSegmentsRuleBased = (segments: SrtSegment[]): SrtSegment[] => {
  if (segments.length === 0) return [];
  
  const totalDuration = segments[segments.length - 1]?.endTime || 0;
  const optimized: SrtSegment[] = [];
  
  let currentTime = 0;
  let currentId = 1;

  while (currentTime < totalDuration) {
    // Para imagens, aumentamos o alvo para agrupar mais conteúdo e economizar tokens
    // Tentamos encontrar um fim de frase ou pausa natural entre 4 e 12 segundos para maior dinamismo
    const minImgDur = 4;
    const maxImgDur = 12;
    const targetImgDur = 6 + (Math.random() * 5); // Entre 6 e 11 segundos aleatórios para evitar padrões fixos
    
    let duration = 0;
    const nextSegments = segments.filter(s => s.startTime >= currentTime);
    if (nextSegments.length > 0) {
      let foundEnd = false;
      for (const s of nextSegments) {
        const endOffset = s.endTime - currentTime;
        
        // Se encontrarmos um fim de frase (ponto final, etc) entre 5 e 10 segundos, cortamos ali
        if (endOffset >= minImgDur && endOffset <= maxImgDur && hasNaturalPause(s.text)) {
          duration = endOffset;
          foundEnd = true;
          break;
        }
        
        // Se passar de 10 segundos sem pausa, forçamos o corte no target aleatório
        if (endOffset > maxImgDur) {
          duration = targetImgDur;
          foundEnd = true;
          break;
        }
      }
      if (!foundEnd) {
        // Se não encontrou um ponto ideal, usa uma duração levemente aleatória para não ser robótico
        duration = targetImgDur;
      }
    } else {
      duration = targetImgDur;
    }

    const startTime = currentTime;
    const endTime = Math.min(currentTime + duration, totalDuration);
    
    // Agrupa os textos da legenda que caem dentro desse intervalo de tempo
    const overlapping = segments.filter(s => s.startTime < endTime && s.endTime > startTime);
    const combinedText = overlapping.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();

    optimized.push({
      id: currentId++,
      startTime,
      endTime,
      text: combinedText || "Cena cinematográfica de transição",
      generationType: 'image'
    });

    currentTime = endTime;
    
    // Se sobrar menos de 2 segundos, encerra para não criar uma cena minúscula
    if (totalDuration - currentTime < 2) {
      if (optimized.length > 0) {
        optimized[optimized.length - 1].endTime = totalDuration;
      }
      break;
    }
  }
  
  return optimized;
};
