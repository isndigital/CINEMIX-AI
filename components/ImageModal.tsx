

import React, { useState } from 'react';
import { 
  XMarkIcon, 
  ArrowPathIcon, 
  ArrowDownTrayIcon,
  PhotoIcon,
  SparklesIcon,
  CommandLineIcon,
  BoltIcon,
  FilmIcon
} from '@heroicons/react/24/solid';

interface ImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl?: string;
  videoUrl?: string;
  segmentText: string;
  onUpdateText: (newText: string) => void;
  onRegenerate: () => void;
  onAnimate: () => void;
  onCancel: () => void;
  isRegenerating: boolean;
  segmentId: number;
  onRegeneratePrompt: (segmentId: number, currentPrompt: string) => Promise<string>;
}

const ImageModal: React.FC<ImageModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  videoUrl,
  segmentText,
  onUpdateText,
  onRegenerate,
  onAnimate,
  onCancel,
  isRegenerating,
  segmentId,
  onRegeneratePrompt
}) => {
  const [isPromptRegenerating, setIsPromptRegenerating] = useState(false);

  if (!isOpen) return null;

  const handleDownload = () => {
    const assetUrl = videoUrl || imageUrl;
    if (!assetUrl) return;
    const a = document.createElement('a');
    a.href = assetUrl;
    a.download = `cena_${segmentId.toString().padStart(3, '0')}.${videoUrl ? 'mp4' : 'png'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleRegeneratePrompt = async () => {
    setIsPromptRegenerating(true);
    try {
      const newPrompt = await onRegeneratePrompt(segmentId, segmentText);
      onUpdateText(newPrompt);
    } catch (error) {
      console.error("Erro ao regenerar prompt:", error);
      // Aqui você poderia adicionar um feedback visual de erro para o usuário
    } finally {
      setIsPromptRegenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md p-4 animate-fadeIn">
      <div className="bg-gray-900 rounded-2xl border border-gray-800 shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[95vh]">
        
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-gray-800 bg-gray-900">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600/20 p-2 rounded-lg">
              <PhotoIcon className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-xl font-black text-white tracking-tight">
                Editor de Cena <span className="text-gray-500 text-sm font-medium ml-2">#{segmentId}</span>
              </h3>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-xl text-gray-500 hover:text-white transition-all active:scale-90"
          >
            <XMarkIcon className="w-7 h-7" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-8 flex flex-col lg:flex-row gap-8">
          
          {/* Image Preview Area */}
          <div className="flex-1 flex flex-col gap-4">
            <div className="relative group rounded-2xl overflow-hidden shadow-2xl border border-gray-800 bg-black aspect-video flex items-center justify-center">
               {videoUrl ? (
                   <video 
                     src={videoUrl} 
                     autoPlay 
                     muted 
                     loop 
                     playsInline 
                     className={`w-full h-full object-contain transition-all duration-500 ${isRegenerating ? 'opacity-30 blur-sm' : 'opacity-100'}`}
                   />
               ) : imageUrl ? (
                   <img 
                     src={imageUrl} 
                     alt={`Cena ${segmentId}`} 
                     className={`w-full h-full object-contain transition-all duration-500 ${isRegenerating ? 'opacity-30 scale-95 blur-sm' : 'opacity-100 scale-100'}`}
                   />
               ) : (
                   <div className="flex flex-col items-center gap-3 text-gray-600">
                       <PhotoIcon className="w-16 h-16 opacity-20" />
                       <p className="font-bold text-sm uppercase tracking-widest opacity-40">Sem imagem gerada</p>
                   </div>
               )}

               {isRegenerating && (
                   <div className="absolute inset-0 flex flex-col items-center justify-center bg-indigo-600/10">
                       <div className="relative">
                         <div className="absolute inset-0 bg-indigo-500 blur-2xl opacity-20 animate-pulse"></div>
                         <ArrowPathIcon className="w-20 h-20 text-white animate-spin relative z-10" />
                       </div>
                       <p className="mt-6 text-white font-black text-xl tracking-tighter animate-pulse">GERANDO CENA...</p>
                        <button 
                          onClick={onCancel}
                          className="mt-8 px-8 py-3 bg-red-600 hover:bg-red-500 text-white font-black text-sm uppercase rounded-full shadow-2xl transition-all active:scale-95 z-30 flex items-center gap-2"
                        >
                          <XMarkIcon className="w-5 h-5" />
                          Parar Geração agora
                        </button>
                   </div>
               )}
            </div>
            
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${videoUrl ? 'bg-purple-500' : imageUrl ? 'bg-green-500' : 'bg-yellow-500'}`}></div>
                <span className="text-[10px] font-black uppercase text-gray-500 tracking-widest">
                  Status: {isRegenerating ? 'Gerando...' : videoUrl ? 'Vídeo Pronto' : imageUrl ? 'Imagem Pronta' : 'Pendente'}
                </span>
              </div>
              {(imageUrl || videoUrl) && (
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 text-indigo-400 hover:text-indigo-300 text-[10px] font-black uppercase tracking-widest transition-colors"
                >
                  <ArrowDownTrayIcon className="w-4 h-4" />
                  Salvar em Disco
                </button>
              )}
            </div>
          </div>

          {/* Prompt Editor Area */}
          <div className="w-full lg:w-96 flex flex-col gap-6">
            <div className="flex-1 flex flex-col gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                    <CommandLineIcon className="w-3 h-3" /> Visual Prompt
                  </label>
                  <span className="text-[9px] text-gray-600 font-bold uppercase">{segmentText.length} caracteres</span>
                </div>
                <div className="relative group">
                  <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl blur opacity-10 group-focus-within:opacity-25 transition-opacity"></div>
                  <textarea 
                      value={segmentText}
                      onChange={(e) => onUpdateText(e.target.value)}
                      className="relative w-full bg-black border border-gray-800 rounded-xl p-4 text-gray-200 text-sm leading-relaxed resize-none outline-none focus:border-indigo-500 transition-all h-48 lg:h-64"
                      placeholder="Descreva a cena cinematográfica com detalhes de luz, câmera e ação..."
                  />
                </div>
              </div>

              <div className="space-y-3">
                <button
                   onClick={handleRegeneratePrompt}
                   disabled={isRegenerating || isPromptRegenerating}
                   className="w-full py-4 rounded-xl bg-gray-800 hover:bg-gray-700 text-white font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all border border-gray-700 disabled:opacity-50 group"
                >
                   {isPromptRegenerating ? (
                       <ArrowPathIcon className="w-5 h-5 animate-spin text-indigo-400" />
                   ) : (
                       <SparklesIcon className="w-5 h-5 text-indigo-400 group-hover:scale-110 transition-transform" />
                   )}
                   {isPromptRegenerating ? 'Otimizando...' : 'Otimizar com IA'}
                </button>

                {imageUrl && !videoUrl && (
                  <button
                    onClick={onAnimate}
                    disabled={isRegenerating || isPromptRegenerating}
                    className="w-full py-4 rounded-xl bg-purple-900/40 hover:bg-purple-900/60 text-purple-300 font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all border border-purple-500/30 disabled:opacity-50"
                  >
                    <FilmIcon className="w-5 h-5 text-purple-400" />
                    Animar para Vídeo
                  </button>
                )}

                <button
                   onClick={onRegenerate}
                   disabled={isRegenerating || isPromptRegenerating}
                   className="w-full py-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 transition-all shadow-xl shadow-indigo-900/20 border border-indigo-400 disabled:opacity-50 active:scale-95"
                >
                   {isRegenerating ? (
                       <ArrowPathIcon className="w-6 h-6 animate-spin" />
                   ) : (
                       <BoltIcon className="w-6 h-6" />
                   )}
                   {isRegenerating ? 'Gerando...' : 'Regerar Imagem'}
                </button>
              </div>
            </div>

            <div className="p-4 bg-indigo-500/5 border border-indigo-500/10 rounded-xl">
              <p className="text-[10px] text-indigo-300/60 leading-relaxed italic">
                Dica: Use palavras como "cinematic lighting", "photorealistic" e "highly detailed" para melhores resultados.
              </p>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};

export default ImageModal;
