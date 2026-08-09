// ============================================================
// AI Intake Interview — client-facing flow
// Section 0: language (static)  Section 1: preferences (tap)
// Sections 2/3: tasks + problems (conversational)
// Section 4: future/vision behind a click-to-skip gate
// ============================================================

import { requireAuth, getToken } from './auth.js';
import { api } from './api.js';
import { API_BASE } from './config.js';
import { createVoiceRecorder } from './voice.js';

// ---- state ----
var _session   = null;
var _lang      = 'en';
var _prefs     = {};
var _prefIndex = 0;
var _mode      = 'task';   // 'task' | 'problem' | 'future'
var _entryId   = null;
var _autoSpeak = false;
var _sending   = false;
var _voiceAvailable = false;
var _voiceRecorder  = null;
var _voiceSessionId = null;   // session the current recorder is bound to

// ---- bilingual strings for this flow (en / pt only) ----
var I18N = {
  en: {
    pref_progress: 'Question {n} of 4',
    prefs: [
      {
        key: 'format_preference',
        question: 'When you learn something new, what works best for you?',
        options: [
          { value: 'written',  label: 'Written instructions I can read' },
          { value: 'spoken',   label: 'Walk me through it out loud' },
          { value: 'visual',   label: 'Show me pictures or diagrams' },
          { value: 'hands_on', label: 'Let me try it hands-on' }
        ]
      },
      {
        key: 'density_preference',
        question: 'How much information do you like at once?',
        options: [
          { value: 'short_scannable',    label: 'Short and easy to scan' },
          { value: 'everything_at_once', label: 'Give me everything at once' }
        ]
      },
      {
        key: 'data_narrative_preference',
        question: 'When you get updates about your business, what do you prefer?',
        options: [
          { value: 'numbers',            label: 'Numbers and data' },
          { value: 'plain_language',     label: 'Plain language explanations' },
          { value: 'headline_then_data', label: 'The headline first, then the data' }
        ]
      },
      {
        key: 'control_trust_preference',
        question: 'When a system does work for you, how much control do you want?',
        options: [
          { value: 'approve_first',        label: 'I want to approve things first' },
          { value: 'flag_exceptions_only', label: 'Just flag me when something is unusual' },
          { value: 'depends_on_task',      label: 'It depends on the task' }
        ]
      }
    ],
    section_tasks:    'Part 2 of 4 - Your day-to-day tasks',
    section_problems: 'Part 3 of 4 - Problems and frustrations',
    section_future:   'Part 4 of 4 - Where you want to go',
    send:             'Send',
    sending:          'Sending...',
    thinking:         'One moment...',
    placeholder:      'Type your answer here...',
    future_gate_title: 'One last part',
    future_gate_copy:  'This next part is about where you would like the business to go. You can answer a few questions about your vision, or skip it entirely - both are completely fine.',
    future_proceed:    'Let’s talk about it',
    future_skip:       'Skip this part',
    done_title:        'Thank you!',
    done_copy:         'Your answers were saved. Nicole will review everything and design your system from here.',
    done_back:         'Back to Portal',
    error_generic:     'Something went wrong. Your answer was saved - please try again.',
    voice_permission:  'Microphone access was blocked. You can type your answer instead.',
    voice_empty:       'Nothing was heard. Try again, or type your answer.',
    voice_failed:      'Voice input is not available right now. Please type your answer.',
    preview_readonly:  'Preview is read-only. Writing can be enabled from the banner at the bottom of the portal.',
    preview_not_test:  'Preview is read-only for this client. Writing is only possible on a client marked as a test client.'
  },
  pt: {
    pref_progress: 'Pergunta {n} de 4',
    prefs: [
      {
        key: 'format_preference',
        question: 'Quando voce aprende algo novo, o que funciona melhor para voce?',
        options: [
          { value: 'written',  label: 'Instrucoes escritas que eu possa ler' },
          { value: 'spoken',   label: 'Me explique em voz alta' },
          { value: 'visual',   label: 'Me mostre imagens ou diagramas' },
          { value: 'hands_on', label: 'Me deixe tentar na pratica' }
        ]
      },
      {
        key: 'density_preference',
        question: 'Quanta informacao voce gosta de receber de uma vez?',
        options: [
          { value: 'short_scannable',    label: 'Curta e facil de ler por alto' },
          { value: 'everything_at_once', label: 'Tudo de uma vez' }
        ]
      },
      {
        key: 'data_narrative_preference',
        question: 'Quando recebe novidades sobre o seu negocio, o que prefere?',
        options: [
          { value: 'numbers',            label: 'Numeros e dados' },
          { value: 'plain_language',     label: 'Explicacoes em linguagem simples' },
          { value: 'headline_then_data', label: 'Primeiro o resumo, depois os dados' }
        ]
      },
      {
        key: 'control_trust_preference',
        question: 'Quando um sistema faz um trabalho por voce, quanto controle voce quer ter?',
        options: [
          { value: 'approve_first',        label: 'Quero aprovar as coisas antes' },
          { value: 'flag_exceptions_only', label: 'So me avise quando algo for fora do normal' },
          { value: 'depends_on_task',      label: 'Depende da tarefa' }
        ]
      }
    ],
    section_tasks:    'Parte 2 de 4 - Suas tarefas do dia a dia',
    section_problems: 'Parte 3 de 4 - Problemas e frustracoes',
    section_future:   'Parte 4 de 4 - Para onde voce quer ir',
    send:             'Enviar',
    sending:          'Enviando...',
    thinking:         'Um momento...',
    placeholder:      'Escreva sua resposta aqui...',
    future_gate_title: 'Ultima parte',
    future_gate_copy:  'Esta proxima parte e sobre para onde voce gostaria que o negocio fosse. Voce pode responder algumas perguntas sobre a sua visao, ou pular esta parte - as duas opcoes sao perfeitamente ok.',
    future_proceed:    'Vamos falar sobre isso',
    future_skip:       'Pular esta parte',
    done_title:        'Obrigada!',
    done_copy:         'Suas respostas foram salvas. A Nicole vai revisar tudo e desenhar o seu sistema a partir daqui.',
    done_back:         'Voltar ao Portal',
    error_generic:     'Algo deu errado. Sua resposta foi salva - tente novamente.',
    voice_permission:  'O acesso ao microfone foi bloqueado. Voce pode escrever a sua resposta.',
    voice_empty:       'Nao ouvimos nada. Tente de novo, ou escreva a sua resposta.',
    voice_failed:      'A entrada por voz nao esta disponivel agora. Por favor escreva a sua resposta.',
    preview_readonly:  'A pre-visualizacao e somente leitura. A escrita pode ser ativada no banner no rodape do portal.',
    preview_not_test:  'A pre-visualizacao e somente leitura para este cliente. A escrita so e possivel em um cliente marcado como cliente de teste.'
  }
};

function t(key) {
  var dict = I18N[_lang] || I18N.en;
  return dict[key] || key;
}

// An interview is almost entirely writes, so an admin previewing without
// writing enabled will hit the Worker's preview gate on nearly every action.
// Say so plainly in the session language instead of showing a generic error
// that leaves the person guessing which wall they hit.
//
// The Worker returns the two refusals as bilingual text; we map its 403 back
// onto the local strings so the message matches the rest of this screen.
function errorMessage(err) {
  if (err && err.status === 403) {
    var raw = String(err.message || '');
    if (raw.indexOf('test client') !== -1 || raw.indexOf('cliente de teste') !== -1) {
      return t('preview_not_test');
    }
    if (raw.indexOf('read-only') !== -1 || raw.indexOf('somente leitura') !== -1) {
      return t('preview_readonly');
    }
  }
  return (err && err.message) || t('error_generic');
}

// ---- screen switching ----
var SCREENS = ['loading', 'screen-language', 'screen-preferences', 'screen-chat', 'screen-future-gate', 'screen-done'];

function showScreen(id) {
  for (var i = 0; i < SCREENS.length; i++) {
    var el = document.getElementById(SCREENS[i]);
    if (el) {
      if (SCREENS[i] === id) el.classList.remove('hidden');
      else el.classList.add('hidden');
    }
  }
}

// ---- text-to-speech (browser SpeechSynthesis, no third-party service) ----
function speakQuestion(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  var utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = _lang === 'pt' ? 'pt-BR' : 'en-US';
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

// Preview context has to survive the trip back to portal.html, otherwise the
// admin lands on the portal as themselves and loses the preview banner.
// The API calls on this screen inherit preview through the shared api.js
// helper, so no special-case request code is needed here.
function carryPreviewOnPortalLinks() {
  var page = new URLSearchParams(window.location.search);
  var previewAs = page.get('previewAs');
  if (!previewAs) return;

  var query = '?previewAs=' + encodeURIComponent(previewAs);
  var previewWrite = page.get('previewWrite');
  if (previewWrite) query += '&previewWrite=' + encodeURIComponent(previewWrite);

  var ids = ['back-to-portal', 'done-back-btn'];
  for (var i = 0; i < ids.length; i++) {
    var link = document.getElementById(ids[i]);
    if (link) link.setAttribute('href', 'portal.html' + query);
  }
}

// ---- init ----
async function init() {
  var profile = await requireAuth('client');
  if (!profile) return;

  wireStaticButtons();
  carryPreviewOnPortalLinks();
  initVoice();

  try {
    var current = await api.interviewCurrent();
    if (current && current.session) {
      _session = current.session;
      _lang = _session.language || 'en';
      resumeFrom(current);
    } else {
      showScreen('screen-language');
    }
  } catch (err) {
    showScreen('screen-language');
  }
}

function wireStaticButtons() {
  var btnEn = document.getElementById('lang-choice-en');
  var btnPt = document.getElementById('lang-choice-pt');
  if (btnEn) btnEn.addEventListener('click', function () { chooseLanguage('en'); });
  if (btnPt) btnPt.addEventListener('click', function () { chooseLanguage('pt'); });

  var sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) sendBtn.addEventListener('click', sendAnswer);

  var input = document.getElementById('chat-input');
  if (input) {
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAnswer();
      }
    });
  }

  var listenBtn = document.getElementById('listen-btn');
  if (listenBtn) {
    listenBtn.addEventListener('click', function () {
      var q = document.getElementById('chat-question');
      if (q) speakQuestion(q.textContent);
    });
  }

  var proceedBtn = document.getElementById('future-proceed-btn');
  if (proceedBtn) proceedBtn.addEventListener('click', proceedToFuture);
  var skipBtn = document.getElementById('future-skip-btn');
  if (skipBtn) skipBtn.addEventListener('click', skipFuture);
}

// ---- voice input (records locally, transcribed by the Worker) ----
// No server probe: voice is available whenever the browser supports it.
// An unsupported browser simply leaves the button hidden, with no error.
function initVoice() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices ||
      typeof MediaRecorder === 'undefined') {
    return;
  }
  var voiceBtn = document.getElementById('voice-btn');
  if (!voiceBtn) return;
  _voiceAvailable = true;
  voiceBtn.classList.remove('hidden');
  voiceBtn.addEventListener('click', toggleVoice);
}

function voiceStatus(message) {
  var status = document.getElementById('chat-status');
  if (status) status.textContent = message;
}

// The session id is not known when init() runs, so the recorder is built
// on first use and rebuilt whenever the session changes.
function ensureVoiceRecorder() {
  if (!_session || !_session.id) return null;
  if (_voiceRecorder && _voiceSessionId === _session.id) return _voiceRecorder;

  _voiceSessionId = _session.id;
  _voiceRecorder = createVoiceRecorder({
    apiBase: API_BASE,
    sessionId: _session.id,
    getAuthHeader: async function () {
      var token = await getToken();
      return 'Bearer ' + token;
    },
    onTranscript: function (text) {
      // Appended, never auto-sent: the client has to be able to read and
      // correct the transcription before sending it.
      var input = document.getElementById('chat-input');
      if (!input || !text) return;
      input.value = input.value ? input.value + ' ' + text : text;
      input.focus();
    },
    onError: function (reason) {
      if (reason === 'permission') voiceStatus(t('voice_permission'));
      else if (reason === 'empty') voiceStatus(t('voice_empty'));
      else voiceStatus(t('voice_failed'));
    },
    onStateChange: function (state) {
      var btn = document.getElementById('voice-btn');
      if (!btn) return;
      if (state === 'recording') {
        btn.classList.add('intake-icon-btn--recording');
        btn.disabled = false;
        voiceStatus('');
      } else if (state === 'transcribing') {
        btn.classList.remove('intake-icon-btn--recording');
        btn.disabled = true;   // a second tap must not fire mid upload
      } else {
        btn.classList.remove('intake-icon-btn--recording');
        btn.disabled = false;
      }
    }
  });
  return _voiceRecorder;
}

async function toggleVoice() {
  if (!_voiceAvailable) return;
  var recorder = ensureVoiceRecorder();
  if (!recorder) return;

  if (recorder.isRecording()) {
    recorder.stop();
    return;
  }
  await recorder.start();
}

// ---- resume an in-progress session ----
function resumeFrom(current) {
  var prefs = current.preferences;
  var section = _session.current_section;

  if (prefs && prefs.format_preference === 'spoken') _autoSpeak = true;

  if (section === 'language') {
    showScreen('screen-language');
    return;
  }
  if (section === 'preferences') {
    if (prefs) {
      _prefs = {
        format_preference: prefs.format_preference,
        density_preference: prefs.density_preference,
        data_narrative_preference: prefs.data_narrative_preference,
        control_trust_preference: prefs.control_trust_preference
      };
    }
    _prefIndex = firstMissingPref();
    if (_prefIndex >= 4) { startSection('tasks'); return; }
    showPrefScreen();
    return;
  }
  if (section === 'tasks' || section === 'problems') {
    _mode = section === 'tasks' ? 'task' : 'problem';
    _entryId = openEntryIdFrom(current.entries, _mode);
    var lastQ = current.last_question ? current.last_question.content : null;
    if (lastQ) showChat(lastQ);
    else startSection(section);
    return;
  }
  if (section === 'future') {
    if (current.future && !current.future.skipped) {
      _mode = 'future';
      var q = current.last_question && current.last_question.section === 'future'
        ? current.last_question.content : null;
      if (q) showChat(q);
      else showFutureGate();
    } else {
      showFutureGate();
    }
    return;
  }
  showDone();
}

function firstMissingPref() {
  var order = ['format_preference', 'density_preference', 'data_narrative_preference', 'control_trust_preference'];
  for (var i = 0; i < order.length; i++) {
    if (!_prefs[order[i]]) return i;
  }
  return 4;
}

function openEntryIdFrom(entries, mode) {
  if (!entries) return null;
  for (var i = entries.length - 1; i >= 0; i--) {
    if (entries[i].section === mode && entries[i].completeness === 'in_progress') {
      return entries[i].id;
    }
  }
  return null;
}

// ---- section 0: language ----
async function chooseLanguage(language) {
  _lang = language;
  showScreen('loading');
  try {
    var res = await api.interviewCreateSession({ language: language });
    _session = res.session;
    _prefIndex = 0;
    _prefs = {};
    if (res.resumed) {
      var current = await api.interviewCurrent();
      resumeFrom(current);
    } else {
      showPrefScreen();
    }
  } catch (err) {
    alert(errorMessage(err));
    showScreen('screen-language');
  }
}

// ---- section 1: preferences ----
function showPrefScreen() {
  var dict = I18N[_lang] || I18N.en;
  var pref = dict.prefs[_prefIndex];
  if (!pref) { savePrefsAndStart(); return; }

  var progress = document.getElementById('pref-progress');
  if (progress) progress.textContent = dict.pref_progress.replace('{n}', String(_prefIndex + 1));

  var question = document.getElementById('pref-question');
  if (question) question.textContent = pref.question;

  var optionsBox = document.getElementById('pref-options');
  if (optionsBox) {
    optionsBox.innerHTML = '';
    for (var i = 0; i < pref.options.length; i++) {
      (function (opt) {
        var btn = document.createElement('button');
        btn.className = 'intake-option-btn';
        btn.textContent = opt.label;
        btn.addEventListener('click', function () {
          _prefs[pref.key] = opt.value;
          _prefIndex = _prefIndex + 1;
          if (_prefIndex >= 4) savePrefsAndStart();
          else showPrefScreen();
        });
        optionsBox.appendChild(btn);
      })(pref.options[i]);
    }
  }
  showScreen('screen-preferences');
}

async function savePrefsAndStart() {
  showScreen('loading');
  try {
    await api.interviewSavePrefs(_session.id, _prefs);
    if (_prefs.format_preference === 'spoken') _autoSpeak = true;
    await startSection('tasks');
  } catch (err) {
    alert(errorMessage(err));
    _prefIndex = firstMissingPref();
    showPrefScreen();
  }
}

// ---- sections 2/3/4: conversational interview ----
async function startSection(section) {
  showScreen('loading');
  try {
    var res = await api.interviewStartSection(_session.id, { section: section });
    _mode = section === 'tasks' ? 'task' : (section === 'problems' ? 'problem' : 'future');
    _entryId = null;
    showChat(res.question);
  } catch (err) {
    alert(errorMessage(err));
  }
}

function sectionLabel() {
  if (_mode === 'task') return t('section_tasks');
  if (_mode === 'problem') return t('section_problems');
  return t('section_future');
}

function showChat(question) {
  var label = document.getElementById('chat-section-label');
  if (label) label.textContent = sectionLabel();

  var q = document.getElementById('chat-question');
  if (q) q.textContent = question;

  var input = document.getElementById('chat-input');
  if (input) {
    input.placeholder = t('placeholder');
    input.value = '';
  }

  var sendLabel = document.getElementById('chat-send-label');
  if (sendLabel) sendLabel.textContent = t('send');

  var status = document.getElementById('chat-status');
  if (status) status.textContent = '';

  showScreen('screen-chat');
  if (input) input.focus();

  // Auto-play every question as speech if the client chose "spoken";
  // otherwise the listen button is present but not automatic.
  if (_autoSpeak) speakQuestion(question);
}

async function sendAnswer() {
  if (_sending) return;
  var input = document.getElementById('chat-input');
  if (!input) return;
  var answer = input.value.trim();
  if (!answer) return;

  _sending = true;
  var sendBtn = document.getElementById('chat-send-btn');
  var sendLabel = document.getElementById('chat-send-label');
  var status = document.getElementById('chat-status');
  if (sendBtn) sendBtn.disabled = true;
  if (sendLabel) sendLabel.textContent = t('sending');
  if (status) status.textContent = t('thinking');

  try {
    var res;
    if (_mode === 'future') {
      res = await api.interviewFuture(_session.id, { answer: answer });
      handleFutureResponse(res);
    } else {
      res = await api.interviewAnswer(_session.id, {
        section: _mode,
        entry_id: _entryId,
        answer: answer
      });
      handleAnswerResponse(res);
    }
  } catch (err) {
    if (status) status.textContent = errorMessage(err);
  } finally {
    _sending = false;
    if (sendBtn) sendBtn.disabled = false;
    if (sendLabel) sendLabel.textContent = t('send');
  }
}

function handleAnswerResponse(res) {
  if (res.section_complete) {
    if (res.next_section === 'problems') {
      _mode = 'problem';
      _entryId = null;
      showChat(res.question);
    } else {
      // Tasks and problems done - Future gate is a standalone screen,
      // no engine call is made unless the client chooses to proceed.
      showFutureGate();
    }
    return;
  }
  _entryId = res.entry_closed ? null : res.entry_id;
  showChat(res.question);
}

function handleFutureResponse(res) {
  if (res.interview_complete) {
    showDone();
    return;
  }
  showChat(res.question);
}

// ---- section 4 gate ----
function showFutureGate() {
  var title = document.getElementById('future-gate-title');
  var copy = document.getElementById('future-gate-copy');
  var proceed = document.getElementById('future-proceed-btn');
  var skip = document.getElementById('future-skip-btn');
  if (title) title.textContent = t('future_gate_title');
  if (copy) copy.textContent = t('future_gate_copy');
  if (proceed) proceed.textContent = t('future_proceed');
  if (skip) skip.textContent = t('future_skip');
  showScreen('screen-future-gate');
}

async function proceedToFuture() {
  await startSection('future');
}

async function skipFuture() {
  showScreen('loading');
  try {
    await api.interviewFutureSkip(_session.id);
    showDone();
  } catch (err) {
    alert(errorMessage(err));
    showFutureGate();
  }
}

// ---- completion ----
function showDone() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  var title = document.getElementById('done-title');
  var copy = document.getElementById('done-copy');
  var back = document.getElementById('done-back-btn');
  if (title) title.textContent = t('done_title');
  if (copy) copy.textContent = t('done_copy');
  if (back) back.textContent = t('done_back');
  showScreen('screen-done');
}

window.addEventListener('load', function () { init(); });
