export const MAX_SALARY_SLIP_BYTES = 5 * 1024 * 1024;
export const SALARY_SLIP_ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';
export type SalarySlipContentType = 'application/pdf' | 'image/jpeg' | 'image/png';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function extensionType(fileName: string): SalarySlipContentType | null {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  const extension = match?.[1]?.toLowerCase();
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  return null;
}

function mimeType(file: File): SalarySlipContentType | null {
  const type = file.type.toLowerCase().split(';', 1)[0]?.trim();
  if (type === 'application/pdf' || type === 'image/jpeg' || type === 'image/png') {
    return type;
  }
  return null;
}

export function detectSalarySlipContentType(bytes: Uint8Array): SalarySlipContentType | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-') {
    return 'application/pdf';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

export async function validateSalarySlipClient(file: File): Promise<string | null> {
  if (!file || file.size < 1) return 'Choose a salary-slip file to upload.';
  if (file.size > MAX_SALARY_SLIP_BYTES) {
    return `“${file.name}” is ${formatFileSize(file.size)}. Maximum allowed size is 5 MB.`;
  }

  const byExtension = extensionType(file.name);
  if (!byExtension) {
    return 'Upload a PDF, JPG, or PNG salary slip only.';
  }

  const byMime = mimeType(file);
  if (byMime && byMime !== byExtension) {
    return 'The file type does not match its extension. Choose a valid PDF, JPG, or PNG.';
  }

  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const detected = detectSalarySlipContentType(header);
  if (!detected || detected !== byExtension) {
    return 'File contents failed the security check. The file must be a real PDF, JPG, or PNG.';
  }

  return null;
}

export type SalarySlipUploadResult = {
  id: string;
  fileName: string;
  contentType: SalarySlipContentType;
  sizeBytes: number;
  uploadedAt: string;
};

export function uploadSalarySlipWithProgress(
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<SalarySlipUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/borrower/salary-slip');
    xhr.withCredentials = true;
    xhr.responseType = 'json';

    const abort = () => {
      xhr.abort();
      reject(new Error('Upload cancelled.'));
    };
    signal?.addEventListener('abort', abort, { once: true });

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };

    xhr.onload = () => {
      signal?.removeEventListener('abort', abort);
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve(xhr.response as SalarySlipUploadResult);
        return;
      }
      const data = xhr.response as { error?: string; message?: string } | null;
      reject(
        new Error(
          data?.error || data?.message || `Upload failed (HTTP ${xhr.status}). Please try again.`,
        ),
      );
    };

    xhr.onerror = () => {
      signal?.removeEventListener('abort', abort);
      reject(new Error('Network error while uploading. Check your connection and retry.'));
    };

    xhr.onabort = () => {
      signal?.removeEventListener('abort', abort);
      reject(new Error('Upload cancelled.'));
    };

    const body = new FormData();
    body.append('file', file);
    onProgress(0);
    xhr.send(body);
  });
}
