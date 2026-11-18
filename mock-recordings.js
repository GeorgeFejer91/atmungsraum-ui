import { encode, sha256, toBase64 } from './mock-protocol.js';

const captureSeconds = 80;
const finalSeconds = captureSeconds + 1;
const json = value => encode.encode(JSON.stringify(value) + '\n');
const demoParticipant = 'Dem_30_O';
const csvHeader = 'schema_version,participant_id,session_id,run_index,scenario_id,record_type,timestamp_utc,elapsed_us,'
  + 'audio_elapsed_us,playback_state,audio_phase,sensor_time_ns,sensor_frame_sequence,sensor_sample_index,'
  + 'ecg_uv,acc_x_mg,acc_y_mg,acc_z_mg,render_frame,radius_m,breathing_phase,session_status,end_reason,signal_reason';

function csvRow(record, type, elapsedUs) {
  const row = Array(24).fill('');
  row.splice(0, 8, 4, demoParticipant, record.session_id, record.index, record.scenario, type,
    new Date(record.started + elapsedUs / 1000).toISOString(), elapsedUs);
  return row;
}

export function createMockRecordings(owner, signalSource) {
  const saved = new Map();
  const manifests = new Map();
  let active;
  let lastTimestamp = 0n;
  let sequence = 0;

  async function begin(scenario, condition) {
    await signalSource.prepare();
    const stamp = BigInt(Date.now()) * 1000000n;
    lastTimestamp = stamp > lastTimestamp ? stamp : lastTimestamp + 1n;
    const started = Number(lastTimestamp / 1000000n);
    const record = { id: 'utc-ns-' + String(lastTimestamp).padStart(20, '0'), session_id: crypto.randomUUID(),
      index: ++sequence, started, scenario, condition };
    record.name = demoParticipant + '_' + new Date(started).toISOString().slice(0, 10) + '_' + scenario + '_r' + record.index + '.csv';
    const { samples, rate } = signalSource;
    const rows = [csvHeader];
    for (let index = 0; index < rate * finalSeconds; index++) {
      const row = csvRow(record, 'ecg', Math.floor(index * 1e6 / rate));
      row[14] = Math.round(samples[index % samples.length] * 1000);
      rows.push(row.join(','));
    }
    record.data = encode.encode(rows.join('\r\n') + '\r\n');
    active = record;
  }

  function extent(record, seconds) {
    const count = Math.floor(record.data.length * Math.min(finalSeconds, seconds) / finalSeconds);
    const limit = Math.max(record.data.indexOf(10), Math.min(count, record.data.length - 1));
    return record.data.lastIndexOf(10, limit) + 1;
  }

  async function finish(seconds, completed) {
    const record = active;
    if (!record) return;
    active = null;
    const { id, session_id, name, scenario, condition } = record;
    const files = new Map([
      ['manifest.json', json({ synthetic: true, session_id, scenario, condition })],
      ['final.json', json({ synthetic: true, elapsed_seconds: seconds, completed })],
      ['events.jsonl', json({ event: completed ? 'audio-ended' : 'save-next', synthetic: true })],
      ['polar-acc.jsonl', json({ t: 0, x: 0, y: 0, z: 1000, synthetic: true })],
      ['polar-ecg.jsonl', json({ t: 0, uv: Math.round(signalSource.samples[0] * 1000), synthetic: true })],
      ['polar-hr-rr.jsonl', json({ t: 0, bpm: 70, rr_ms: 857, synthetic: true })],
      ['breath.jsonl', json({ t: 0, phase: 'inhale', synthetic: true })],
      ['radius.jsonl', json({ t: 0, radius_m: 1, synthetic: true })],
    ]);
    const entries = await Promise.all([...files].map(async ([name, data]) => ({ name, size: data.length, sha256: await sha256(data) })));
    const prefix = record.data.subarray(0, extent(record, Math.max(1, seconds)));
    const terminal = csvRow(record, 'end', Math.round(seconds * 1e6));
    terminal[8] = terminal[7];
    terminal[9] = terminal[10] = completed ? 'ended' : 'paused';
    terminal[21] = completed ? 'completed' : 'aborted';
    terminal[22] = completed ? 'completed' : 'save-next';
    const tail = encode.encode(terminal.join(',') + '\r\n');
    const data = new Uint8Array(prefix.length + tail.length);
    data.set(prefix);
    data.set(tail, prefix.length);
    files.set(name, data);
    const participant_csv = { name, session_id, size: data.length, sha256: await sha256(data), schema_version: 4 };
    const manifest = { schema: 'rusty.quest.recording_export.v1', id, device: owner.device, serial: owner.serial,
      saved: true, file_set_policy: 'core8-original-no-checkpoints-or-index', files: entries, participant_csv,
      total_bytes: entries.reduce((sum, file) => sum + file.size, 0) };
    manifest.manifest_id = await sha256(json(manifest));
    saved.set(id, manifest);
    manifests.set(manifest.manifest_id, { files, manifest });
  }

  async function read(query, seconds) {
    const { id, session_id, offset, length, manifest_id, file } = query;
    const record = active;
    switch (query.query) {
      case 'list': {
        const eligible = [...saved.keys()].sort().reverse().filter(id => !query.before || id < query.before);
        const entries = eligible.slice(0, query.limit).map(id => ({ id, exportable: true, participant_csv: true }));
        return { v: 1, state: 'ready', entries, next_before: eligible.length > entries.length ? entries.at(-1).id : null };
      }
      case 'describe':
        return saved.has(id) ? { state: 'ready', manifest: saved.get(id) } : { state: 'missing' };
      case 'live-describe': {
        if (!record) return { v: 1, state: 'preparing' };
        const size = extent(record, Math.min(seconds, captureSeconds));
        return { v: 1, state: 'live', schema_version: 4, id: record.id, session_id: record.session_id,
          name: record.name, size, checkpoint: size, sha256: await sha256(record.data.subarray(0, size)) };
      }
      case 'live-read': {
        if (!record || record.id !== id || record.session_id !== session_id) return { v: 1, state: 'missing' };
        const data = slice(record.data.subarray(0, extent(record, Math.min(seconds, captureSeconds))), offset, length);
        return { v: 1, state: 'live-chunk', id, session_id, offset, length, sha256: await sha256(data), data: toBase64(data) };
      }
      case 'read': {
        const entry = manifests.get(manifest_id);
        const bytes = entry?.files.get(file);
        if (!bytes) return { v: 1, state: 'missing' };
        const data = slice(bytes, offset, length);
        const info = file === entry.manifest.participant_csv.name ? entry.manifest.participant_csv
          : entry.manifest.files.find(value => value.name === file);
        return { v: 1, state: 'chunk', manifest_id, file, offset, length, sha256: info.sha256, data: toBase64(data) };
      }
    }
  }

  return { begin, finish, read };
}

function slice(bytes, offset, length) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length)
    || length < 1 || length > 32768 || offset + length > bytes.length) throw Error('Invalid mock recording range.');
  return bytes.subarray(offset, offset + length);
}
