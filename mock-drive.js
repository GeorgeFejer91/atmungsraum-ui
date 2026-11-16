import { sha256 } from './mock-protocol.js';

const origin = 'https://www.googleapis.com';
const filePath = '/drive/v3/files';
const uploadPath = '/upload/drive/v3/files';
const token = 'at-audit-drive-token';
export const mockDriveAccount = { clientId: '111111-audit.apps.googleusercontent.com', email: 'audit@example.invalid' };

export function createMockDrive() {
  const files = new Map();
  const uploads = new Map();
  let id = 0;
  const library = {
    initTokenClient({ callback, scope }) {
      return { requestAccessToken: () => queueMicrotask(() => callback({ access_token: token, scope, expires_in: 3600 })) };
    },
  };
  const reply = value => Response.json(value);
  const error = status => new Response(null, { status });
  const metadata = ({ body, ...info }) => info;
  const owned = info => ({ ...info, ownedByMe: true, shared: false, trashed: false });
  const incomplete = offset => new Response(null, { headers: {
    'X-HTTP-Status-Code-Override': '308',
    ...(offset ? { Range: 'bytes=0-' + (offset - 1) } : {}),
  } });

  async function fetcher(input, { method, headers, body, signal }) {
    signal.throwIfAborted();
    const url = new URL(input);
    if (url.origin !== origin) return error(404);
    if (headers.get('Authorization') !== 'Bearer ' + token) return error(401);
    const { pathname, searchParams } = url;
    if (method === 'GET' && pathname === '/drive/v3/about') {
      return reply({ user: { emailAddress: mockDriveAccount.email, permissionId: 'audit-drive' } });
    }
    if (method === 'GET' && pathname === filePath + '/generateIds') return reply({ ids: ['audit-file-' + ++id] });
    if (method === 'GET' && pathname.startsWith(filePath + '/')) {
      const entry = files.get(pathname.slice(filePath.length + 1));
      if (!entry) return error(404);
      return searchParams.get('alt') === 'media' ? new Response(entry.body) : reply(metadata(entry));
    }
    if (method === 'POST' && pathname === filePath) {
      const folder = JSON.parse(body);
      if (files.has(folder.id)) return error(409);
      files.set(folder.id, owned(folder));
      return reply(owned(folder));
    }
    if (pathname !== uploadPath) return error(404);
    if (method === 'POST' && searchParams.get('uploadType') === 'resumable') {
      const info = JSON.parse(body);
      if (files.has(info.id)) return error(409);
      if (info.parents?.length !== 1 || !files.has(info.parents[0])) return error(400);
      const uploadId = 'audit-upload-' + ++id;
      uploads.set(uploadId, { info, parts: [], offset: 0, complete: false });
      return new Response(null, { headers: { Location: origin + uploadPath + '?upload_id=' + uploadId } });
    }
    if (method !== 'PUT') return error(405);
    const upload = uploads.get(searchParams.get('upload_id'));
    if (!upload) return error(410);
    if (upload.complete) return reply(metadata(files.get(upload.info.id)));
    const range = headers.get('Content-Range');
    if (range?.startsWith('bytes */')) return incomplete(upload.offset);
    const part = body instanceof Blob ? body : new Blob([body]);
    const interval = /^bytes (\d+)-(\d+)\/(\*|\d+)$/.exec(range);
    if (range && (!interval || Number(interval[1]) !== upload.offset
      || Number(interval[2]) + 1 !== upload.offset + part.size)) return error(400);
    const total = range ? Number(interval[3]) : part.size;
    if (Number.isFinite(total) && upload.offset + part.size > total) return error(400);
    upload.parts.push(part);
    upload.offset += part.size;
    if (upload.offset !== total) return incomplete(upload.offset);
    const file = new Blob(upload.parts, { type: upload.info.mimeType });
    const checksum = await sha256(await file.arrayBuffer());
    const entry = owned({ ...upload.info, size: String(file.size), sha256Checksum: checksum, body: file });
    upload.complete = true;
    upload.parts.length = 0;
    files.set(upload.info.id, entry);
    return new Response(JSON.stringify(metadata(entry)), { status: 201, headers: { 'Content-Type': 'application/json' } });
  }

  return { library, fetcher };
}
