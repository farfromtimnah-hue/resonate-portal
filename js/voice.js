// ============================================================
// Voice input — record locally, upload once, transcribe in the Worker
// The client taps the mic, speaks, and taps again to stop. The whole
// recording is uploaded as a single blob to
//   POST {apiBase}/api/interview/sessions/{sessionId}/transcribe
// which runs Workers AI Whisper and returns { text }. There is no
// WebSocket and no self-hosted server involved.
//
// Every failure path here is non-fatal: typing is always available and
// nothing in this file may ever block the client from continuing.
// ============================================================

// opts: {
//   apiBase, sessionId,
//   getAuthHeader(),                 async, returns the Authorization value
//   onTranscript(text),
//   onError(reason),                 'permission' | 'empty' | 'failed'
//   onStateChange(state)             'recording' | 'transcribing' | 'idle'
// }
export function createVoiceRecorder(opts) {
  var MAX_MS = 120000;      // hard cap per recording
  var MIN_BYTES = 1000;     // anything smaller is silence, not speech

  var _recorder  = null;
  var _stream    = null;
  var _chunks    = [];
  var _mimeType  = '';
  var _recording = false;
  var _timer     = null;

  function emitState(state) {
    if (opts.onStateChange) opts.onStateChange(state);
  }

  function emitError(reason) {
    if (opts.onError) opts.onError(reason);
  }

  function clearTimer() {
    if (_timer) {
      clearTimeout(_timer);
      _timer = null;
    }
  }

  function stopTracks() {
    try {
      if (_stream) {
        var tracks = _stream.getTracks();
        for (var i = 0; i < tracks.length; i++) tracks[i].stop();
      }
    } catch (e) { /* silent */ }
    _stream = null;
  }

  function cleanup() {
    clearTimer();
    _recording = false;
    stopTracks();
    _recorder = null;
  }

  function pickMimeType() {
    var candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    for (var i = 0; i < candidates.length; i++) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported &&
          MediaRecorder.isTypeSupported(candidates[i])) {
        return candidates[i];
      }
    }
    return '';
  }

  async function upload(blob) {
    emitState('transcribing');
    try {
      var auth = await opts.getAuthHeader();
      var url = opts.apiBase + '/api/interview/sessions/' + opts.sessionId + '/transcribe';
      var res = await fetch(url, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Authorization': auth,
          'Content-Type': blob.type || 'application/octet-stream'
        },
        body: blob
      });
      if (!res.ok) {
        emitError('failed');
        return;
      }
      var data = await res.json();
      var text = data && data.text ? data.text : '';
      if (!text) emitError('empty');
      else if (opts.onTranscript) opts.onTranscript(text);
    } catch (e) {
      emitError('failed');
    } finally {
      emitState('idle');
    }
  }

  function handleStop() {
    var blob;
    try {
      blob = new Blob(_chunks, { type: _mimeType || 'application/octet-stream' });
    } catch (e) {
      cleanup();
      emitError('failed');
      emitState('idle');
      return;
    }
    cleanup();

    if (!blob || blob.size < MIN_BYTES) {
      // Treated as silence, not an error: nothing is uploaded.
      emitState('idle');
      return;
    }
    upload(blob);
  }

  async function start() {
    if (_recording) return false;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices ||
        typeof MediaRecorder === 'undefined') {
      return false;
    }

    try {
      _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      _stream = null;
      emitError('permission');
      return false;
    }

    _mimeType = pickMimeType();
    try {
      _recorder = _mimeType
        ? new MediaRecorder(_stream, { mimeType: _mimeType })
        : new MediaRecorder(_stream);
    } catch (e) {
      cleanup();
      emitError('failed');
      return false;
    }
    // A plain MediaRecorder picks its own type; use whatever it chose.
    if (!_mimeType && _recorder.mimeType) _mimeType = _recorder.mimeType;

    _chunks = [];
    _recorder.ondataavailable = function (event) {
      if (event.data && event.data.size > 0) _chunks.push(event.data);
    };
    _recorder.onstop = handleStop;
    _recorder.onerror = function () {
      clearTimer();
      _recording = false;
      stopTracks();
      _recorder = null;
      emitError('failed');
      emitState('idle');
    };

    try {
      _recorder.start();   // no timeslice: one blob at the end
    } catch (e) {
      cleanup();
      emitError('failed');
      return false;
    }

    _recording = true;
    // Hard cap: stop exactly as though the client had tapped stop.
    _timer = setTimeout(function () {
      _timer = null;
      stop();
    }, MAX_MS);

    emitState('recording');
    return true;
  }

  function stop() {
    if (!_recording) return;
    clearTimer();
    _recording = false;
    try {
      if (_recorder && _recorder.state !== 'inactive') _recorder.stop();
    } catch (e) { /* silent - onstop may never fire, cleanup below still runs */ }
    // Microphone indicator must switch off as soon as the client stops.
    stopTracks();
  }

  function isRecording() { return _recording; }

  return { start: start, stop: stop, isRecording: isRecording };
}
