
/**
 * Utilities to handle large visual assets (Images/Videos) efficiently
 * by converting between Base64 (persistence/transfer format) 
 * and Blob URLs (memory-efficient runtime format).
 */

export const base64ToBlob = (base64: string): Blob => {
  const parts = base64.split(';base64,');
  const contentType = parts[0].split(':')[1];
  const raw = window.atob(parts[1]);
  const rawLength = raw.length;
  const uInt8Array = new Uint8Array(rawLength);

  for (let i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }

  return new Blob([uInt8Array], { type: contentType });
};

export const base64ToBlobUrl = (base64: string): string => {
  if (!base64 || !base64.startsWith('data:')) return base64;
  const blob = base64ToBlob(base64);
  return URL.createObjectURL(blob);
};

export const blobUrlToBase64 = async (blobUrl: string): Promise<string> => {
  if (!blobUrl || !blobUrl.startsWith('blob:')) return blobUrl;
  
  try {
    const response = await fetch(blobUrl);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error("Failed to convert blob URL to base64", e);
    return blobUrl;
  }
};

/**
 * Cleanup helper to avoid memory leaks
 */
export const safeRevokeObjectURL = (url: string | undefined | null) => {
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
};
