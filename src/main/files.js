'use strict';

// Etapa 6: validação de arquivos enviados (anexos, avatar, ícone do servidor).
// Confere tamanho, tipo declarado E assinatura real dos bytes das imagens; limpa o nome.

const { appError } = require('./rest');

const IMAGE_MIMES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const FILE_MIMES = Object.freeze([
  ...IMAGE_MIMES, 'text/plain', 'application/pdf', 'application/zip', 'application/x-zip-compressed',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'video/mp4', 'video/webm', 'application/json', 'text/csv',
  'application/octet-stream',
]);
const EXT = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' });
const ATTACHMENT_MAX = 8 * 1024 * 1024;
const AVATAR_MAX = 2 * 1024 * 1024;

function isArrayBuffer(v) {
  return Object.prototype.toString.call(v) === '[object ArrayBuffer]';
}

/** ArrayBuffer / TypedArray / Buffer → Uint8Array (ou null). */
function toBytes(data) {
  if (isArrayBuffer(data)) return new Uint8Array(data);
  if (data && ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

/** Tipo real pela assinatura (só imagens); null se não for imagem conhecida. */
function sniffImage(b) {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

/** Largura/altura de PNG, GIF, JPEG e WebP (VP8/VP8L/VP8X); null se não der para ler. */
function imageSize(b, mime) {
  try {
    if (mime === 'image/png' && b.length >= 24) {
      return { width: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, height: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0 };
    }
    if (mime === 'image/gif' && b.length >= 10) return { width: b[6] | b[7] << 8, height: b[8] | b[9] << 8 };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        const len = b[i + 2] << 8 | b[i + 3];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: b[i + 5] << 8 | b[i + 6], width: b[i + 7] << 8 | b[i + 8] };
        }
        if (len < 2) return null;
        i += 2 + len;
      }
      return null;
    }
    if (mime === 'image/webp' && b.length >= 30) {
      const fmt = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (fmt === 'VP8X') return { width: 1 + (b[24] | b[25] << 8 | b[26] << 16), height: 1 + (b[27] | b[28] << 8 | b[29] << 16) };
      if (fmt === 'VP8L') {
        const bits = b[21] | b[22] << 8 | b[23] << 16 | b[24] << 24;
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
      }
      if (fmt === 'VP8 ') return { width: (b[26] | b[27] << 8) & 0x3fff, height: (b[28] | b[29] << 8) & 0x3fff };
    }
  } catch { /* cai no null */ }
  return null;
}

/** Nome seguro: letras, números, ponto, hífen, sublinhado e espaço; sem pastas; até 100 caracteres. */
function safeFileName(name, fallback = 'arquivo') {
  let s = typeof name === 'string' ? name.split(/[\\/]/).pop() : '';
  s = s.normalize('NFC').replace(/[^\p{L}\p{N}._ -]/gu, '_').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+/, '');
  if (!s) s = fallback;
  if (s.length > 100) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : '';
    s = s.slice(0, 100 - ext.length) + ext;
  }
  return s;
}

/**
 * Valida um upload. `kind`: 'attachment' (8 MB, vários tipos) ou 'image' (2 MB, só imagem).
 * Devolve { bytes, mime, name, size, isImage, width?, height?, ext }.
 */
function validateUpload(input, kind = 'attachment') {
  if (!input || typeof input !== 'object') throw appError('invalid_file');
  const bytes = toBytes(input.data);
  if (!bytes || bytes.length === 0) throw appError('invalid_file');
  const max = kind === 'image' ? AVATAR_MAX : ATTACHMENT_MAX;
  if (bytes.length > max) throw appError(kind === 'image' ? 'avatar_too_big' : 'attachment_too_big');
  const declared = typeof input.mime === 'string' ? input.mime.toLowerCase().split(';')[0].trim() : '';
  const real = sniffImage(bytes);
  let mime;
  if (kind === 'image') {
    if (!real || !IMAGE_MIMES.includes(real)) throw appError('invalid_file');
    mime = real;
  } else if (real) {
    mime = real; // imagem: vale a assinatura, não o que foi declarado
  } else {
    if (IMAGE_MIMES.includes(declared)) throw appError('invalid_file'); // diz que é imagem mas não é
    mime = FILE_MIMES.includes(declared) ? declared : 'application/octet-stream';
  }
  const isImage = IMAGE_MIMES.includes(mime);
  const name = safeFileName(input.name, isImage ? `imagem.${EXT[mime]}` : 'arquivo');
  const out = { bytes, mime, name, size: bytes.length, isImage, ext: EXT[mime] || null };
  if (isImage) {
    const dim = imageSize(bytes, mime);
    if (dim && dim.width > 0 && dim.height > 0 && dim.width <= 20000 && dim.height <= 20000) {
      out.width = dim.width;
      out.height = dim.height;
    }
  }
  return out;
}

module.exports = {
  validateUpload, sniffImage, imageSize, safeFileName, toBytes, isArrayBuffer,
  IMAGE_MIMES, FILE_MIMES, ATTACHMENT_MAX, AVATAR_MAX,
};
