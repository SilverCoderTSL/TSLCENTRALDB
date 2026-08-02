// utils/integrity.js

const SECRET_SALT = "TSL_TACTICAL_MAP_SECURE_KEY_2026";

function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// UTF-8 safe Base64 encoding/decoding
function utf8_to_b64(str) {
  return typeof Buffer !== 'undefined' 
    ? Buffer.from(str, 'utf-8').toString('base64')
    : btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode('0x' + p1)));
}

function b64_to_utf8(str) {
  return typeof Buffer !== 'undefined'
    ? Buffer.from(str, 'base64').toString('utf-8')
    : decodeURIComponent(Array.prototype.map.call(atob(str), c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
}

const TSL_Integrity = {
  generateCode: function (mapPayload) {
    const jsonString = JSON.stringify(mapPayload);
    const checksum = cyrb53(`${jsonString}:${SECRET_SALT}`);
    return utf8_to_b64(`${jsonString}.${checksum}`);
  },

  verifyAndParse: function (codeString, maxW = 2271, maxH = 1133) {
    try {
      const decoded = b64_to_utf8(codeString.trim());
      const lastDot = decoded.lastIndexOf('.');
      if (lastDot === -1) return { valid: false, error: "Missing checksum signature." };

      const jsonString = decoded.slice(0, lastDot);
      const providedChecksum = decoded.slice(lastDot + 1);

      const expectedChecksum = cyrb53(`${jsonString}:${SECRET_SALT}`);
      if (providedChecksum !== expectedChecksum) {
        return { valid: false, error: "Checksum mismatch! Spatial data was manually modified." };
      }

      const data = JSON.parse(jsonString);

      // Hard Boundary Check on Capital Coordinates
      if (data.capital && (data.capital.x > maxW || data.capital.y > maxH)) {
        return { valid: false, error: `Capital coordinates out of bounds (Max: ${maxW}x${maxH}).` };
      }

      return { valid: true, data: data };
    } catch (e) {
      return { valid: false, error: `Malformed code format: ${e.message}` };
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TSL_Integrity;
} else if (typeof window !== 'undefined') {
  window.TSL_Integrity = TSL_Integrity;
}
