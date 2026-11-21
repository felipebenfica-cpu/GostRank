'use strict';

function validPhoto(photo) {
  if (photo === null) return true;
  if (typeof photo !== 'string' || photo.length > 65536 || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(photo)) return false;
  const payload = photo.slice(23);
  try {
    const binary = atob(payload);
    return binary.length >= 5 && binary.charCodeAt(binary.length - 2) === 255
      && binary.charCodeAt(binary.length - 1) === 217 && btoa(binary) === payload;
  } catch { return false; }
}

module.exports = { validPhoto };
