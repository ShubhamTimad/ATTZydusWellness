import CryptoJS from "crypto-js"

export const TAG_CODE_PREFIX = "ZT:"

const DEFAULT_KEY = "9a7c3b8e1f4d2a6e0c5b7f9d1a3e5c7b9a7c3b8e1f4d2a6e0c5b7f9d1a3e5c7b"
const NONCE_STR = "ZYDUS_TAG_NONCE_"

let activeKeyStr = DEFAULT_KEY

export function setTagCryptoKey(key: string) {
  if (key && key.trim()) {
    activeKeyStr = key.trim()
  }
}

function getCipherParams() {
  const keyHex = CryptoJS.SHA256(activeKeyStr).toString().substring(0, 32)
  const key = CryptoJS.enc.Hex.parse(keyHex)
  const iv = CryptoJS.enc.Utf8.parse(NONCE_STR)
  return { key, iv }
}

/**
 * Encrypt an asset code (e.g. Combined Asset Number) directly to a compact tag code.
 * Uses AES-128-CTR with NoPadding to produce an exact-length compact ciphertext without bloat.
 * Example output: "ZT:EHrW1O_96WzgALqN" (19 chars). Does NOT use asset_id.
 */
export function encryptTagCode(plainText: string | null | undefined, _assetId?: number | null): string {
  if (!plainText || !plainText.trim()) return ""
  const { key, iv } = getCipherParams()
  const encrypted = CryptoJS.AES.encrypt(plainText.trim(), key, {
    iv: iv,
    mode: CryptoJS.mode.CTR,
    padding: CryptoJS.pad.NoPadding,
  })
  const b64 = encrypted.toString()
  const b64url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  return `${TAG_CODE_PREFIX}${b64url}`
}

/**
 * Decrypt an encrypted tag code back to the original asset code.
 */
export function decryptTagCode(cipherText: string | null | undefined): string {
  if (!cipherText || !cipherText.trim()) return ""
  let code = cipherText.trim()
  if (code.toUpperCase().startsWith(TAG_CODE_PREFIX.toUpperCase())) {
    code = code.substring(TAG_CODE_PREFIX.length)
  } else if (code.toUpperCase().startsWith("ZT-")) {
    code = code.substring(3)
  }
  let pad = code.replace(/-/g, "+").replace(/_/g, "/")
  while (pad.length % 4) pad += "="
  try {
    const { key, iv } = getCipherParams()
    const decrypted = CryptoJS.AES.decrypt(pad, key, {
      iv: iv,
      mode: CryptoJS.mode.CTR,
      padding: CryptoJS.pad.NoPadding,
    })
    return decrypted.toString(CryptoJS.enc.Utf8).trim()
  } catch {
    return ""
  }
}
