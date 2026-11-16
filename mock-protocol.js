export const encode = new TextEncoder();
const decode = new TextDecoder();
export const toHex = value => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const fromHex = value => Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));
export const toBase64 = value => btoa(String.fromCharCode(...new Uint8Array(value)));
const fromBase64 = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
const base64url = value => toBase64(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const sha256 = async bytes => toHex(await crypto.subtle.digest('SHA-256', bytes));
export const randomHex = length => toHex(crypto.getRandomValues(new Uint8Array(length)));
const invalid = status => Response.json({ error: 'mock-protocol-error' }, { status });
const jsonBytes = value => encode.encode(JSON.stringify(value));
const hmac = (key, value) => crypto.subtle.sign('HMAC', key, encode.encode(value));
const verify = (key, value, signature) => /^[a-f0-9]{64}$/.test(signature)
  && crypto.subtle.verify('HMAC', key, fromHex(signature), encode.encode(value));
const hmacKey = bytes => crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const aesKey = bytes => crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);

async function seal(key, aad, value, asText = toBase64) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encode.encode(aad) }, key, jsonBytes(value));
  return { iv: asText(iv), data: asText(data) };
}

const pairingPrefix = 'RQ-PHONE-PAIR-2';

function pairingHandler(owner, enrollment) {
  let pending;
  return async body => {
    if (body.v !== 2 || body.device !== owner.device || body.epoch !== owner.epoch || body.native_epoch !== owner.native_epoch) {
      return invalid(403);
    }
    if (body.action === 'pair-begin') {
      if (body.serial !== owner.serial || body.identity_kind !== owner.identity_kind
        || typeof body.phone_name !== 'string' || !/^[a-f0-9]{64}$/.test(body.client_commitment)) return invalid(400);
      const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      const reply = { v: 2, device: owner.device, epoch: owner.epoch, native_epoch: owner.native_epoch,
        pairing_id: randomHex(16), client_commitment: body.client_commitment,
        server_public_key: base64url(await crypto.subtle.exportKey('spki', pair.publicKey)),
        server_nonce: base64url(crypto.getRandomValues(new Uint8Array(16))), expires_in_ms: 120000 };
      pending = { body, reply, privateKey: pair.privateKey, expiresAt: performance.now() + reply.expires_in_ms };
      return Response.json(reply);
    }
    if (!pending || body.pairing_id !== pending.reply.pairing_id || performance.now() >= pending.expiresAt) return invalid(404);
    const state = { v: 2, pairing_id: body.pairing_id, state: 'pending' };
    if (body.action === 'pair-reveal') {
      const { reply, privateKey, body: begin } = pending;
      const context = [begin.device, begin.serial, begin.identity_kind, begin.epoch, begin.native_epoch,
        base64url(encode.encode(begin.phone_name))].join('|');
      const commitment = await sha256(encode.encode(pairingPrefix + '/commit|' + context + '|' + body.client_nonce + '|' + body.client_public_key));
      if (commitment !== begin.client_commitment) return invalid(403);
      const transcript = [pairingPrefix, context, reply.pairing_id, begin.client_commitment, body.client_nonce,
        reply.server_nonce, body.client_public_key, reply.server_public_key].join('|');
      const client = await crypto.subtle.importKey('spki', fromBase64(body.client_public_key), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: client }, privateKey, 256);
      const input = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
      const salt = await crypto.subtle.digest('SHA-256', encode.encode(transcript));
      const derive = label => crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt,
        info: encode.encode(pairingPrefix + '/' + label) }, input, 256);
      const proof = await hmacKey(await derive('PROOF'));
      if (!await verify(proof, transcript + '|pair-reveal', body.proof)) return invalid(403);
      Object.assign(pending, { transcript, proof, aead: await aesKey(await derive('AEAD')) });
      return Response.json(state);
    }
    if (!pending.proof || !await verify(pending.proof, pending.transcript + '|' + body.action, body.proof)) return invalid(403);
    if (body.action === 'pair-status') return Response.json(state);
    if (body.action === 'pair-cancel') {
      pending = null;
      return Response.json({ ...state, state: 'cancelled' });
    }
    if (body.action !== 'pair-confirm') return invalid(400);
    const ticket = await seal(pending.aead, pairingPrefix + '/result|' + pending.transcript,
      { v: 2, ...owner, ...enrollment }, base64url);
    pending = null;
    return Response.json({ ...state, state: 'approved', ...ticket });
  };
}

export function mockQuestFetch({ endpoint, owner, enrollment, dispatch, approved }) {
  const pair = pairingHandler(owner, enrollment);
  const { controller, key } = enrollment;
  const signing = hmacKey(encode.encode(key));
  const derived = async label => aesKey(await hmac(await signing, label + '|' + [controller, owner.device, owner.epoch].join('|')));
  const privateKey = derived('RQG1-PRIVATE-KEY');
  const armKey = derived('RQG1-ARM-KEY');
  const nonces = new Set();
  return async (url, request = {}) => {
    request.signal?.throwIfAborted();
    if (url !== endpoint) return invalid(404);
    if (request.method === 'GET') return Response.json({ v: 2, ...owner, enabled: true, remote_available: true });
    if (request.method !== 'POST') return invalid(405);
    const body = JSON.parse(request.body);
    if (body.v === 2 && body.action?.startsWith('pair-')) {
      const response = await pair(body);
      if (body.action === 'pair-confirm' && response.ok) approved();
      return response;
    }
    const { action, nonce, payload, mac } = body;
    const requestAuth = ['RQG1', controller, owner.epoch, nonce, action, payload].join('|');
    if (body.v !== 1 || body.controller !== controller || body.epoch !== owner.epoch || !/^[a-f0-9]{32}$/.test(nonce)
      || typeof payload !== 'string' || !await verify(await signing, requestAuth, mac) || nonces.has(nonce)) return invalid(403);
    nonces.add(nonce);
    const address = [owner.device, owner.epoch, nonce].join('|');
    let content = JSON.parse(payload);
    if (action === 'participant-arm') {
      const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(content.iv),
        additionalData: encode.encode('RQG1-ARM|' + address) }, await armKey, fromBase64(content.data));
      content = JSON.parse(decode.decode(clear));
    }
    request.signal?.throwIfAborted();
    let result = await dispatch(action, content, request.signal);
    if (result === undefined) return invalid(400);
    if (action === 'ecg-preview' || action === 'recordings') {
      result = { v: 1, ...await seal(await privateKey, 'RQG1-PRIVATE|' + action + '|' + address, result) };
    }
    const reply = JSON.stringify(result);
    const replyAuth = ['RQG1-REPLY', controller, owner.device, owner.epoch, nonce, action, reply].join('|');
    request.signal?.throwIfAborted();
    return Response.json({ v: 1, device: owner.device, epoch: owner.epoch, nonce, action,
      payload: reply, mac: toHex(await hmac(await signing, replyAuth)) });
  };
}
