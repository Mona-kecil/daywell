export async function downscalePhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 30_000_000) throw new Error("Choose a photo under 30 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => {
      throw new Error("This image format is not supported. Try a JPEG or PNG.");
    });
    const scale = Math.min(
      1,
      1280 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Photo processing is unavailable in this browser.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error("Could not prepare this photo.")),
        "image/jpeg",
        0.82,
      ),
    );
    if (blob.size > 3_000_000)
      throw new Error(
        "Photo is too large after resizing. Please choose another photo.",
      );
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function photoDigest(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return btoa(
    Array.from(new Uint8Array(digest), (byte) =>
      String.fromCharCode(byte),
    ).join(""),
  );
}
