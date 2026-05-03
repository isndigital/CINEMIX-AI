
import React, { useState, useRef, useEffect } from 'react';
import { VideoState, SrtSegment, ReferenceImage } from './types';
import { parseSRT, optimizeSegmentsRuleBased } from './utils/srtParser';
import { generateCinematicImage, ensureApiKey, optimizeScriptWithAI, optimizeSinglePrompt, rewritePromptWithGemini, generateCinematicVideo, VISUAL_STYLES } from './services/geminiService';
import { saveProjectToDB, loadProjectFromDB, cleanupOrphanedImages } from './utils/db';
import { parseLargeProjectFile } from './utils/largeFileParser';
import { blobUrlToBase64, base64ToBlobUrl, base64ToBlob } from './utils/blobHelpers';
import { rewritePromptWithClaude } from './services/anthropicService';
import VideoPreview from './components/VideoPreview';
import ImageModal from './components/ImageModal';
import JSZip from 'jszip';
import { 
  ArrowPathIcon, FilmIcon, CloudArrowUpIcon,
  SparklesIcon, TrashIcon, ArrowDownTrayIcon,
  ArrowUpTrayIcon, ClockIcon, StopIcon, PhotoIcon, CpuChipIcon,
  PlusIcon, XMarkIcon, BoltIcon, PencilSquareIcon, StarIcon,
  ExclamationTriangleIcon, CommandLineIcon, SignalIcon,
  CheckCircleIcon, ArchiveBoxArrowDownIcon, VideoCameraIcon,
  ListBulletIcon
} from '@heroicons/react/24/solid';
import { Play, Pause, Square, SkipBack, SkipForward } from 'lucide-react';

const App: React.FC = () => {
  const [state, setState] = useState<VideoState>({
    audioFile: null, srtFile: null, referenceImages: [], segments: [],
    status: 'idle', currentSegmentIndex: 0,
  });
  const [currentTime, setCurrentTime] = useState(0);
  
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [exportProgress, setExportProgress] = useState(0);
  
  const [geminiKeys, setGeminiKeys] = useState<string[]>(() => {
    const saved = localStorage.getItem('gemini_api_keys');
    return saved ? JSON.parse(saved) : [];
  });
  const [currentKeyIndex, setCurrentKeyIndex] = useState(0);
  const customApiKey = geminiKeys[currentKeyIndex] || "";

  const [anthropicApiKey, setAnthropicApiKey] = useState(() => localStorage.getItem('anthropic_api_key') || "");
  const [countdown, setCountdown] = useState(0);
  const [modalSegmentId, setModalSegmentId] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isOptimizingIA, setIsOptimizingIA] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const isZippingRef = useRef(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [generationMode] = useState<'image' | 'video'>('image');
  const [visualStyle, setVisualStyle] = useState<string>(() => localStorage.getItem('visual_style') || 'modern');
  const [apiLogs, setApiLogs] = useState<{msg: string, type: 'info' | 'error' | 'success'}[]>([]);

  const shouldStop = useRef(false);
  const abortSingleRef = useRef<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLog = (msg: string, type: 'info' | 'error' | 'success' = 'info') => {
    setApiLogs(prev => [{msg, type}, ...prev].slice(0, 20));
  };

  useEffect(() => {
    loadProjectFromDB().then(data => {
      if (data?.segments) {
        setState(prev => ({ 
          ...prev, 
          segments: data.segments, 
          referenceImages: data.referenceImages || [],
        }));
        cleanupOrphanedImages(data.segments.map((s: SrtSegment) => s.id));
      }
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      // Permitimos salvar mesmo se estiver vazio para que a limpeza (Clear All) persista
      saveProjectToDB({ 
        segments: state.segments, 
        referenceImages: state.referenceImages,
      });
    }, 2000);

    return () => clearTimeout(timer);
  }, [state.segments, state.referenceImages]);

  const processFiles = async (files: FileList | File[], type: 'audio' | 'srt' | 'ref') => {
    if (!files || files.length === 0) return;

    if (type === 'audio') {
      const f = files[0];
      setAudioUrl(URL.createObjectURL(f));
      setState(p => ({ ...p, audioFile: f, audioFileName: f.name }));
      addLog(`Áudio carregado: ${f.name}`);
    } else if (type === 'srt') {
      const f = files[0];
      const t = await f.text();
      const s = parseSRT(t);
      setState(p => ({ ...p, srtFile: f, srtFileName: f.name, segments: s }));
      addLog(`Legenda SRT carregada: ${s.length} segmentos.`);
    } else if (type === 'ref') {
      const newRefs: ReferenceImage[] = [];
      for (let f of Array.from(files) as File[]) {
        const reader = new FileReader();
        const data = await new Promise<string>(r => {
          reader.onload = () => r(reader.result as string);
          reader.readAsDataURL(f);
        });
        newRefs.push({ id: Math.random().toString(), name: f.name.split('.')[0], data });
      }
      setState(p => ({ ...p, referenceImages: [...p.referenceImages, ...newRefs] }));
      addLog(`${newRefs.length} referências adicionadas.`);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'audio' | 'srt' | 'ref') => {
    if (e.target.files) {
      processFiles(e.target.files, type);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent, type: 'audio' | 'srt' | 'ref') => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files, type);
    }
  };

  const STYLE_CATEGORIES = [
    {
      name: "HISTÓRICOS/VINTAGE",
      icon: "📜",
      styles: [
        { id: "vintage_70s", name: "Vintage 70s" },
        { id: "newspaper", name: "Newspaper Archive" },
        { id: "surveillance", name: "Surveillance CCTV" },
      ]
    },
    {
      name: "VIOLENTOS/SOMBRIOS",
      icon: "🔪",
      styles: [
        { id: "dark_noir", name: "Dark Noir" },
        { id: "police_raid", name: "Police Raid" },
        { id: "street_warfare", name: "Street Warfare" },
        { id: "cemetery", name: "Cemetery Funeral" },
        { id: "prison", name: "Prison Documentary" },
      ]
    },
    {
      name: " LUXO/OSTENTAÇÃO",
      icon: "💎",
      styles: [
        { id: "mansion", name: "Mansion Luxury" },
        { id: "luxury_lifestyle", name: "Luxury Lifestyle" },
        { id: "nightclub", name: "Nightclub Party" },
      ]
    },
    {
      name: "OPERACIONAIS/TÉCNICOS",
      icon: "🔬",
      styles: [
        { id: "drug_lab", name: "Drug Lab Chemical" },
        { id: "helicopter", name: "Helicopter Surveillance" },
        { id: "courtroom", name: "Courtroom Drama" },
        { id: "airport", name: "Airport Port" },
        { id: "modern", name: "Modern Cinematic" },
      ]
    },
    {
      name: "LOCAÇÕES ESPECÍFICAS",
      icon: "🌍",
      styles: [
        { id: "border", name: "Border Desert" },
        { id: "jungle", name: "Jungle Operation" },
        { id: "desert", name: "Desert Route" },
        { id: "underground", name: "Underground Tunnel" },
      ]
    }
  ];

  const [showStyleSelector, setShowStyleSelector] = useState(false);

  const selectStyle = (id: string) => {
    setVisualStyle(id);
    localStorage.setItem('visual_style', id);
    addLog(`Estética alterada para: ${id.toUpperCase()}`, "info");
    setShowStyleSelector(false);
  };

  const rotateStyle = () => {
    const keys = Object.keys(VISUAL_STYLES);
    const currentIndex = keys.indexOf(visualStyle);
    const nextIndex = (currentIndex + 1) % keys.length;
    const nextStyle = keys[nextIndex];
    selectStyle(nextStyle);
  };

  const handleStop = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    const audio = document.querySelector('audio');
    if (audio) audio.currentTime = 0;
  };

  const handleClearAll = async () => {
    if (confirm("Tem certeza que deseja apagar todas as cenas do storyboard? Esta ação não pode ser desfeita.")) {
      setState(p => ({ ...p, segments: [] }));
      // Chamada imediata para garantir persistência antes de qualquer reload acidental
      await saveProjectToDB({ segments: [], referenceImages: state.referenceImages });
      addLog("Storyboard limpo com sucesso.", "info");
    }
  };

  const handleSeekBackward = () => {
    setCurrentTime(prev => {
      const newTime = Math.max(0, prev - 10);
      const audio = document.querySelector('audio');
      if (audio) audio.currentTime = newTime;
      return newTime;
    });
  };

  const handleSeekForward = () => {
    setCurrentTime(prev => {
      const audio = document.querySelector('audio');
      const duration = audio?.duration || 0;
      const newTime = Math.min(duration, prev + 10);
      if (audio) audio.currentTime = newTime;
      return newTime;
    });
  };

  const getActiveGeminiKey = () => geminiKeys[currentKeyIndex] || "";

  const rotateGeminiKey = () => {
    if (geminiKeys.length <= 1) return false;
    const nextIndex = (currentKeyIndex + 1) % geminiKeys.length;
    setCurrentKeyIndex(nextIndex);
    addLog(`Quota atingida. Alternando para a Chave #${nextIndex + 1}...`, "info");
    return true;
  };

  const handleCancelSingle = (id: number) => {
    abortSingleRef.current.add(id);
    addLog(`Cancelando processo da cena #${id}...`, "info");
    // Force UI update to show it stopped
    setState(p => ({
      ...p,
      segments: p.segments.map(s => s.id === id ? { ...s, isGenerating: false } : s)
    }));
  };

  const handleGenerate = async () => {
    if (state.status === 'generating') { 
      shouldStop.current = true; 
      addLog("Geração interrompida.", "info");
      return; 
    }
    
    if (!getActiveGeminiKey() && !(await ensureApiKey())) {
      addLog("API Key necessária.", "error");
      return;
    }

    setState(p => ({ ...p, status: 'generating' }));
    shouldStop.current = false;

    const segments = [...state.segments];
    const totalDuration = segments[segments.length - 1]?.endTime || 0;
    const segmentsToProcess = segments.filter(s => !s.imageData && !s.videoData);
    
    if (segmentsToProcess.length === 0) {
      setState(p => ({ ...p, status: 'ready' }));
      return;
    }

    addLog(`Iniciando produção em massa (${segmentsToProcess.length} cenas) com processamento controlado para evitar bloqueios...`, "info");

    let currentIndex = 0;
    const CONCURRENCY = 3; // Reduzido de 20 para 3 para evitar bloqueios do Google Cloud
    const JITTER_MS = 1500; // Delay entre o início de cada cena

    const processSegment = async (segment: any) => {
      if (shouldStop.current) return;

      const currentGenerationMode = segment.generationType || 'image';
      
      // Ensure "Cena XX: " prefix is present
      let promptToUse = segment.text;
      if (!promptToUse.toLowerCase().startsWith("cena")) {
        promptToUse = `Cena ${segment.id.toString().padStart(2, '0')}: ${promptToUse}`;
        setState(p => ({
          ...p,
          segments: p.segments.map(s => s.id === segment.id ? { ...s, text: promptToUse } : s)
        }));
      }

      setState(p => ({ 
        ...p, 
        segments: p.segments.map(s => s.id === segment.id ? { 
          ...s, 
          isGenerating: true,
          generationType: currentGenerationMode
        } : s) 
      }));
      
      let success = false;
      let retries = 0;
      const MAX_RETRIES = 5;

      while (!success && !shouldStop.current && retries < MAX_RETRIES) {
        try {
          if (currentGenerationMode === 'video') {
             addLog(`Iniciando fluxo completo (Imagem + Vídeo) para cena #${segment.id}...`);
             
             // First generate the base image
             const resultData = await generateCinematicImage(promptToUse, state.referenceImages, getActiveGeminiKey(), segment.startTime, totalDuration, segment.id, visualStyle);
             const blobUrl = base64ToBlobUrl(resultData);
             
             // Update UI with image first
             setState(p => ({ 
               ...p, 
               segments: p.segments.map(s => s.id === segment.id ? { ...s, imageData: blobUrl } : s) 
             }));

             // Then animate it
             const resultVideoBase64 = await generateCinematicVideo(
               promptToUse + ", smooth cinematic movement, fluid action",
               resultData, // Use the base64 we just got
               state.referenceImages,
               getActiveGeminiKey(),
               segment.id,
               (msg) => addLog(`Cena #${segment.id}: ${msg}`, "info"),
               visualStyle
             );
             
             const videoBlobUrl = base64ToBlobUrl(resultVideoBase64);
             setState(p => {
               const next = p.segments.map(s => s.id === segment.id ? { 
                 ...s, 
                 videoData: videoBlobUrl,
                 isGenerating: false,
               } : s);
               const doneCount = next.filter(x => x.imageData || x.videoData).length;
               setGenerationProgress(Math.round((doneCount / next.length) * 100));
               return { ...p, segments: next };
             });
          } else {
             addLog(`Gerando imagem para cena #${segment.id} (${visualStyle.toUpperCase()})...`);
             
             let resultData = "";
             try {
               resultData = await generateCinematicImage(promptToUse, state.referenceImages, getActiveGeminiKey(), segment.startTime, totalDuration, segment.id, visualStyle);
             } catch (e: any) {
               const errorMsg = (e.message || "").toUpperCase();
               
               if (errorMsg.includes("429") || errorMsg.includes("QUOTA")) {
                 if (rotateGeminiKey()) {
                   addLog(`Cena #${segment.id}: Quota atingida. Tentando nova chave...`, "info");
                   continue; // Retry with next key
                 }
               }

               // Lógica de Retentativa para Erros Temporários (503, Deadline)
               if (errorMsg.includes("503") || errorMsg.includes("DEADLINE") || errorMsg.includes("UNAVAILABLE")) {
                 retries++;
                 addLog(`Cena #${segment.id}: Erro temporário da API (503). Tentando novamente em 3s... (Tentativa ${retries}/${MAX_RETRIES})`, "info");
                 await new Promise(r => setTimeout(r, 3000));
                 continue; // Tenta novamente o mesmo prompt
               }

               const isSafetyError = errorMsg.includes("SAFETY") || 
                                   errorMsg.includes("BLOCKED") || 
                                   errorMsg.includes("HARM") || 
                                   errorMsg.includes("LIKENESS") || 
                                   errorMsg.includes("CELEBRITY") || 
                                   errorMsg.includes("AUDIO") || 
                                   errorMsg.includes("SAFETY FILTERS") || 
                                   errorMsg.includes("NÃO GEROU UMA IMAGEM");

               if (isSafetyError) {
                 try {
                   let rewritten = "";
                   if (anthropicApiKey) {
                     addLog(`Aviso na Cena #${segment.id}: Conteúdo sensível. Solicitando reescrita inteligente ao Claude...`, "info");
                     try {
                       rewritten = await rewritePromptWithClaude(promptToUse, errorMsg, anthropicApiKey, segment.id);
                     } catch (claudeErr: any) {
                       addLog(`Aviso: Falha no Claude. Usando Gemini Flash...`, "info");
                       rewritten = await rewritePromptWithGemini(promptToUse, errorMsg, segment.id, getActiveGeminiKey());
                     }
                   } else {
                     addLog(`Aviso na Cena #${segment.id}: Conteúdo sensível. Usando Gemini Flash...`, "info");
                     rewritten = await rewritePromptWithGemini(promptToUse, errorMsg, segment.id, getActiveGeminiKey());
                   }

                   addLog(`Cena #${segment.id}: Prompt reescrito. Gerando novamente...`, "success");
                   promptToUse = rewritten;
                   setState(p => ({
                     ...p,
                     segments: p.segments.map(s => s.id === segment.id ? { ...s, text: rewritten } : s)
                   }));
                   
                   resultData = await generateCinematicImage(rewritten, state.referenceImages, getActiveGeminiKey(), segment.startTime, totalDuration, segment.id, visualStyle);
                 } catch (rewriteErr: any) {
                   addLog(`Cena #${segment.id}: Falha crítica na reescrita: ${rewriteErr.message}`, "error");
                   throw rewriteErr;
                 }
               } else {
                 throw e;
               }
             }
             
             const blobUrl = base64ToBlobUrl(resultData);
             setState(p => {
               const next = p.segments.map(s => s.id === segment.id ? { 
                 ...s, 
                 imageData: blobUrl,
                 isGenerating: false,
               } : s);
               const doneCount = next.filter(x => x.imageData).length;
               setGenerationProgress(Math.round((doneCount / next.length) * 100));
               return { ...p, segments: next };
             });
          }
          
          addLog(`Cena #${segment.id} concluída com sucesso.`, "success");
          success = true;
        } catch (e: any) {
          const msg = e.message || "Erro desconhecido";
          let userFriendlyMsg = `Erro na Cena #${segment.id}: ${msg}`;
          
          if (msg.includes("QUOTA_EXCEEDED") || msg.includes("429")) {
            userFriendlyMsg = `Limite de cota atingido na Cena #${segment.id}. Aguardando 60s...`;
            addLog(userFriendlyMsg, "error");
            for(let d=60; d>0; d--) { 
              if(shouldStop.current) break; 
              setCountdown(d); 
              await new Promise(r => setTimeout(r, 1000)); 
            }
          } else if (msg.toLowerCase().includes("suspicious") || msg.toLowerCase().includes("aborted") || msg.toLowerCase().includes("safety")) {
            userFriendlyMsg = `Cena #${segment.id}: Bloqueio de Segurança/Atividade. Reduzindo velocidade...`;
            addLog(userFriendlyMsg, "error");
            await new Promise(r => setTimeout(r, 30000));
          } else {
            addLog(userFriendlyMsg, "error");
            await new Promise(r => setTimeout(r, 5000));
          }
          
          retries++;
          if (retries >= MAX_RETRIES) {
            addLog(`Falha definitiva na Cena #${segment.id} após ${MAX_RETRIES} tentativas.`, "error");
            setState(p => ({ ...p, segments: p.segments.map(s => s.id === segment.id ? { ...s, isGenerating: false } : s) }));
          }
        }
      }

    };

    const worker = async (workerIndex: number) => {
      // Delay inicial para cada worker não começar exatamente ao mesmo tempo
      await new Promise(r => setTimeout(r, workerIndex * JITTER_MS));
      
      while (currentIndex < segmentsToProcess.length && !shouldStop.current) {
        const segment = segmentsToProcess[currentIndex++];
        if (!segment) break;
        await processSegment(segment);
        // Pequena pausa entre cenas no mesmo worker
        await new Promise(r => setTimeout(r, JITTER_MS));
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, segmentsToProcess.length); i++) {
      workers.push(worker(i));
    }

    await Promise.all(workers);
    setCountdown(0);
    setState(p => ({ ...p, status: 'ready' }));
  };

  const handleDownloadBulk = async () => {
    if (isZippingRef.current) return;
    const scenesToDownload = state.segments.filter(s => s.imageData || s.videoData);
    if (scenesToDownload.length === 0) return;

    isZippingRef.current = true;
    setIsZipping(true);
    addLog("Preparando descarga masiva...", "info");
    
    try {
      const zip = new JSZip();
      const folder = zip.folder("escenas_cinematicas");

      for (let i = 0; i < scenesToDownload.length; i++) {
        const seg = scenesToDownload[i];
        const sceneNum = seg.id.toString().padStart(3, '0');
        
        setExportProgress(Math.round((i / scenesToDownload.length) * 50)); // Primeira metade é coletar dados

        if (seg.videoData) {
          try {
            const blob = seg.videoData.startsWith('data:') 
              ? base64ToBlob(seg.videoData) 
              : await fetch(seg.videoData).then(r => r.blob());
            
            // Detecta extensão real pelo MIME type
            const extension = blob.type.includes('webm') ? 'webm' : 'mp4';
            folder?.file(`${sceneNum}_escena.${extension}`, blob);
          } catch (e) {
            console.error(`Erro ao coletar vídeo da cena ${seg.id}:`, e);
          }
        } else if (seg.imageData) {
          try {
            const blob = seg.imageData.startsWith('data:') 
              ? base64ToBlob(seg.imageData) 
              : await fetch(seg.imageData).then(r => r.blob());
            folder?.file(`${sceneNum}_escena.png`, blob);
          } catch (e) {
            console.error(`Erro ao coletar imagem da cena ${seg.id}:`, e);
          }
        }
        
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
      }

      addLog("Gerando arquivo compactado final...", "info");
      const content = await zip.generateAsync({ type: "blob" }, (metadata) => {
        setExportProgress(50 + Math.round(metadata.percent / 2)); // Segunda metade é o peso do ZIP
      });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CineSync_Escenas_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addLog("Descarga masiva completada.", "success");
    } catch (e: any) {
      addLog(`Erro ao criar ZIP: ${e.message}`, "error");
    } finally {
      setIsZipping(false);
      isZippingRef.current = false;
    }
  };

  const handleRegenerateSingle = async (segId: number) => {
    const seg = state.segments.find(s => s.id === segId);
    if (!seg) return;
    const totalDuration = state.segments[state.segments.length - 1]?.endTime || 0;
    const mode = 'image';
    
    abortSingleRef.current.delete(segId);

    setState(p => ({ 
      ...p, 
      segments: p.segments.map(s => s.id === segId ? { 
        ...s, 
        isGenerating: true,
        generationType: mode
      } : s) 
    }));

    try {
      let resultData = "";
      let promptToUse = seg.text;
      if (!promptToUse.toLowerCase().startsWith("cena")) {
        promptToUse = `Cena ${seg.id.toString().padStart(2, '0')}: ${promptToUse}`;
      }

      let success = false;
      let retries = 0;
      const MAX_RETRIES = 3;

      while (!success && retries < MAX_RETRIES) {
        if (abortSingleRef.current.has(segId)) {
          addLog(`Regeneração da cena #${segId} interrompida.`, "info");
          return;
        }
        try {
          resultData = await generateCinematicImage(promptToUse, state.referenceImages, getActiveGeminiKey(), seg.startTime, totalDuration, seg.id, visualStyle);
          if (abortSingleRef.current.has(segId)) return;
          success = true;
        } catch (e: any) {
          const errorMsg = (e.message || "").toUpperCase();
          
          if (errorMsg.includes("429") || errorMsg.includes("QUOTA")) {
            if (rotateGeminiKey()) {
              addLog(`Cena #${segId}: Limite atingido na chave atual. Tentando nova chave...`, "info");
              continue; // Tenta novamente com a próxima chave
            }
          }

          if (errorMsg.includes("503") || errorMsg.includes("DEADLINE") || errorMsg.includes("UNAVAILABLE")) {
            retries++;
            addLog(`Cena #${segId}: Erro temporário da API. Tentando novamente (${retries}/${MAX_RETRIES})...`, "info");
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }

          const isSafetyError = errorMsg.includes("SAFETY") || 
                              errorMsg.includes("blocked") || 
                              errorMsg.includes("HARM") || 
                              errorMsg.includes("não gerou uma imagem");

          if (isSafetyError) {
            try {
              let rewritten = "";
              if (anthropicApiKey) {
                addLog(`Cena #${segId}: Conteúdo sensível. Solicitando reescrita ao Claude...`, "info");
                try {
                  rewritten = await rewritePromptWithClaude(promptToUse, errorMsg, anthropicApiKey, seg.id);
                } catch (claudeErr: any) {
                   if (claudeErr.message?.includes("credit balance") || claudeErr.message?.includes("400")) {
                      addLog(`Aviso: Claude sem créditos. Usando Gemini Flash para reescrita...`, "info");
                      rewritten = await rewritePromptWithGemini(promptToUse, errorMsg, seg.id, getActiveGeminiKey());
                    } else {
                      throw claudeErr;
                    }
                }
              } else {
                addLog(`Cena #${segId}: Conteúdo sensível. Usando Gemini Flash para reescrita...`, "info");
                rewritten = await rewritePromptWithGemini(promptToUse, errorMsg, seg.id, getActiveGeminiKey());
              }

              addLog(`Cena #${segId}: Prompt reescrito. Tentando novamente...`, "success");
              promptToUse = rewritten;
              // No retries for rewritten prompts here, just try once more or it can loop
              resultData = await generateCinematicImage(rewritten, state.referenceImages, getActiveGeminiKey(), seg.startTime, totalDuration, seg.id);
              success = true;
            } catch (rewriteErr: any) {
              addLog(`Cena #${segId}: Falha na reescrita: ${rewriteErr.message}`, "error");
              throw rewriteErr;
            }
          } else {
            throw e;
          }
        }
      }
      
      setState(p => ({ 
        ...p, 
        segments: p.segments.map(s => s.id === segId ? { 
          ...s, 
          text: promptToUse,
          imageData: base64ToBlobUrl(resultData),
          isGenerating: false,
        } : s) 
      }));
    } catch (e: any) {
      addLog(`Erro: ${e.message}`, "error");
      setState(p => ({ 
        ...p, 
        segments: p.segments.map(s => s.id === segId ? { ...s, isGenerating: false } : s) 
      }));
    }
  };

  const handleExportPrompts = () => {
    if (state.segments.length === 0) return;
    let srtContent = "";
    state.segments.forEach((seg, index) => {
      const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
      };
      srtContent += `${index + 1}\n${formatTime(seg.startTime)} --> ${formatTime(seg.endTime)}\n${seg.text}\n\n`;
    });
    const blob = new Blob([srtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prompts_sincronizados_${Date.now()}.srt`;
    a.click();
    URL.revokeObjectURL(url);
    addLog("Prompts exportados!", "success");
  };

  const handleExportPromptsTXT = () => {
    if (state.segments.length === 0) return;
    let content = "=== PROMPTS SINCRONIZADOS (CineSync Pro) ===\n\n";
    state.segments.forEach((seg, index) => {
      const format = (s: number) => {
        const min = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
      };
      content += `CENA #${index + 1} [${format(seg.startTime)} - ${format(seg.endTime)}]:\n${seg.text}\n\n`;
    });
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prompts_sequencia_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    addLog("Lista de prompts exportada!", "success");
  };

  const handleAnimateSingle = async (segId: number) => {
    const seg = state.segments.find(s => s.id === segId);
    if (!seg || !seg.imageData) {
      addLog("Gere uma imagem antes de tentar animar.", "error");
      return;
    }

    setState(p => ({
      ...p,
      segments: p.segments.map(s => s.id === segId ? { 
        ...s, 
        isGenerating: true,
        generationType: 'video' 
      } : s)
    }));

    addLog(`Animando cena #${segId} (Image-to-Video)...`, "info");

    abortSingleRef.current.delete(segId);

    let promptToUse = seg.text;
    let success = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 4;

    while (!success && attempts < MAX_ATTEMPTS) {
      if (abortSingleRef.current.has(segId)) {
        addLog(`Animação da cena #${segId} interrompida.`, "info");
        return;
      }
      try {
        // Step 1: Optimize prompt for video if needed
        let videoPrompt = promptToUse;
        if (!videoPrompt.toLowerCase().includes("movement") && !videoPrompt.toLowerCase().includes("cinematic")) {
          videoPrompt += ", smooth cinematic movement, fluid action.";
        }

        // Step 2: Convert existing imageData (Blob URL) back to Base64 for the API
        const base64Image = await blobUrlToBase64(seg.imageData);
        if (abortSingleRef.current.has(segId)) return;

        // Step 3: Call Video Generation
        const resultVideoBase64 = await generateCinematicVideo(
          videoPrompt,
          base64Image,
          state.referenceImages,
          getActiveGeminiKey(),
          segId,
          (msg) => addLog(`Cena #${segId}: ${msg}`, "info"),
          visualStyle
        );
        if (abortSingleRef.current.has(segId)) return;

        // Step 4: Convert result to memory-efficient Blob URL
        const videoBlobUrl = base64ToBlobUrl(resultVideoBase64);

        setState(p => ({
          ...p,
          segments: p.segments.map(s => s.id === segId ? {
            ...s,
            text: promptToUse, // Salva o prompt possivelmente reescrito
            videoData: videoBlobUrl,
            generationType: 'video',
            isGenerating: false,
          } : s)
        }));

        addLog(`Cena #${segId} animada com sucesso!`, "success");
        success = true;
      } catch (e: any) {
        const errorMsg = (e.message || "").toUpperCase();
        
        if (errorMsg.includes("429") || errorMsg.includes("QUOTA")) {
          if (rotateGeminiKey()) {
            addLog(`Cena #${segId}: Quota atingida na chave atual. Tentando nova chave...`, "info");
            continue; // Tenta de novo no loop
          }
        }
        
        if (errorMsg.includes("PROJETO_BLOQUEADO")) {
          addLog("ACESSO NEGADO: O projeto desta API Key não tem permissão para usar modelos de IA Generativa.", "error");
          addLog("DICA: Verifique se habilitou a 'Generative AI API' no console cloud e aceitou os termos.", "info");
          break;
        }

        const isSafetyError = 
          errorMsg.includes("SAFETY") || 
          errorMsg.includes("LIKENESS") || 
          errorMsg.includes("CELEBRITY") || 
          errorMsg.includes("AUDIO") || 
          errorMsg.includes("SAFETY FILTERS") || 
          errorMsg.includes("BLOCKED");

        if (isSafetyError && attempts < MAX_ATTEMPTS - 1) {
          attempts++;
          addLog(`Aviso na Cena #${segId}: Filtro de segurança ativado no vídeo. Tentando reescrever o prompt...`, "info");
          
          try {
            let rewritten = "";
            if (anthropicApiKey) {
              try {
                rewritten = await rewritePromptWithClaude(promptToUse, errorMsg, anthropicApiKey, segId);
              } catch (claudeErr: any) {
                addLog(`Cena #${segId}: Claude indisponível (créditos/400). Usando Gemini para reescrita...`, "info");
                rewritten = await rewritePromptWithGemini(promptToUse, errorMsg, segId, getActiveGeminiKey());
              }
            } else {
              rewritten = await rewritePromptWithGemini(promptToUse, errorMsg, segId, getActiveGeminiKey());
            }

            if (abortSingleRef.current.has(segId)) return;

            addLog(`Cena #${segId}: Prompt higienizado. Tentando animar novamente...`, "success");
            promptToUse = rewritten;
            
            // Atualiza prompt na UI
            setState(p => ({
              ...p,
              segments: p.segments.map(s => s.id === segId ? { ...s, text: rewritten } : s)
            }));
            
            // O loop continuará e tentará novamente com promptToUse atualizado
          } catch (rewriteErr: any) {
            addLog(`Cena #${segId}: Falha ao reescrever prompt: ${rewriteErr.message}`, "error");
            break;
          }
        } else {
          addLog(`Erro ao animar Cena #${segId}: ${e.message}`, "error");
          break;
        }
      }
    }

    if (!success) {
      setState(p => ({
        ...p,
        segments: p.segments.map(s => s.id === segId ? { ...s, isGenerating: false } : s)
      }));
    }
  };

  const [isExportingProject, setIsExportingProject] = useState(false);

  const handleExportProject = async () => {
    if (state.segments.length === 0) return;
    if (isExportingProject) return;
    
    setIsExportingProject(true);
    setExportProgress(0);
    addLog("Iniciando exportação massiva...", "info");
    
    try {
      const parts: any[] = [];
      parts.push('{"version":"2.0","referenceImages":[');
      
      for (let i = 0; i < state.referenceImages.length; i++) {
        parts.push(JSON.stringify(state.referenceImages[i]));
        if (i < state.referenceImages.length - 1) parts.push(',');
        if (i % 10 === 0) await new Promise(r => setTimeout(r, 0));
      }
      
      parts.push('],"segments":[');
      
      for (let i = 0; i < state.segments.length; i++) {
        const seg = state.segments[i];
        let exportedSeg = { ...seg };

        // Atualiza progresso
        setExportProgress(Math.round(((i + 1) / state.segments.length) * 100));

        if (exportedSeg.videoData?.startsWith('blob:')) {
          try {
            exportedSeg.videoData = await blobUrlToBase64(exportedSeg.videoData);
            // Se temos vídeo com sucesso, removemos a imageData para evitar conflitos em certas IAs/Editores
            // que priorizam imagem sobre vídeo se ambos estiverem presentes.
            delete exportedSeg.imageData;
          } catch (err) {
            console.error(`Falha ao converter vídeo da cena ${seg.id} para Base64:`, err);
          }
        } else if (exportedSeg.imageData?.startsWith('blob:')) {
          try {
            exportedSeg.imageData = await blobUrlToBase64(exportedSeg.imageData);
          } catch (err) {
            console.error(`Falha ao converter imagem da cena ${seg.id} para Base64:`, err);
          }
        }

        parts.push(JSON.stringify(exportedSeg));
        if (i < state.segments.length - 1) parts.push(',');
        
        // Yield mais frequente e agressivo para projetos gigantes (>100 cenas)
        // Isso previne o travamento da thread principal e erro de "message channel closed"
        if (i % 2 === 0) {
          await new Promise(r => setTimeout(r, 10)); 
        } else {
          await new Promise(r => setTimeout(r, 0));
        }
      }
      
      parts.push(']}');
      
      addLog("Montando arquivo final (isso pode demorar segundos)...", "info");
      const blob = new Blob(parts, { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cinesync_projeto_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Wait a bit before revoking to ensure download starts in all browsers
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      addLog("Projeto exportado com sucesso!", "success");
    } catch (e: any) {
      addLog(`Erro na exportação: ${e.message}`, "error");
      console.error(e);
    } finally {
      setIsExportingProject(false);
      setExportProgress(0);
    }
  };

  const total = state.segments.length;
  const doneVideos = state.segments.filter(s => s.videoData).length;
  const convertingVideos = state.segments.filter(s => s.isGenerating && s.generationType === 'video').length;
  const doneImagesOnly = state.segments.filter(s => s.imageData && !s.videoData && !(s.isGenerating && s.generationType === 'video')).length;
  const generatingImages = state.segments.filter(s => s.isGenerating && (s.generationType === 'image' || !s.generationType)).length;
  const emptyScenes = state.segments.filter(s => !s.imageData && !s.videoData && !s.isGenerating).length;
  const done = doneVideos + doneImagesOnly; // Total com alguma mídia pronta

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 font-sans selection:bg-indigo-500">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row justify-between items-center border-b border-gray-800 pb-4 gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2.5 rounded-xl shadow-lg">
              <FilmIcon className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tighter">CineSync <span className="text-indigo-400">Pro</span></h1>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 uppercase font-black tracking-widest">IA Cinematic Hybrid Mode</span>
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <button 
                onClick={() => setShowStyleSelector(!showStyleSelector)}
                title="Escolher estetica visual da produção"
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 rounded-lg text-sm font-bold border border-gray-800 hover:bg-gray-800 transition-all text-yellow-500 shadow-lg shadow-yellow-500/5 group"
              >
                <BoltIcon className="w-4 h-4 group-hover:animate-pulse" />
                <span className="hidden sm:inline">Estilo: </span>
                <span className="font-black uppercase truncate max-w-[120px]">{visualStyle.replace('_', ' ')}</span>
              </button>

              {showStyleSelector && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowStyleSelector(false)}></div>
                  <div className="absolute right-0 mt-2 w-80 bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl z-50 overflow-hidden animate-fadeIn">
                    <div className="p-4 bg-black/40 border-b border-gray-800 flex justify-between items-center">
                      <h3 className="text-xs font-black uppercase text-gray-500 tracking-widest">Estilos Disponíveis</h3>
                      <button onClick={() => setShowStyleSelector(false)} className="text-gray-500 hover:text-white"><XMarkIcon className="w-4 h-4"/></button>
                    </div>
                    <div className="max-h-[70vh] overflow-y-auto p-4 space-y-6 scrollbar-hide">
                      {STYLE_CATEGORIES.map(cat => (
                        <div key={cat.name} className="space-y-2">
                          <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                             <span>{cat.icon}</span> {cat.name}
                          </h4>
                          <div className="grid grid-cols-1 gap-1">
                            {cat.styles.map(s => (
                              <button
                                key={s.id}
                                onClick={() => selectStyle(s.id)}
                                className={`text-left px-3 py-2 rounded-lg text-[11px] font-bold transition-all flex items-center justify-between group ${visualStyle === s.id ? 'bg-indigo-600 text-white' : 'hover:bg-gray-800 text-gray-400 hover:text-gray-200'}`}
                              >
                                {s.name}
                                {visualStyle === s.id && <CheckCircleIcon className="w-3 h-3 text-white" />}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            <button 
              onClick={() => setShowSettings(!showSettings)} 
              title="Configurações da API"
              className="p-2 bg-gray-900 rounded-lg hover:bg-gray-800 border border-gray-800 transition-colors"
            >
              <CpuChipIcon className="w-5 h-5"/>
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()} 
              disabled={isImporting}
              title="Carregar projeto salvo anteriormente"
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 rounded-lg text-sm font-bold border border-gray-800 hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
               {isImporting ? <ArrowPathIcon className="w-4 h-4 animate-spin text-indigo-400" /> : <ArrowUpTrayIcon className="w-4 h-4 text-indigo-400" />} 
               {isImporting ? `Importando (${importProgress}%)` : 'Importar Projeto'}
            </button>
            <input ref={fileInputRef} type="file" className="hidden" accept=".json" onChange={async (e) => {
              const f = e.target.files?.[0];
              if(f) {
                setIsImporting(true);
                setImportProgress(0);
                addLog("Iniciando importação de arquivo grande...", "info");
                try {
                  const result = await parseLargeProjectFile(f, (p) => setImportProgress(Math.round(p)));
                  setState(p => ({ 
                    ...p, 
                    segments: result.segments || [], 
                    referenceImages: result.referenceImages || [] 
                  }));
                  addLog(`Projeto importado! ${result.segments.length} cenas.`, "success");
                } catch (err: any) { 
                  addLog(`Erro ao importar: ${err.message}`, "error"); 
                } finally {
                  setIsImporting(false);
                }
              }
            }} />
            <button 
              onClick={handleExportProject} 
              disabled={isExportingProject}
              title="Salvar o estado atual do projeto"
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 rounded-lg text-sm font-black hover:bg-indigo-500 transition-all active:scale-95 disabled:opacity-70"
            >
               {isExportingProject ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <ArrowDownTrayIcon className="w-4 h-4" />} 
               {isExportingProject ? `Exportando (${exportProgress}%)` : 'Exportar Projeto'}
            </button>
          </div>
        </header>

        {showSettings && (
          <div className="bg-gray-900 p-6 rounded-3xl border border-gray-800 animate-fadeIn space-y-6 shadow-2xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-gray-500 block uppercase tracking-widest flex items-center gap-2">
                    <CpuChipIcon className="w-4 h-4 text-indigo-400"/> Chaves de API Gemini
                  </label>
                  {geminiKeys.length > 0 && (
                    <span className="text-[9px] font-black bg-indigo-500/20 text-indigo-400 px-2 py-1 rounded-full uppercase">
                      {geminiKeys.length} {geminiKeys.length === 1 ? 'Chave' : 'Chaves'}
                    </span>
                  )}
                </div>
                <textarea 
                  value={geminiKeys.join('\n')} 
                  onChange={e => {
                    const keys = e.target.value.split('\n').map(k => k.trim()).filter(k => k !== "");
                    setGeminiKeys(keys);
                    localStorage.setItem('gemini_api_keys', JSON.stringify(keys));
                  }} 
                  rows={4}
                  className="w-full bg-black border border-gray-800 rounded-2xl p-4 text-sm focus:border-indigo-500 outline-none transition-all font-mono placeholder:text-gray-700" 
                  placeholder="Insira suas chaves (uma por linha):&#10;AIzaSy...&#10;AIzaSy..." 
                />
                <p className="text-[9px] text-gray-600 font-bold uppercase tracking-wider">As chaves são salvas automaticamente no seu navegador.</p>
              </div>

              <div className="space-y-3 p-4 bg-indigo-950/20 rounded-2xl border border-indigo-500/20">
                <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-orange-500 rounded-xl shadow-lg">
                    <SparklesIcon className="w-5 h-5 text-white"/>
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white">API Claude Sonnet 3.5</h4>
                    <p className="text-[10px] text-indigo-300 font-bold">Reescrita inteligente de prompts</p>
                  </div>
                </div>

                <div className={`p-3 rounded-xl mb-3 flex items-center gap-2 border ${anthropicApiKey ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                  <div className={`w-2 h-2 rounded-full ${anthropicApiKey ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <span className="text-[10px] font-black uppercase tracking-wider">{anthropicApiKey ? 'API Configurada' : 'API não configurada'}</span>
                </div>

                <label className="text-[9px] font-black text-gray-500 block uppercase mb-1">Chave da API Anthropic</label>
                <input 
                  type="password" 
                  value={anthropicApiKey} 
                  onChange={e => {
                    const val = e.target.value;
                    setAnthropicApiKey(val);
                    localStorage.setItem('anthropic_api_key', val);
                  }} 
                  className="w-full bg-black border border-gray-800 rounded-xl p-3 text-xs focus:border-orange-500 outline-none transition-all" 
                  placeholder="sk-ant-api03-..." 
                />
                
                <div className="flex gap-2 mt-4">
                   <button 
                     onClick={() => addLog("Chave salva localmente.", "success")}
                     className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-400 text-white rounded-xl text-[10px] font-black uppercase flex items-center justify-center gap-2 transition-all"
                   >
                     <ArchiveBoxArrowDownIcon className="w-3 h-3"/> Salvar API Key
                   </button>
                   <button 
                     onClick={() => {
                        setAnthropicApiKey("");
                        localStorage.removeItem('anthropic_api_key');
                        addLog("Chave removida.", "info");
                     }}
                     className="p-2 bg-gray-800 hover:bg-red-900/40 text-gray-400 border border-gray-700 rounded-xl transition-all"
                   >
                     <TrashIcon className="w-4 h-4"/>
                   </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-gray-900 p-5 rounded-2xl border border-gray-800 space-y-4 shadow-xl">
              <h2 className="font-black text-xs uppercase text-gray-500 tracking-widest flex items-center gap-2"><CloudArrowUpIcon className="w-4 h-4 text-indigo-400" /> Fontes de Mídia</h2>
              <div className="grid grid-cols-1 gap-3">
                <label 
                  className="cursor-pointer group"
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, 'audio')}
                >
                    <div className="p-3 bg-black border border-gray-800 rounded-xl group-hover:border-indigo-500 transition-colors flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-gray-400">Áudio (.mp3)</span>
                        {state.audioFileName && <span className="text-[10px] text-indigo-400 font-mono truncate max-w-[200px]">{state.audioFileName}</span>}
                      </div>
                      {state.audioFile ? <CheckCircleIcon className="w-5 h-5 text-green-500"/> : <ArrowUpTrayIcon className="w-5 h-5 text-gray-700 group-hover:text-indigo-400"/>}
                    </div>
                    <input type="file" accept=".mp3" className="hidden" onChange={e => handleFileUpload(e, 'audio')} />
                </label>
                <label 
                  className="cursor-pointer group"
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, 'srt')}
                >
                    <div className="p-3 bg-black border border-gray-800 rounded-xl group-hover:border-purple-500 transition-colors flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-gray-400">Legenda (.srt)</span>
                        {state.srtFileName && <span className="text-[10px] text-purple-400 font-mono truncate max-w-[200px]">{state.srtFileName}</span>}
                      </div>
                      {state.srtFile ? <CheckCircleIcon className="w-5 h-5 text-green-500"/> : <ArrowUpTrayIcon className="w-5 h-5 text-gray-700 group-hover:text-purple-400"/>}
                    </div>
                    <input type="file" accept=".srt" className="hidden" onChange={e => handleFileUpload(e, 'srt')} />
                </label>
              </div>
            </div>

            <div 
              className="bg-gray-900 p-5 rounded-2xl border border-gray-800 shadow-xl"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, 'ref')}
            >
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-black text-xs uppercase text-gray-500 tracking-widest flex items-center gap-2"><PhotoIcon className="w-4 h-4 text-indigo-400" /> Referências</h2>
                <button 
                  onClick={() => document.getElementById('ref-up')?.click()} 
                  title="Adicionar imagens de referência para manter consistência visual"
                  className="p-1.5 bg-indigo-600 rounded-lg hover:bg-indigo-500 shadow-lg"
                >
                  <PlusIcon className="w-5 h-5"/>
                </button>
                <input id="ref-up" type="file" multiple accept="image/*" className="hidden" onChange={e => handleFileUpload(e, 'ref')} />
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto scrollbar-hide">
                {state.referenceImages.map(img => (
                  <div key={img.id} className="relative bg-black rounded-xl overflow-hidden border border-gray-800 group">
                    <img src={img.data} className="w-full aspect-square object-cover" />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-1 text-[8px] font-black uppercase truncate text-center">
                      {img.name}
                    </div>
                    <button onClick={() => setState(p => ({ ...p, referenceImages: p.referenceImages.filter(x => x.id !== img.id) }))} className="absolute top-1 right-1 p-1 bg-black/60 rounded text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><XMarkIcon className="w-3 h-3"/></button>
                  </div>
                ))}
              </div>
            </div>

            {state.segments.length > 0 && (
              <div className="bg-gray-900 p-5 rounded-2xl border border-gray-800 shadow-lg space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black uppercase text-gray-500 tracking-widest">Estado da Produção</span>
                  <div className="flex gap-4">
                    <div className="flex items-center gap-1.5" title="Vídeos concluídos">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.6)]"></div>
                      <span className="text-[11px] font-mono text-white">{doneVideos}</span>
                    </div>
                    <div className="flex items-center gap-1.5" title="Vídeos sendo convertidos agora">
                      <div className="w-1.5 h-1.5 rounded-full bg-pink-500 shadow-[0_0_8px_rgba(236,72,153,0.6)] animate-pulse"></div>
                      <span className="text-[11px] font-mono text-white">{convertingVideos}</span>
                    </div>
                    <div className="flex items-center gap-1.5" title="Imagens concluídas">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                      <span className="text-[11px] font-mono text-white">{doneImagesOnly}</span>
                    </div>
                    <div className="flex items-center gap-1.5" title="Cenas ainda sem nada">
                      <div className="w-1.5 h-1.5 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)]"></div>
                      <span className="text-[11px] font-mono text-white">{emptyScenes}</span>
                    </div>
                  </div>
                </div>
                
                <div className="relative h-2 bg-black rounded-full overflow-hidden border border-gray-800">
                  <div 
                    className="absolute inset-y-0 left-0 bg-indigo-600 transition-all duration-700 ease-out shadow-[0_0_15px_rgba(79,70,229,0.4)]" 
                    style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
                  ></div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
                  <div className="bg-black/40 p-2 rounded-xl border border-gray-800 text-center">
                    <div className="text-[8px] font-black text-gray-500 uppercase tracking-tighter">Cenas Totais</div>
                    <div className="text-sm font-black text-white">{total}</div>
                  </div>
                  <div className="bg-black/40 p-2 rounded-xl border border-gray-800 text-center">
                    <div className="text-[8px] font-black text-green-500 uppercase tracking-tighter">Imagens Ok</div>
                    <div className="text-sm font-black text-green-400">{doneImagesOnly}</div>
                  </div>
                  <div className="bg-black/40 p-2 rounded-xl border border-gray-800 text-center">
                    <div className="text-[8px] font-black text-orange-400 uppercase tracking-tighter">Imag. Gerando</div>
                    <div className="text-sm font-black text-orange-300">{generatingImages}</div>
                  </div>
                  <div className="bg-black border border-purple-500/30 p-2 rounded-xl text-center shadow-[0_0_10px_rgba(168,85,247,0.1)]">
                    <div className="text-[8px] font-black text-purple-500 uppercase tracking-tighter">Vídeos Ok</div>
                    <div className="text-sm font-black text-purple-400">{doneVideos}</div>
                  </div>
                  <div className="bg-black border border-pink-500/30 p-2 rounded-xl text-center shadow-[0_0_10px_rgba(236,72,153,0.1)]">
                    <div className="text-[8px] font-black text-pink-500 uppercase tracking-tighter">Víd. Convert.</div>
                    <div className="text-sm font-black text-pink-400">{convertingVideos}</div>
                  </div>
                  <div className="bg-black/40 p-2 rounded-xl border border-gray-800 text-center">
                    <div className="text-[8px] font-black text-gray-600 uppercase tracking-tighter">Vazias</div>
                    <div className="text-sm font-black text-gray-500">{emptyScenes}</div>
                  </div>
                </div>
              </div>
            )}

            <button 
              onClick={handleGenerate} 
              disabled={state.segments.length === 0} 
              title={state.status === 'generating' ? "Parar a geração de imagens" : "Começar a gerar imagens para todas as cenas"}
              className={`w-full py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-3 transition-all border shadow-2xl ${state.status === 'generating' ? 'bg-red-950 border-red-500 text-red-500' : 'bg-indigo-600 border-indigo-400 text-white hover:bg-indigo-500 shadow-indigo-900/40'}`}
            >
              {state.status === 'generating' ? (
                <><StopIcon className="w-6 h-6 animate-pulse"/> Interromper ({countdown}s) </>
              ) : (
                <><SparklesIcon className="w-6 h-6"/> Iniciar Produção</>
              )}
            </button>

            <div className="bg-black rounded-2xl border border-gray-800 h-64 flex flex-col overflow-hidden">
              <div className="p-2 bg-gray-900 border-b border-gray-800 text-[10px] font-black uppercase text-gray-500 flex items-center gap-2"><CommandLineIcon className="w-3 h-3"/> Logs</div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2 font-mono text-[10px] scrollbar-hide">
                {apiLogs.map((log, i) => (
                  <div key={i} className={`p-1.5 rounded border-l-2 ${log.type === 'error' ? 'bg-red-500/5 border-red-500 text-red-400' : log.type === 'success' ? 'bg-green-500/5 border-green-500 text-green-400' : 'bg-blue-500/5 border-blue-500 text-blue-400'}`}>
                    &gt; {log.msg}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-8 space-y-6">
            <VideoPreview 
              audioUrl={audioUrl} segments={state.segments} isPlaying={isPlaying}
              isExporting={state.status === 'exporting'} includeAudio={true}
              currentTime={currentTime} onTimeUpdate={setCurrentTime}
              onExportComplete={() => { setState(p => ({ ...p, status: 'ready' })); addLog("Exportado!", "success"); }}
              onExportProgress={setExportProgress}
            />
            
            <div className="bg-gray-900 p-6 rounded-3xl flex flex-col md:flex-row items-center gap-6 shadow-2xl border border-gray-800">
              <div className="flex items-center gap-3">
                <button 
                  onClick={handleSeekBackward} 
                  title="Retroceder 10s"
                  className="p-3 bg-gray-800 text-gray-400 rounded-full hover:bg-gray-700 hover:text-white transition-all active:scale-95"
                >
                  <SkipBack className="w-6 h-6" />
                </button>
                
                <button 
                  onClick={() => setIsPlaying(!isPlaying)} 
                  className="w-16 h-16 bg-white text-black rounded-full flex items-center justify-center hover:scale-110 transition-all shadow-xl ring-4 ring-black shrink-0 active:scale-95"
                >
                  {isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-1" />}
                </button>

                <button 
                  onClick={handleSeekForward} 
                  title="Avançar 10s"
                  className="p-3 bg-gray-800 text-gray-400 rounded-full hover:bg-gray-700 hover:text-white transition-all active:scale-95"
                >
                  <SkipForward className="w-6 h-6" />
                </button>

                <button 
                  onClick={handleStop} 
                  title="Parar e resetar"
                  className="p-3 bg-gray-800 text-red-500/80 rounded-full hover:bg-red-900/40 hover:text-red-400 transition-all active:scale-95"
                >
                  <Square className="w-6 h-6 fill-current" />
                </button>
              </div>

              <div className="flex-1 min-w-0 w-full">
                  <div className="h-3 bg-black rounded-full relative overflow-hidden border border-gray-800 cursor-pointer" onClick={(e) => {
                      const audio = document.querySelector('audio');
                      if(audio) audio.currentTime = (e.nativeEvent.offsetX / e.currentTarget.clientWidth) * audio.duration;
                  }}>
                     <div className="bg-indigo-600 h-full" style={{ width: `${(currentTime/(document.querySelector('audio')?.duration || 1))*100}%` }}></div>
                  </div>
                  <div className="flex justify-between mt-2">
                    <span className="text-xl font-black text-white">{Math.floor(currentTime/60)}:{(currentTime%60).toFixed(0).padStart(2,'0')}</span>
                    <span className="text-gray-500 text-[10px] font-black uppercase">Preview Sincronizado</span>
                  </div>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <button 
                  onClick={handleExportPrompts} 
                  disabled={state.segments.length === 0} 
                  title="Exportar as legendas sincronizadas em formato SRT"
                  className="bg-blue-600 px-4 py-3 rounded-xl font-black text-[10px] uppercase hover:bg-blue-500 disabled:opacity-50 shadow-xl transition-all flex items-center gap-2 justify-center"
                >
                  <CommandLineIcon className="w-4 h-4"/> Exportar SRT
                </button>
                <button 
                  onClick={handleExportPromptsTXT} 
                  disabled={state.segments.length === 0} 
                  title="Exportar a lista de prompts com tempos em formato TXT"
                  className="bg-indigo-700 px-4 py-3 rounded-xl font-black text-[10px] uppercase hover:bg-indigo-600 disabled:opacity-50 shadow-xl transition-all flex items-center gap-2 justify-center"
                >
                  <ListBulletIcon className="w-4 h-4"/> Exportar Prompts (TXT)
                </button>
                <button 
                  onClick={handleDownloadBulk} 
                  disabled={done === 0 || isZipping} 
                  title="Baixar todas as imagens geradas em um arquivo ZIP"
                  className="bg-purple-600 px-4 py-3 rounded-xl font-black text-[10px] uppercase hover:bg-purple-500 disabled:opacity-50 shadow-xl transition-all flex items-center gap-2 justify-center"
                >
                  {isZipping ? <ArrowPathIcon className="w-4 h-4 animate-spin"/> : <ArchiveBoxArrowDownIcon className="w-4 h-4"/>} 
                  {isZipping ? `Zipando (${exportProgress}%)` : 'Descargar Escenas'}
                </button>
                <button 
                  onClick={() => { setState(p => ({ ...p, status: 'exporting' })); addLog("Renderizando..."); }} 
                  disabled={done === 0 || state.status === 'exporting'} 
                  title="Criar um vídeo final com as imagens e o áudio"
                  className="bg-green-600 px-4 py-3 rounded-xl font-black text-[10px] uppercase hover:bg-green-500 disabled:opacity-50 shadow-xl transition-all flex items-center gap-2 justify-center"
                >
                  {state.status === 'exporting' ? <ArrowPathIcon className="w-4 h-4 animate-spin"/> : <FilmIcon className="w-4 h-4"/>} Exportar Vídeo
                </button>
              </div>
            </div>

            <div className="bg-gray-900 rounded-3xl border border-gray-800 overflow-hidden shadow-2xl">
              <div className="p-4 bg-black/40 border-b border-gray-800 flex justify-between items-center">
                <h3 className="text-xs font-black uppercase text-gray-500 tracking-widest flex items-center gap-2"><BoltIcon className="w-4 h-4 text-yellow-500"/> Storyboard Híbrido</h3>
                <div className="flex gap-2">
                  <button 
                    disabled={isOptimizingIA}
                    title="Usar IA para agrupar e otimizar o storyboard completo"
                    onClick={async () => {
                      setIsOptimizingIA(true);
                      addLog("Agrupando cenas (IA Storyboard)...");
                      try {
                        const grouped = optimizeSegmentsRuleBased(state.segments);
                        const opt = await optimizeScriptWithAI(grouped, state.referenceImages, getActiveGeminiKey());
                        setState(p => ({...p, segments: opt}));
                        addLog(`Storyboard pronto! ${opt.length} cenas.`, "success");
                      } catch (e: any) { addLog(`Erro: ${e.message}`, "error"); } finally { setIsOptimizingIA(false); }
                    }} className="text-[9px] font-bold bg-purple-900/40 text-purple-300 border border-purple-500/30 px-3 py-1.5 rounded-lg hover:bg-purple-900/60 transition-colors uppercase flex items-center gap-1">
                      {isOptimizingIA ? <><ArrowPathIcon className="w-3 h-3 animate-spin"/> Pensando...</> : <><SparklesIcon className="w-3 h-3"/> IA Storyboard</>}
                  </button>
                  <button 
                    onClick={handleClearAll}
                    disabled={state.segments.length === 0}
                    title="Remover todos os segmentos do storyboard"
                    className="text-[9px] font-bold bg-red-900/20 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-lg hover:bg-red-900/40 transition-colors uppercase flex items-center gap-1"
                  >
                    <TrashIcon className="w-3 h-3"/> Limpar Cenas
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4 max-h-[600px] overflow-y-auto scrollbar-hide">
                {state.segments.map((seg) => (
                  <div key={seg.id} className={`group relative bg-black rounded-2xl border transition-all p-2 ${currentTime >= seg.startTime && currentTime < seg.endTime ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-gray-800'}`}>
                    <div className="absolute top-2 left-2 flex flex-col gap-1 z-10">
                       <button 
                         onClick={(e) => {
                           e.stopPropagation();
                           setState(p => ({
                             ...p,
                             segments: p.segments.map(s => s.id === seg.id ? { 
                               ...s, 
                               generationType: s.generationType === 'video' ? 'image' : 'video' 
                             } : s)
                           }));
                         }}
                         title="Clique para alternar entre gerar apenas Imagem ou Imagem+Vídeo"
                         className={`px-2 py-1 border rounded-lg text-[9px] font-black uppercase text-white flex items-center gap-1 shadow-lg transition-all active:scale-95 ${seg.generationType === 'video' || seg.videoData ? 'bg-purple-600 border-purple-400 hover:bg-purple-500' : 'bg-indigo-600 border-indigo-400 hover:bg-indigo-500'}`}
                       >
                         {seg.generationType === 'video' || seg.videoData ? <VideoCameraIcon className="w-3 h-3"/> : <PhotoIcon className="w-3 h-3"/>}
                         {seg.generationType === 'video' || seg.videoData ? 'Vídeo' : 'Imagem'}
                       </button>
                       {seg.isRecommendedForVideo && !seg.videoData && (
                         <div className="px-2 py-1 bg-yellow-500 border border-yellow-400 rounded-lg text-[9px] font-black uppercase text-black flex items-center gap-1 shadow-lg animate-pulse">
                           <StarIcon className="w-3 h-3"/> Sugerido para Vídeo
                         </div>
                       )}
                    </div>
                    <div className="aspect-video bg-gray-900 rounded-xl overflow-hidden mb-2 relative group-hover:ring-2 group-hover:ring-indigo-500/30 transition-all cursor-pointer" onClick={() => setModalSegmentId(seg.id)}>
                      {seg.videoData ? (
                        <video src={seg.videoData} className="w-full h-full object-cover" autoPlay muted loop playsInline />
                      ) : seg.imageData ? (
                        <img src={seg.imageData} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-gray-700">
                          {seg.isGenerating ? (
                            <div className="flex flex-col items-center gap-2">
                              <ArrowPathIcon className="w-8 h-8 animate-spin text-indigo-500"/>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCancelSingle(seg.id);
                                }}
                                className="px-4 py-1.5 bg-red-600 text-white text-[10px] font-black uppercase rounded-full hover:bg-red-500 transition-all shadow-xl active:scale-95 z-30"
                              >
                                Parar Geração
                              </button>
                            </div>
                          ) : <PhotoIcon className="w-8 h-8"/>}
                        </div>
                      )}
                    </div>
                    <textarea value={seg.text} onChange={(e) => setState(p => ({ ...p, segments: p.segments.map(s => s.id === seg.id ? { ...s, text: e.target.value } : s) }))} className="w-full bg-transparent text-[11px] text-gray-400 font-medium resize-none outline-none focus:text-white leading-tight h-8" rows={2}/>
                    <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                       {seg.imageData && !seg.videoData && !seg.isGenerating && (
                         <button onClick={() => handleAnimateSingle(seg.id)} title="Animar esta imagem para vídeo" className="p-2 bg-purple-600 rounded-full shadow-lg border border-purple-400 hover:bg-purple-500 transition-colors"><FilmIcon className="w-3 h-3 text-white"/></button>
                       )}
                       <button onClick={() => handleRegenerateSingle(seg.id)} title="Regerar esta cena" className="p-2 bg-indigo-600 rounded-full shadow-lg border border-indigo-400 hover:bg-indigo-500 transition-colors"><ArrowPathIcon className="w-3 h-3 text-white"/></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      {modalSegmentId && (
        <ImageModal 
          isOpen={true} 
          onClose={() => setModalSegmentId(null)} 
          segmentId={modalSegmentId} 
          segmentText={state.segments.find(s=>s.id===modalSegmentId)?.text || ""} 
          onUpdateText={(txt) => setState(p => ({...p, segments: p.segments.map(s => s.id === modalSegmentId ? {...s, text: txt} : s)}))} 
          onRegenerate={() => handleRegenerateSingle(modalSegmentId)} 
          onAnimate={() => handleAnimateSingle(modalSegmentId)}
          onCancel={() => handleCancelSingle(modalSegmentId)}
          isRegenerating={!!(state.segments.find(s=>s.id===modalSegmentId)?.isGenerating)} 
          imageUrl={state.segments.find(s=>s.id===modalSegmentId)?.imageData}
          videoUrl={state.segments.find(s=>s.id===modalSegmentId)?.videoData}
          onRegeneratePrompt={async (id, currentText) => {
            const optimized = await optimizeSinglePrompt(id, currentText, state.referenceImages, getActiveGeminiKey());
            return optimized;
          }}
        />
      )}
    </div>
  );
};

export default App;
