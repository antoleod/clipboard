export async function readClipboardSnapshot() {
  if (!navigator.clipboard) {
    throw new Error('Clipboard API is not available in this browser.');
  }

  if (navigator.clipboard.read) {
    let clipboardItems = [];
    try {
      clipboardItems = await navigator.clipboard.read();
    } catch {
      // Fallback to text path below for browsers that block read() but allow readText().
    }
    for (const clipboardItem of clipboardItems) {
      const imageType = clipboardItem.types.find((type) => type.startsWith('image/'));
      if (imageType) {
        const blob = await clipboardItem.getType(imageType);
        const dataUrl = await blobToDataUrl(blob);
        return {
          kind: 'image',
          preview: 'Clipboard image',
          content: dataUrl,
          sizeBytes: blob.size,
          mimeType: blob.type,
          source: 'clipboard-read'
        };
      }
    }
  }

  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch {
    throw new Error('Clipboard permission denied. Please enable it in your browser.');
  }

  if (!text) {
    throw new Error('Clipboard is empty or unchanged.');
  }

  return {
    kind: 'text',
    preview: text.slice(0, 120),
    content: text,
    source: 'clipboard-readText'
  };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read clipboard image.'));
    reader.readAsDataURL(blob);
  });
}
