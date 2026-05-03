
import { VideoState, SrtSegment, ReferenceImage } from '../types';
import { base64ToBlob, blobUrlToBase64 } from './blobHelpers';

const DB_NAME = 'CineSyncDB';
const STORE_PROJECTS = 'projects';
const STORE_IMAGES = 'images';
const DB_VERSION = 2; 

export const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES);
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
};

export const saveProjectToDB = async (data: Partial<VideoState>) => {
  try {
    const db = await openDB();
    
    // 1. Prepare all assets (images) BEFORE opening the transaction
    const assetsToSave: { key: string, data: any }[] = [];
    
    if (data.segments) {
        for (const seg of data.segments) {
            // Prepare Image
            if (seg.imageData && seg.imageData.length > 100 && seg.imageData !== 'STORED_SEPARATELY') { 
                const rawData = seg.imageData;
                if (rawData.startsWith('data:')) {
                    assetsToSave.push({ key: `img_${seg.id}`, data: base64ToBlob(rawData) });
                } else if (rawData.startsWith('blob:')) {
                    const response = await fetch(rawData);
                    const blob = await response.blob();
                    assetsToSave.push({ key: `img_${seg.id}`, data: blob });
                }
            }
            // Prepare Video
            if (seg.videoData && seg.videoData.length > 100 && seg.videoData !== 'STORED_SEPARATELY') {
                const rawData = seg.videoData;
                if (rawData.startsWith('data:')) {
                    assetsToSave.push({ key: `vid_${seg.id}`, data: base64ToBlob(rawData) });
                } else if (rawData.startsWith('blob:')) {
                    const response = await fetch(rawData);
                    const blob = await response.blob();
                    assetsToSave.push({ key: `vid_${seg.id}`, data: blob });
                }
            }
        }
    }

    // 2. Open transaction and save everything quickly
    const tx = db.transaction([STORE_PROJECTS, STORE_IMAGES], 'readwrite');
    const projectStore = tx.objectStore(STORE_PROJECTS);
    const imagesStore = tx.objectStore(STORE_IMAGES);
    
    const segmentsLite = data.segments?.map(s => ({
       ...s,
       imageData: s.imageData ? 'STORED_SEPARATELY' : undefined,
       videoData: s.videoData ? 'STORED_SEPARATELY' : undefined,
    }));

    const projectData = {
      id: 'current_project',
      segments: segmentsLite,
      referenceImages: data.referenceImages,
      updatedAt: new Date().toISOString()
    };

    projectStore.put(projectData);

    for (const asset of assetsToSave) {
        try {
            imagesStore.put(asset.data, asset.key);
        } catch (e) {
            console.error(`Erro ao salvar asset ${asset.key} no DB`, e);
        }
    }

    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error("Critical DB Save Error:", error);
  }
};

export const loadProjectFromDB = async (): Promise<any> => {
  try {
    const db = await openDB();
    const tx = db.transaction([STORE_PROJECTS, STORE_IMAGES], 'readonly');
    const projectStore = tx.objectStore(STORE_PROJECTS);
    const imagesStore = tx.objectStore(STORE_IMAGES);

    return new Promise((resolve, reject) => {
      const projectRequest = projectStore.get('current_project');

      projectRequest.onsuccess = async () => {
        const projectData = projectRequest.result;

        if (!projectData) {
            resolve(null);
            return;
        }

        if (projectData && projectData.segments) {
            const assetPromises = projectData.segments.map((seg: any) => {
                return new Promise<SrtSegment>(async (resolveSeg) => {
                    let updatedSeg = { ...seg };
                    
                    // Restore Image
                    if (seg.imageData === 'STORED_SEPARATELY') {
                        const imgReq = imagesStore.get(`img_${seg.id}`);
                        await new Promise<void>(r => {
                            imgReq.onsuccess = () => {
                                if (imgReq.result) {
                                  // Always convert stored data to memory-efficient Blob URL
                                  if (imgReq.result instanceof Blob) {
                                    updatedSeg.imageData = URL.createObjectURL(imgReq.result);
                                  } else {
                                    // Handle legacy base64 strings in DB
                                    updatedSeg.imageData = URL.createObjectURL(base64ToBlob(imgReq.result));
                                  }
                                }
                                r();
                            };
                            imgReq.onerror = () => r();
                        });
                    }

                    // Restore Video
                    if (seg.videoData === 'STORED_SEPARATELY') {
                        const vidReq = imagesStore.get(`vid_${seg.id}`);
                        await new Promise<void>(r => {
                            vidReq.onsuccess = () => {
                                if (vidReq.result) {
                                    if (vidReq.result instanceof Blob) {
                                        updatedSeg.videoData = URL.createObjectURL(vidReq.result);
                                    } else {
                                        updatedSeg.videoData = URL.createObjectURL(base64ToBlob(vidReq.result));
                                    }
                                }
                                r();
                            };
                            vidReq.onerror = () => r();
                        });
                    }
                    
                    resolveSeg(updatedSeg);
                });
            });

            Promise.all(assetPromises).then((segmentsWithAssets) => {
                projectData.segments = segmentsWithAssets;
                resolve(projectData);
            }).catch((e) => {
                console.error("Erro ao reconstruir assets:", e);
                resolve(projectData);
            });
        } else {
            resolve(projectData);
        }
      };

      projectRequest.onerror = (e) => reject(projectRequest.error);
    });
  } catch (error) {
    console.error("Failed to load from IndexedDB", error);
    return null;
  }
};

export const cleanupOrphanedImages = async (activeSegmentIds: number[]) => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_IMAGES, 'readwrite');
    const store = tx.objectStore(STORE_IMAGES);
    const activeKeys = new Set([
        ...activeSegmentIds.map(id => `img_${id}`),
        ...activeSegmentIds.map(id => `vid_${id}`),
    ]);

    return new Promise<void>((resolve) => {
      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const key = cursor.key.toString();
          if (!activeKeys.has(key)) {
            console.log(`Limpando imagem órfã: ${key}`);
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  } catch (e) {
    console.error("Erro na limpeza de órfãos:", e);
  }
};

export const clearProjectDB = async () => {
    try {
        const db = await openDB();
        const tx = db.transaction([STORE_PROJECTS, STORE_IMAGES], 'readwrite');
        tx.objectStore(STORE_PROJECTS).delete('current_project');
        tx.objectStore(STORE_IMAGES).clear();
        return new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
    } catch (e) { console.error(e); }
};
