
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { SrtSegment } from '../types';

interface VideoPreviewProps {
  audioUrl: string | null;
  segments: SrtSegment[];
  isPlaying: boolean;
  isExporting: boolean;
  includeAudio: boolean;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  onExportComplete: () => void;
  onExportProgress?: (progress: number) => void;
  width?: number;
  height?: number;
}

const TRANSITION_DURATION = 1.0; // 1 segundo de fade
const KEN_BURNS_SCALE = 0.05; // 5% de zoom

// Worker script as a string to avoid external file dependencies
const WORKER_SCRIPT = `
let intervalId;
self.onmessage = function(e) {
  if (e.data === 'start') {
    // 30 FPS = ~33.33ms interval
    intervalId = setInterval(() => {
      self.postMessage('tick');
    }, 33);
  } else if (e.data === 'stop') {
    clearInterval(intervalId);
  }
};
`;

const VideoPreview: React.FC<VideoPreviewProps> = ({
  audioUrl,
  segments,
  isPlaying,
  isExporting,
  includeAudio,
  currentTime,
  onTimeUpdate,
  onExportComplete,
  onExportProgress,
  width = 1280,
  height = 720
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const requestRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const exportDurationRef = useRef<number>(0);
  const workerRef = useRef<Worker | null>(null);
  const isStoppingRef = useRef(false);
  const isExportingRef = useRef(false); // TRAVA DE EXPORTAÇÃO (Single Source of Truth)
  const isStartingExportRef = useRef(false); // TRAVA PARA EVITAR START DUPLO DURANTE ASYNC
  
  // Usamos REFS para os assets para evitar problemas de closure e reduzir re-renders pesados
  const imagesRef = useRef<Record<number, HTMLImageElement>>({});
  const videoElementsRef = useRef<Record<number, HTMLVideoElement>>({});
  const [areAssetsReady, setAreAssetsReady] = useState(false);

  // 1. Preload assets
  useEffect(() => {
    setAreAssetsReady(false);
    let mounted = true;
    let pendingCount = 0;

    const loadAssets = async () => {
        const imageSegments = segments.filter(s => s.imageData);
        const videoSegments = segments.filter(s => s.videoData);
        pendingCount = imageSegments.length + videoSegments.length;

        if (pendingCount === 0) {
            if (mounted) setAreAssetsReady(true);
            return;
        }

        const onAssetLoaded = () => {
            pendingCount--;
            if (pendingCount <= 0 && mounted) {
                setAreAssetsReady(true);
            }
        };

        imageSegments.forEach(seg => {
            if (imagesRef.current[seg.id] && imagesRef.current[seg.id].src === seg.imageData) {
                onAssetLoaded();
                return;
            }

            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                imagesRef.current[seg.id] = img;
                onAssetLoaded();
            };
            img.onerror = () => {
                console.error(`Falha ao carregar imagem ${seg.id}`);
                onAssetLoaded();
            };
            img.src = seg.imageData!;
        });

        videoSegments.forEach(seg => {
            if (videoElementsRef.current[seg.id] && videoElementsRef.current[seg.id].src === seg.videoData) {
                onAssetLoaded();
                return;
            }

            const video = document.createElement('video');
            video.crossOrigin = "anonymous";
            video.muted = true;
            video.preload = "auto";
            video.oncanplaythrough = () => {
                videoElementsRef.current[seg.id] = video;
                onAssetLoaded();
            };
            video.onerror = () => {
                console.error(`Falha ao carregar vídeo ${seg.id}`);
                onAssetLoaded();
            };
            video.src = seg.videoData!;
        });
    };

    loadAssets();
    return () => { mounted = false; };
  }, [segments]);

  const drawAssetFit = (ctx: CanvasRenderingContext2D, asset: HTMLImageElement | HTMLVideoElement, opacity: number, timeInSegment: number, segmentDuration: number) => {
      const assetWidth = asset instanceof HTMLImageElement ? asset.width : asset.videoWidth;
      const assetHeight = asset instanceof HTMLImageElement ? asset.height : asset.videoHeight;
      
      if (assetWidth === 0 || assetHeight === 0) return;

      ctx.globalAlpha = opacity;
      
      let finalScale = Math.max(width / assetWidth, height / assetHeight);
      
      // Ken Burns Effect only for images
      if (asset instanceof HTMLImageElement) {
        const progress = Math.min(1, timeInSegment / (segmentDuration || 5));
        const currentScale = 1 + (progress * KEN_BURNS_SCALE);
        finalScale *= currentScale;
      } else {
        // For videos, we need to sync the video time
        const video = asset as HTMLVideoElement;
        // Loop video if shorter than segment
        video.currentTime = timeInSegment % video.duration;
      }
      
      const dw = assetWidth * finalScale;
      const dh = assetHeight * finalScale;
      
      const dx = (width / 2) - (dw / 2);
      const dy = (height / 2) - (dh / 2);
      
      ctx.drawImage(asset, dx, dy, dw, dh);
      ctx.globalAlpha = 1.0;
  };

  const draw = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const segmentsWithAssets = segments.filter(s => (s.imageData && imagesRef.current[s.id]) || (s.videoData && videoElementsRef.current[s.id]));
    
    let activeIndex = -1;
    for (let i = 0; i < segmentsWithAssets.length; i++) {
        if (time >= segmentsWithAssets[i].startTime) {
            activeIndex = i;
        } else {
            break;
        }
    }

    const activeSegment = activeIndex !== -1 ? segmentsWithAssets[activeIndex] : null;

    if (activeSegment) {
        const timeSinceStart = time - activeSegment.startTime;
        const segmentDuration = (activeIndex < segmentsWithAssets.length - 1) 
            ? (segmentsWithAssets[activeIndex + 1].startTime - activeSegment.startTime)
            : 10; 
            
        const activeAsset = videoElementsRef.current[activeSegment.id] || imagesRef.current[activeSegment.id];
        
        if (timeSinceStart < TRANSITION_DURATION && activeIndex > 0) {
            const prevSegment = segmentsWithAssets[activeIndex - 1];
            const prevAsset = videoElementsRef.current[prevSegment.id] || imagesRef.current[prevSegment.id];
            const prevDuration = activeSegment.startTime - prevSegment.startTime;
            const prevTimeInSegment = (activeSegment.startTime - prevSegment.startTime) + timeSinceStart;

            if (prevAsset) {
                drawAssetFit(ctx, prevAsset, 1.0, prevTimeInSegment, prevDuration);
            }
            const opacity = Math.min(1, timeSinceStart / TRANSITION_DURATION);
            drawAssetFit(ctx, activeAsset, opacity, timeSinceStart, segmentDuration);
        } else {
            drawAssetFit(ctx, activeAsset, 1.0, timeSinceStart, segmentDuration);
        }
    } else {
        ctx.fillStyle = '#111';
        ctx.fillRect(0,0, width, height);
        
        if (!isExporting) {
            ctx.fillStyle = '#666';
            ctx.font = '24px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('...', width/2, height/2);
        }
    }
  }, [segments, width, height, isExporting]);

  // Função central que processa um quadro de animação ou tick de exportação
  const processFrame = useCallback(() => {
    // 1. SEGURANÇA TOTAL: Se o processo de parada já começou, ignora qualquer novo tick
    if (isStoppingRef.current) return;
    if (!audioRef.current) return;

    const time = audioRef.current.currentTime;
    const duration = audioRef.current.duration || 1;
    const effectiveDuration = isExporting ? (exportDurationRef.current || duration) : duration;

    // Verifica fim da exportação ANTES de desenhar ou atualizar estado
    const isAudioEnded = audioRef.current.ended;
    const isTimeOver = time >= effectiveDuration && effectiveDuration > 0;

    if (isExporting && (isTimeOver || isAudioEnded)) {
        console.log("Exportação finalizada. Parando loops...");
        draw(effectiveDuration); 
        stopExport();
        return; 
    }

    // Atualiza UI e Desenha
    onTimeUpdate(time);
    draw(time);
    
    // Atualiza progresso da exportação
    if (isExporting && onExportProgress) {
        const progress = Math.min(100, Math.max(0, (time / effectiveDuration) * 100));
        onExportProgress(progress);
    }

    if (!isExporting && !audioRef.current.paused && !audioRef.current.ended) {
        requestRef.current = requestAnimationFrame(processFrame);
    } else if (audioRef.current.ended && !isExporting) {
        cancelAnimationFrame(requestRef.current);
    }

  }, [onTimeUpdate, draw, isExporting, onExportProgress]);


  // Effect para controlar o Play/Pause normal (Preview)
  useEffect(() => {
    if (audioRef.current && !isExporting) { 
        if (isPlaying) {
            const playPromise = audioRef.current.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    requestRef.current = requestAnimationFrame(processFrame);
                }).catch(e => console.error("Play error", e));
            }
        } else {
            audioRef.current.pause();
            cancelAnimationFrame(requestRef.current!);
        }
    }
    return () => {
        cancelAnimationFrame(requestRef.current!);
    };
  }, [isPlaying, isExporting, processFrame]); 

  // Handle Export Logic
  useEffect(() => {
    if (isExporting && audioRef.current && canvasRef.current && !isExportingRef.current && !isStartingExportRef.current) {
      isStartingExportRef.current = true;
      const initExport = async () => {
          if (!areAssetsReady) {
              console.log("Aguardando assets carregarem para exportação...");
              for(let i=0; i<300; i++) { // Espera até 30s
                  if (areAssetsReady || !isExporting) break; 
                  await new Promise(r => setTimeout(r, 100));
              }
          }
          if (isExporting && !isExportingRef.current) {
              startExport();
          }
          isStartingExportRef.current = false;
      };
      initExport();
    }
    
    // Cleanup if exporting is turned off externally
    if (!isExporting && (isExportingRef.current || isStartingExportRef.current)) {
        stopExport();
        isExportingRef.current = false;
        isStartingExportRef.current = false;
    }
  }, [isExporting, areAssetsReady]);


  const startExport = () => {
    if (!canvasRef.current || !audioRef.current || isExportingRef.current) return;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        console.warn("Export already in progress or not inactive.");
        return;
    }

    isExportingRef.current = true;
    isStoppingRef.current = false;

    // Setup Export Duration
    const segmentsWithImages = segments.filter(s => s.imageData || s.videoData);
    let maxDuration = audioRef.current.duration || 0;
    if (segmentsWithImages.length > 0) {
        const lastSegmentEnd = segmentsWithImages[segmentsWithImages.length - 1].endTime;
        maxDuration = Math.max(lastSegmentEnd, audioRef.current.duration || 0);
    }
    exportDurationRef.current = maxDuration + 0.1;
    
    console.log(`Starting background export. Cutoff: ${exportDurationRef.current}s`);

    // 1. Configura Stream e Recorder
    const canvasStream = canvasRef.current.captureStream(30);
    let finalStream = canvasStream;

    if (includeAudio) {
        try {
            const audioStream = (audioRef.current as any).captureStream ? (audioRef.current as any).captureStream() : (audioRef.current as any).mozCaptureStream ? (audioRef.current as any).mozCaptureStream() : null;
            if (audioStream) {
                finalStream = new MediaStream([
                    ...canvasStream.getVideoTracks(),
                    ...audioStream.getAudioTracks()
                ]);
            }
        } catch (e) {
            console.error("Failed to capture audio stream", e);
        }
    }
    
    const mimeType = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
    const recorder = new MediaRecorder(finalStream, { 
        mimeType, 
        videoBitsPerSecond: 10000000 // Aumentado para 10mbps para mais qualidade
    }); 

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
        isExportingRef.current = false;
        try {
            if (chunksRef.current.length === 0) {
                console.warn("Nenhum dado gravado no recorder.");
            } else {
                const blob = new Blob(chunksRef.current, { type: mimeType });
                console.log(`Exportado Blob Size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
                
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `CineSync_Video_${new Date().getTime()}.${mimeType === 'video/mp4' ? 'mp4' : 'webm'}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
        } catch (err) {
            console.error("Erro ao gerar arquivo final", err);
        }
        
        // Cleanup Worker Final
        if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
        }
        
        onExportComplete();
    };

    mediaRecorderRef.current = recorder;
    
    // TENTATIVA DE START COM CATCH
    try {
        recorder.start();
    } catch (startErr) {
        console.error("Critical error starting MediaRecorder:", startErr);
        isExportingRef.current = false;
        onExportComplete();
        return;
    }

    // 2. Inicia Web Worker para controlar o Loop
    const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    const worker = new Worker(blobUrl);
    workerRef.current = worker;

    worker.onmessage = (e) => {
        if (e.data === 'tick' && !isStoppingRef.current) {
            processFrame();
        }
    };

    // 3. Inicia reprodução
    audioRef.current.currentTime = 0;
    audioRef.current.play().then(() => {
         if (!isStoppingRef.current) {
             worker.postMessage('start');
         }
    }).catch(playErr => {
        console.error("Audio Play Error during export:", playErr);
        // Fallback: Tentamos o loop mesmo sem áudio se o áudio falhou no play (bloqueio do navegador)
        if (!isStoppingRef.current) worker.postMessage('start');
    });
    
    cancelAnimationFrame(requestRef.current);
    URL.revokeObjectURL(blobUrl); // Cleanup blob URL
  };

  const stopExport = () => {
    // 1. ATIVA A TRAVA IMEDIATAMENTE
    // Isso impede que qualquer 'tick' pendente do worker execute o processFrame novamente
    if (isStoppingRef.current) return; 
    isStoppingRef.current = true;

    console.log("Stopping Export Sequence Initiated");

    // 2. Mata o Worker imediatamente
    if (workerRef.current) {
        workerRef.current.postMessage('stop');
        workerRef.current.terminate();
        workerRef.current = null;
    }

    // 3. Para o áudio imediatamente
    if (audioRef.current) {
        audioRef.current.pause();
    }

    // 4. Para o Gravador (Isso vai disparar onstop e o download)
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
    }
    
    // 5. Limpa animações
    cancelAnimationFrame(requestRef.current);
  };

  // Sync seek visual
  useEffect(() => {
      // Caso 1: Audio existe
      if(audioRef.current && Math.abs(audioRef.current.currentTime - currentTime) > 0.5 && !isPlaying) {
          audioRef.current.currentTime = currentTime;
          draw(currentTime);
      } 
      // Caso 2: Audio não existe (ainda) ou não carregado - Permite preview visual apenas
      else if (!audioRef.current && !isPlaying) {
          draw(currentTime);
      }
  }, [currentTime, isPlaying, draw]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden shadow-2xl border border-gray-800">
      <canvas 
        ref={canvasRef} 
        width={width} 
        height={height} 
        className="w-full h-full object-contain"
      />
      {audioUrl && (
        <audio 
            ref={audioRef} 
            src={audioUrl} 
            onEnded={() => {
                if(!isExporting) onTimeUpdate(audioRef.current?.duration || 0);
            }}
            crossOrigin="anonymous" 
            preload="auto"
            // Garante que não há loop nativo
            loop={false} 
        />
      )}
    </div>
  );
};

export default VideoPreview;
