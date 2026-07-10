// ============================================================
// Voice input (Whisper WebSocket) — client-side capture stub
// Captures microphone audio with MediaRecorder in small chunks
// and streams them over a WebSocket to a configurable server
// address (WHISPER_WS_URL in config.js). The Whisper server
// itself lives outside this repo and may not exist yet: every
// failure path here is SILENT — no error is ever shown to the
// client, the voice button is simply hidden and typing remains
// the only input.
//
// Expected wire protocol (for the separate Mac-side server):
//   client -> server  JSON  {"type":"start","language":"en"|"pt","mime_type":"..."}
//   client -> server  binary audio chunks (MediaRecorder blobs, ~250ms)
//   client -> server  JSON  {"type":"stop"}
//   server -> client  JSON  {"type":"transcript","text":"...","final":true|false}
// ============================================================

// Probe the configured server. Resolves true only if a WebSocket
// connection opens within timeoutMs; resolves false on any error,
// timeout, or missing/invalid URL. Never rejects.
export function probeVoiceServer(url, timeoutMs) {
  return new Promise(function (resolve) {
    if (!url || typeof WebSocket === 'undefined') { resolve(false); return; }
    var settled = false;
    var ws = null;

    function settle(ok) {
      if (settled) return;
      settled = true;
      try { if (ws) ws.close(); } catch (e) { /* silent */ }
      resolve(ok);
    }

    var timer = setTimeout(function () { settle(false); }, timeoutMs || 4000);

    try {
      ws = new WebSocket(url);
    } catch (e) {
      clearTimeout(timer);
      settle(false);
      return;
    }
    ws.onopen  = function () { clearTimeout(timer); settle(true); };
    ws.onerror = function () { clearTimeout(timer); settle(false); };
    ws.onclose = function () { clearTimeout(timer); settle(false); };
  });
}

// Create a recorder bound to the configured server.
// opts: { url, language, onTranscript(text, isFinal), onUnavailable() }
// onUnavailable fires on any mid-recording failure so the caller can
// silently hide the voice option.
export function createVoiceRecorder(opts) {
  var _ws = null;
  var _recorder = null;
  var _stream = null;
  var _recording = false;

  function cleanup() {
    _recording = false;
    try { if (_recorder && _recorder.state !== 'inactive') _recorder.stop(); } catch (e) { /* silent */ }
    try {
      if (_stream) {
        var tracks = _stream.getTracks();
        for (var i = 0; i < tracks.length; i++) tracks[i].stop();
      }
    } catch (e) { /* silent */ }
    try { if (_ws && _ws.readyState <= 1) _ws.close(); } catch (e) { /* silent */ }
    _recorder = null;
    _stream = null;
    _ws = null;
  }

  function fail() {
    cleanup();
    if (opts.onUnavailable) opts.onUnavailable();
  }

  async function start() {
    if (_recording) return false;
    if (!opts.url || typeof WebSocket === 'undefined') { fail(); return false; }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      fail();
      return false;
    }

    // 1. Microphone access
    try {
      _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      fail();
      return false;
    }

    // 2. WebSocket to the configured (possibly not-yet-existing) server
    var opened = await new Promise(function (resolve) {
      var settled = false;
      function settle(ok) { if (!settled) { settled = true; resolve(ok); } }
      var timer = setTimeout(function () { settle(false); }, 4000);
      try { _ws = new WebSocket(opts.url); } catch (e) { clearTimeout(timer); settle(false); return; }
      _ws.onopen  = function () { clearTimeout(timer); settle(true); };
      _ws.onerror = function () { clearTimeout(timer); settle(false); };
      _ws.onclose = function () { clearTimeout(timer); settle(false); };
    });
    if (!opened) { fail(); return false; }

    _ws.onmessage = function (event) {
      try {
        var msg = JSON.parse(event.data);
        if (msg && msg.type === 'transcript' && opts.onTranscript) {
          opts.onTranscript(msg.text || '', msg.final === true);
        }
      } catch (e) { /* silent - ignore malformed server messages */ }
    };
    _ws.onerror = fail;
    _ws.onclose = function () { if (_recording) fail(); };

    // 3. Capture audio in small chunks and stream each one
    var mimeType = '';
    var candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(candidates[i])) {
        mimeType = candidates[i];
        break;
      }
    }

    try {
      _recorder = mimeType ? new MediaRecorder(_stream, { mimeType: mimeType }) : new MediaRecorder(_stream);
    } catch (e) {
      fail();
      return false;
    }

    _ws.send(JSON.stringify({ type: 'start', language: opts.language || 'en', mime_type: mimeType }));

    _recorder.ondataavailable = function (event) {
      if (event.data && event.data.size > 0 && _ws && _ws.readyState === 1) {
        try { _ws.send(event.data); } catch (e) { fail(); }
      }
    };
    _recorder.onerror = fail;

    _recorder.start(250); // small chunks every 250ms
    _recording = true;
    return true;
  }

  function stop() {
    if (!_recording) { cleanup(); return; }
    _recording = false;
    try { if (_recorder && _recorder.state !== 'inactive') _recorder.stop(); } catch (e) { /* silent */ }
    try {
      if (_ws && _ws.readyState === 1) _ws.send(JSON.stringify({ type: 'stop' }));
    } catch (e) { /* silent */ }
    // Give the final chunk a moment to flush, then tear down
    setTimeout(cleanup, 600);
  }

  function isRecording() { return _recording; }

  return { start: start, stop: stop, isRecording: isRecording };
}
