import { MockECG } from './mock-ecg.js';
import { breathVolumeAt, ecgPacket, ecgRate, elapsedRun, runLengths } from './simulation.js';
import { joinQuest } from './vendor/atmungsraum/quest-gateway.js';
import { pairPhone } from './vendor/atmungsraum/quest-pairing.js';
import { createMockRecordings } from './mock-recordings.js';
import { mockQuestFetch, randomHex } from './mock-protocol.js';

const endpoint = 'http://192.168.2.48:8766/v1/gateway';
const fingerprint = 'e'.repeat(64);
const setupId = 'a'.repeat(32);
const sensorId = 'b'.repeat(12);
const cycle = 16000;
const phases = ['inhale', 'hold_in', 'exhale', 'hold_out'];
const inputByCommand = {
  calibrate: 'automatic',
  controller: 'controller-state',
  'polar-fixed': 'polar-tilt-fixed',
  'polar-adaptive': 'polar-tilt-adaptive',
};
const polarCommands = new Set(['scan', 'select', 'connect', 'start-ecg', 'start-acc']);

export function createMockQuest() {
  const owner = { serial: 'AUDIT-QUEST', device: randomHex(16), identity_kind: 'app-installation', epoch: '7', native_epoch: '8' };
  const enrollment = { controller: randomHex(16), key: randomHex(32) };
  const source = new MockECG();
  const recordings = createMockRecordings(owner, source);
  const receipts = new Map();
  const access = { v: 1, role: 'active', revision: 0, active_phone: 'Audit-Smartphone' };
  const setup = { g: 1, r: 0, attempt: 0, input: 'automatic', started: null, collectingAt: null };
  const discovery = { state: 'ready', owner, endpoints: [endpoint], pairing: 1 };
  let fixture = 'normal', phase = 'IDLE', condition = 'condition-a', generation = 0, witness = 0;
  let speed = 1, run, sessionGrant, recovery, kioskRevision = 1;
  let connected = true, ecg = true, acc = true, selected = true, scanned = false, polarRevision = 1;

  function setupStatus(now) {
    if (recovery && now >= recovery.due) {
      const { command } = recovery;
      recovery = null;
      setup.g++;
      if (fixture === 'setup-error') fixture = 'normal';
      selectInput(command.op, now);
      saveReceipt(command, 'confirmed', { accepted: true, reason: 'accepted', recovery_generation: setup.g });
    }
    const frames = Math.floor(Math.max(0, now - (setup.started ?? now)));
    const stageIndex = Math.floor((frames % cycle) / (cycle / 4));
    const target = setup.collectingAt === null ? 0 : cycle * 2;
    const completed = target ? Math.max(0, Math.min(target, Math.floor(now - setup.collectingAt))) : 0;
    const collecting = target > completed;
    if (target && !collecting && setup.input === 'automatic') setup.input = 'polar-tilt';
    const playing = setup.started !== null && !recovery;
    const ready = setup.input !== 'automatic' && !recovery;
    const old = fixture === 'old-apk';
    const volume = playing ? Math.min(1, breathVolumeAt(frames - 480) * .95 + .02) : 0;
    return {
      v: 1, g: setup.g, r: setup.r, attempt: setup.attempt, input: setup.input,
      stage: recovery ? 'recovering' : collecting ? completed ? 'calibrating' : 'waiting' : playing ? 'testing' : 'idle',
      phase: phases[stageIndex], position_frames: frames, cycle_frames: cycle, target_frames: target, completed_frames: completed,
      calibration: collecting ? completed ? 'collecting' : 'waiting' : target ? 'ready' : 'idle', failure: '', ready, playing,
      audio_state: playing ? 'playing' : 'paused', audio_generation: setup.g, experiment_elapsed_ms: 0,
      input_phase: !ready ? 'unknown' : ['inhale', 'hold', 'exhale', 'hold'][stageIndex], input_volume01: volume,
      source_clock_ready: true, clock_valid: fixture !== 'setup-error', parked: !playing && !recovery,
      audio_recovery_available: fixture === 'setup-error' && !recovery,
      polar_modes: old ? ['calibrated'] : ['calibrated', 'fixed', 'adaptive'],
      ...(recovery ? { recovery: { id: recovery.command.id, state: 'pending', deadline_ns: 2000000000, target_generation: setup.g + 1 } } : {}),
      ...(old ? {} : { renderer: playing ? { v: 1, progress01: volume, radius_m: 1 + volume, frame: witness,
        render_generation: setup.g, settings_revision: setup.r, observed_ns: String(Math.round(now * 1000000)), age_ns: 0 } : null }),
    };
  }

  function changeRole(role) {
    Object.assign(access, { role, active_phone: role === 'active' ? 'Audit-Smartphone' : '', revision: access.revision + 1 });
  }

  function snapshot(now) {
    const lost = fixture === 'signal-loss';
    const old = fixture === 'old-apk';
    const kioskReady = fixture !== 'kiosk-error';
    witness++;
    const operation = { ARMED: 'start', RUNNING: 'pause', PAUSED: 'resume' }[phase];
    return {
      v: 1, wifi_snapshot: 1, control_mode: 'remote',
      build: { v: 1, packaging_fingerprint: fingerprint },
      p: phase, h: phase === 'IDLE' ? 'vr-preparation' : 'vr-session', g: generation, r: 0,
      c: condition, rec: Boolean(run), ms: run ? Math.floor(elapsedRun(run, now) * 1000) : 0, pending: false,
      participant_arm: 1, recenter: 1, ecg_preview: 1, recordings: 1, live_recording: 1, breath_setup: 1,
      a: ['track-ready', 'track-ready'], scenarios: Object.keys(runLengths),
      pi: { r: true, f: connected && ecg && acc && !lost },
      o: { v: 1, s: 'observed', e: owner.native_epoch, i: String(witness), a: 0, g: generation, r: 0 },
      q: { v: 2, s: sessionGrant, g: generation, o: operation ? [operation] : [] },
      controller_access: { ...access },
      setup: setupStatus(now),
      y: { s: setupId, g: Number(owner.native_epoch), r: polarRevision, p: true, b: true,
        c: connected, a: acc, e: ecg && !lost, sc: false, l: 'enabled', x: selected ? sensorId : '',
        d: scanned ? [sensorId] : [], auto: { v: 1, state: lost || !connected ? 'stopped' : 'ready', retry_ms: 0, reason: '' } },
      ...(fixture === 'no-apk' ? {} : { apk: { v: 1, package_name: 'org.viscereality.atmungsraum.developer',
        version_code: old ? 10 : 11, version_name: old ? '0.2.9-dev' : '0.2.10-dev', build_id: fingerprint } }),
      kiosk: { v: 1, g: kioskRevision, requested: true, effective: kioskReady, retry_available: !kioskReady,
        state: kioskReady ? 'active' : 'interrupted', service: kioskReady ? 'connected' : 'interrupted',
        blocked: '', detail: '' },
    };
  }

  async function finish(now) {
    if (!run || phase === 'SAVING') return;
    phase = 'SAVING';
    const elapsed = elapsedRun(run, now);
    run.elapsed = elapsed;
    run.started = null;
    await recordings.finish(elapsed);
    run = null;
    phase = 'IDLE';
  }

  async function advance(now) {
    if (phase === 'RUNNING' && elapsedRun(run, now) >= run.duration) await finish(now);
  }

  function selectInput(op, now) {
    const elapsed = now - (setup.started ?? now);
    setup.r++;
    setup.input = inputByCommand[op];
    setup.collectingAt = op === 'calibrate' ? now + (Math.ceil(elapsed / cycle) * cycle - elapsed) : null;
    if (op === 'calibrate') setup.attempt++;
    setup.started ??= now;
  }

  function saveReceipt(command, state, fields = {}) {
    const receipt = { v: 1, id: command.id, state, ...fields };
    receipts.set(command.id, receipt);
    return receipt;
  }

  function receipt(id) {
    return receipts.get(id) ?? { v: 1, id, state: 'outcome_unknown', detail: '' };
  }

  function polarAction({ op, s, g, r, d }) {
    if (phase !== 'IDLE' || s !== setupId || String(g) !== owner.native_epoch || r !== polarRevision) return false;
    if (op === 'scan') scanned = true;
    if (op === 'select') {
      if (!scanned || d !== sensorId) return false;
      selected = true;
    }
    if (op === 'connect') {
      if (!selected) return false;
      connected = true;
    }
    if (op === 'start-ecg' || op === 'start-acc') {
      if (!connected) return false;
      if (op === 'start-acc') acc = true;
      else {
        ecg = true;
        if (fixture === 'signal-loss') fixture = 'normal';
      }
    }
    polarRevision++;
    return true;
  }

  async function sessionAction(action, command, now) {
    const { op } = command;
    if (op === 'arm') {
      const { scenario, participant_id } = command;
      if (action !== 'participant-arm' || phase !== 'IDLE' || command.g !== generation
        || typeof participant_id !== 'string' || !participant_id || !Object.hasOwn(runLengths, scenario)
        || !['condition-a', 'condition-b'].includes(command.condition) || fixture === 'signal-loss') return false;
      phase = 'ARMING';
      // The supplied ID is intentionally not retained in any simulated recording.
      await recordings.begin(scenario, command.condition);
      condition = command.condition;
      generation++;
      sessionGrant = randomHex(16);
      run = { duration: runLengths[scenario], speed, elapsed: 0, started: null };
      phase = 'ARMED';
      return true;
    }
    if (op === 'save-next' && run && ['RUNNING', 'PAUSED', 'ARMED'].includes(phase)) {
      await finish(now);
      return true;
    }
    if (!run || command.g !== generation || command.s !== sessionGrant) return false;
    if (op === 'pause' && phase === 'RUNNING') {
      run.elapsed = elapsedRun(run, now);
      run.started = null;
      phase = 'PAUSED';
      return true;
    }
    if ((op === 'start' && phase === 'ARMED' || op === 'resume' && phase === 'PAUSED') && fixture !== 'signal-loss') {
      run.started = now;
      phase = 'RUNNING';
      return true;
    }
    return false;
  }

  async function dispatch(action, command, signal) {
    const now = performance.now();
    await advance(now);
    if (action === 'status') return snapshot(now);
    if (action === 'ecg-preview') {
      if (!connected || !ecg || fixture === 'signal-loss') return { v: 1, samples: [] };
      await source.prepare();
      signal?.throwIfAborted();
      const packet = ecgPacket(source.samples, source.rate, Math.max(0, now - source.epoch), fixture === 'signal-gap');
      return { v: 1, unit: 'uV', rate: ecgRate, age_ms: 0, samples: packet.points.map(({ timestamp, value }) => [String(timestamp), value]) };
    }
    if (action === 'recordings') return recordings.read(command, run ? elapsedRun(run, now) : 0);
    if (!/^[a-f0-9]{16}$/.test(command.id)) return undefined;
    if (action === 'receipt' || command.op === 'receipt' && ['breath-setup', 'kiosk'].includes(action)) return receipt(command.id);
    if (receipts.has(command.id)) return receipt(command.id);
    if (action === 'controller-access') {
      const role = command.op === 'claim' && access.role === 'waiting' ? 'active'
        : command.op === 'release' && access.role === 'active' ? 'waiting' : null;
      if (!role || command.expected_control_revision !== access.revision) return saveReceipt(command, 'rejected');
      changeRole(role);
      return saveReceipt(command, 'confirmed');
    }
    if (access.role !== 'active') return saveReceipt(command, 'rejected', { detail: '' });
    if (action === 'recenter') return saveReceipt(command, command.g === generation ? 'confirmed' : 'rejected');
    if (action === 'kiosk') {
      if (fixture !== 'kiosk-error' || command.g !== kioskRevision) return saveReceipt(command, 'rejected', { detail: '' });
      fixture = 'normal';
      kioskRevision++;
      return saveReceipt(command, 'confirmed', { detail: 'Mock service connected' });
    }
    if (action === 'breath-setup') {
      if (!Object.hasOwn(inputByCommand, command.op) || command.g !== setup.g || command.r !== setup.r || phase !== 'IDLE') {
        return saveReceipt(command, 'rejected');
      }
      if (fixture === 'setup-error') {
        recovery = { command, due: now + 900 };
        return saveReceipt(command, 'pending', { accepted: true, reason: 'audio-recovery-pending', recovery_generation: null });
      }
      selectInput(command.op, now);
      return saveReceipt(command, 'confirmed');
    }
    const accepted = action === 'command' && polarCommands.has(command.op) ? polarAction(command)
      : ['command', 'participant-arm'].includes(action) && await sessionAction(action, command, now);
    return saveReceipt(command, accepted ? 'confirmed' : 'rejected');
  }

  const localFetch = mockQuestFetch({ endpoint, owner, enrollment, dispatch, approved: () => changeRole('active') });
  async function fetcher(...args) {
    if (fixture === 'bridge-off') throw new TypeError('WLAN-Brücke nicht erreichbar.');
    return localFetch(...args);
  }
  async function rediscoverQuest() {
    return fixture === 'bluetooth-off' ? { state: 'bluetooth-off' } : discovery;
  }
  return {
    savedPair: { ...owner, endpoint, enrollment, build: fingerprint },
    services: {
      selectQuest: async () => {
        if (fixture === 'bluetooth-off') throw new DOMException('Bluetooth ist deaktiviert.', 'NotFoundError');
        return { id: 'audit-bluetooth' };
      },
      readQuest: rediscoverQuest,
      rediscoverQuest,
      joinQuest: options => joinQuest({ ...options, fetcher }),
      pairPhone: options => pairPhone({ ...options, fetcher }),
    },
    setFixture(next) {
      fixture = next;
      if (next === 'old-apk' && ['polar-tilt-fixed', 'polar-tilt-adaptive'].includes(setup.input)) {
        setup.input = 'automatic';
        setup.started = setup.collectingAt = null;
        setup.g++;
      }
      if (next === 'polar-off') {
        connected = ecg = acc = selected = scanned = false;
        polarRevision++;
      }
      if (next === 'normal') {
        connected = ecg = acc = selected = true;
        polarRevision++;
      }
    },
    setSpeed(next) { speed = next; },
  };
}
