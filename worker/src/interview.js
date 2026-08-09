// ============================================================
// AI-Driven Adaptive Intake Interview - engine routes
// Data collection only. The model never suggests solutions.
// Every answer is written to D1 immediately on submission.
// ============================================================

import { ApiError, jsonResponse, match } from './index.js';

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------

// Sonnet, not Opus. The hard guarantees in this engine are structural, not
// model-dependent: the JSON shape is enforced by structured outputs at the API
// layer, the suggestion-language guardrail is a server-side scan, and the
// follow-up cap, uncertainty skip and section openers are all deterministic
// code. What is left for the model is picking the missing dimension and
// writing one short question in the session language. Decided 2026-08-09;
// the earlier claude-opus-4-8 was a build-time default, never a decision.
var CLAUDE_MODEL = 'claude-sonnet-5';
var MAX_FOLLOWUPS = 2;          // hard cap: 2 follow-up attempts per entry
var MAX_FUTURE_QUESTIONS = 3;   // cap for the future/vision section

var DIMENSIONS = ['what', 'how', 'why_trigger', 'time_cost', 'pain_level'];

// Static section openers (not AI-generated). The AI generates
// follow-ups; openers are deterministic so a failed model call
// can never strand the client between items.
var OPENERS = {
  tasks_first: {
    en: 'Let us start with your day-to-day work. What is one task you do regularly in your business?',
    pt: 'Vamos comecar com o seu dia a dia. Qual e uma tarefa que voce faz regularmente no seu negocio?'
  },
  tasks_next: {
    en: 'Thank you. What is another task you handle regularly? If nothing else comes to mind, just say "that is all".',
    pt: 'Obrigada. Qual e outra tarefa que voce faz regularmente? Se nao lembrar de mais nada, diga apenas "e so isso".'
  },
  problems_first: {
    en: 'Now let us talk about problems. What is one thing in your business that regularly goes wrong, gets stuck, or causes stress?',
    pt: 'Agora vamos falar de problemas. O que no seu negocio costuma dar errado, travar ou causar estresse?'
  },
  problems_next: {
    en: 'Thank you. What is another problem that comes up in your business? If nothing else comes to mind, just say "that is all".',
    pt: 'Obrigada. Qual e outro problema que aparece no seu negocio? Se nao lembrar de mais nada, diga apenas "e so isso".'
  },
  future_first: {
    en: 'Where would you like your business to go in the next few years? Describe what you would love it to look like.',
    pt: 'Para onde voce gostaria que o seu negocio fosse nos proximos anos? Descreva como voce adoraria que ele ficasse.'
  }
};

// Safe fallback follow-up if the model call fails or the guardrail
// rejects the regenerated question too.
var FALLBACK_QUESTION = {
  en: 'Could you tell me more about how you currently do this, step by step?',
  pt: 'Voce pode me contar mais sobre como voce faz isso hoje, passo a passo?'
};

// ------------------------------------------------------------
// Guardrail: suggestion-language scan
// Text is lowercased and stripped of diacritics before matching,
// so the patterns stay plain ASCII.
// ------------------------------------------------------------

var SUGGESTION_PATTERNS = [
  // English
  /\bi can help\b/, /\bi could help\b/, /\bhere'?s how\b/, /\bhere is how\b/,
  /\byou could try\b/, /\byou could use\b/, /\byou should\b/, /\bone option is\b/,
  /\bi suggest\b/, /\bi recommend\b/, /\bhave you considered\b/, /\bhave you tried\b/,
  /\bwhy not try\b/, /\bwhy not use\b/, /\btry using\b/, /\ba tool like\b/,
  /\bwould help you\b/, /\bmight help you\b/,
  // Portuguese (diacritics already stripped)
  /\bposso ajudar\b/, /\bposso te ajudar\b/, /\bveja como\b/, /\baqui esta como\b/,
  /\bvoce poderia tentar\b/, /\bvoce poderia usar\b/, /\bvoce deveria\b/,
  /\buma opcao e\b/, /\buma opcao seria\b/, /\beu sugiro\b/, /\bsugiro\b/,
  /\brecomendo\b/, /\bja pensou em\b/, /\bja tentou\b/, /\bque tal usar\b/,
  /\bque tal tentar\b/, /\bexperimente usar\b/, /\buma ferramenta como\b/,
  /\bpode te ajudar\b/, /\bajudaria voce\b/
];

function normalizeForScan(text) {
  if (!text) return '';
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function containsSuggestionLanguage(text) {
  var normalized = normalizeForScan(text);
  for (var i = 0; i < SUGGESTION_PATTERNS.length; i++) {
    if (SUGGESTION_PATTERNS[i].test(normalized)) return true;
  }
  return false;
}

// ------------------------------------------------------------
// System prompt - sent in full with EVERY call
// ------------------------------------------------------------

function buildSystemPrompt(language, section) {
  var langName = language === 'pt' ? 'Portuguese (Brazilian)' : 'English';

  var prompt = '';
  prompt += 'You are a data-collection interviewer conducting a business intake interview for Resonate Business Systems.\n\n';
  prompt += 'YOUR ROLE - DATA COLLECTION ONLY:\n';
  prompt += 'Your only job is to collect a detailed, accurate inventory of what the business owner currently does and experiences. ';
  prompt += 'You must NEVER suggest solutions, tools, software, fixes, improvements, shortcuts, or ideas of any kind. ';
  prompt += 'You must never say what could be automated, improved, or done differently. ';
  prompt += 'You only ask questions that clarify what currently happens. A separate human consultant will design solutions later from this raw data.\n\n';

  prompt += 'COMPLETENESS RUBRIC - an answer about a task or problem is complete only when all five dimensions are covered:\n';
  prompt += '1. what - what exactly the task or problem is\n';
  prompt += '2. how - how it is currently done or how the problem currently unfolds, step by step\n';
  prompt += '3. why_trigger - why it is done or what triggers it happening\n';
  prompt += '4. time_cost - how much time it takes or costs, and how often\n';
  prompt += '5. pain_level - how the person feels about it (love it, hate it, neutral) plus any roadblock they hit\n\n';

  prompt += 'THE VAGUE-VS-SPECIFIC TEST:\n';
  prompt += 'For each dimension ask yourself: could a stranger do this task using only what was just said, without asking a clarifying question? ';
  prompt += 'If not, that dimension is still vague and needs a follow-up.\n\n';

  prompt += 'EXAMPLES OF VAGUE VS SPECIFIC:\n';
  prompt += 'VAGUE: "I do the invoices." SPECIFIC: "Every Friday I open QuickBooks, pull up the week\'s completed jobs, and create one invoice per client. It takes about two hours and I dread it."\n';
  prompt += 'VAGUE: "I answer customer messages." SPECIFIC: "Every morning I spend about 40 minutes replying to WhatsApp messages from clients, mostly questions about delivery dates, checking each order in a spreadsheet before I reply."\n';
  prompt += 'VAGUE: "Scheduling is a mess." SPECIFIC: "Twice a week a client cancels last minute and I have to call the next three people on my paper waitlist, one by one, until someone takes the slot. It takes an hour each time and I hate it."\n\n';

  if (section === 'future') {
    prompt += 'CURRENT SECTION - FUTURE VISION:\n';
    prompt += 'You are collecting where the client would like the business to go: hopes, growth, what they wish their week looked like. ';
    prompt += 'Ask open questions to draw out the vision. Do not apply the five-dimension rubric strictly here; mark status complete when the client has given a genuine picture of their desired future. ';
    prompt += 'Do not handle overwhelm in any special way in this section, and never suggest what their future should contain.\n\n';
  } else {
    prompt += 'CURRENT SECTION: ' + (section === 'problem' ? 'PROBLEMS - things that go wrong or cause stress.' : 'TASKS - things the client does regularly.') + '\n\n';

    prompt += 'SOLUTION-JUMP HANDLING:\n';
    prompt += 'If the client names a specific tool, app, or fix they want (for example "I need a chatbot" or "I should get an app for this") instead of describing their current process, do NOT accept it as the answer. ';
    prompt += 'Set solution_jump to true, copy their proposed fix verbatim-ish into proposed_fix_text, and generate a redirect question asking them to describe how they currently handle that work today, before any tool. Status must be incomplete.\n\n';

    prompt += 'SCOPE-OVERWHELM HANDLING:\n';
    prompt += 'If the client signals there is too much to list ("there is so much", "where do I even start", a flood of many unspecific items at once), set scope_overwhelm to true and respond by NARROWING the question: ';
    prompt += 'time-box it (for example "just think about yesterday morning - what did you do first?") or category-box it (for example "let us just look at how new customers reach you"). ';
    prompt += 'Never offer to skip, never say it is okay to stop.\n\n';

    prompt += 'GENUINE-UNCERTAINTY DETECTION:\n';
    prompt += 'This is different from vagueness. If the client genuinely does not know the answer ("I honestly have no idea", "I have never measured that") rather than answering imprecisely, set genuine_uncertainty to true. Do not press them further on this item.\n\n';

    prompt += 'END-OF-LIST DETECTION:\n';
    prompt += 'If the client indicates they have no more items to add ("that is all", "nothing else comes to mind"), set client_done to true.\n\n';
  }

  prompt += 'LANGUAGE:\n';
  prompt += 'The interview language is ' + langName + '. Write the question field entirely in ' + langName + '. ';
  prompt += 'Every rule above applies fully and identically regardless of language.\n\n';

  prompt += 'OUTPUT:\n';
  prompt += 'Respond with a single JSON object matching the required schema and nothing else. ';
  prompt += 'The question field must contain exactly one question addressed to the client, with no advice, no suggestions, and no commentary. ';
  prompt += 'In the dimensions object, fill in a short factual summary for each dimension that the conversation so far has genuinely covered, and null for dimensions still missing. ';
  prompt += 'Set status to complete only when all five dimensions pass the stranger test (for the future section, when the vision is genuinely described).';

  return prompt;
}

// JSON schema enforced via structured outputs - the model can only
// return this shape, never free text and never a suggestion field.
var RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    question: { type: 'string' },
    target_dimension: {
      anyOf: [
        { type: 'string', enum: ['what', 'how', 'why_trigger', 'time_cost', 'pain_level'] },
        { type: 'null' }
      ]
    },
    status: { type: 'string', enum: ['incomplete', 'complete'] },
    internal_note: { type: 'string' },
    solution_jump: { type: 'boolean' },
    proposed_fix_text: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    scope_overwhelm: { type: 'boolean' },
    genuine_uncertainty: { type: 'boolean' },
    client_done: { type: 'boolean' },
    dimensions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        what: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        how: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        why_trigger: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        time_cost: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        pain_level: { anyOf: [{ type: 'string' }, { type: 'null' }] }
      },
      required: ['what', 'how', 'why_trigger', 'time_cost', 'pain_level']
    }
  },
  required: ['question', 'target_dimension', 'status', 'internal_note',
             'solution_jump', 'proposed_fix_text', 'scope_overwhelm',
             'genuine_uncertainty', 'client_done', 'dimensions']
};

// ------------------------------------------------------------
// Model call (Claude API via fetch) + deterministic mock
// ------------------------------------------------------------

async function callInterviewModel(env, systemPrompt, messages, mockAnswer, attempt) {
  if (!env.ANTHROPIC_API_KEY) {
    if (mockAnswer !== null) {
      return mockInterviewModel(mockAnswer, attempt);
    }
    throw new ApiError('Interview engine not configured (missing ANTHROPIC_API_KEY)', 503);
  }

  var body = {
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: RESPONSE_SCHEMA }
    }
  };

  var res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    var errText = await res.text().catch(function () { return ''; });
    console.error('[interview] Claude API error', res.status, errText.slice(0, 500));
    return null;
  }

  var data = await res.json().catch(function () { return null; });
  if (!data || !data.content) return null;

  var text = '';
  for (var i = 0; i < data.content.length; i++) {
    if (data.content[i].type === 'text') { text += data.content[i].text; }
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('[interview] failed to parse model JSON:', text.slice(0, 300));
    return null;
  }
}

// Deterministic mock used ONLY when no API key is configured AND the
// request carries the X-Interview-Mock header. Lets the full server
// pipeline (guardrail, hard cap, solution jump, immediate writes) be
// tested end to end before the real key exists.
function mockInterviewModel(answer, attempt) {
  var base = {
    question: 'How do you currently handle that, step by step?',
    target_dimension: 'how',
    status: 'incomplete',
    internal_note: 'mock',
    solution_jump: false,
    proposed_fix_text: null,
    scope_overwhelm: false,
    genuine_uncertainty: false,
    client_done: false,
    dimensions: { what: null, how: null, why_trigger: null, time_cost: null, pain_level: null }
  };

  if (answer.indexOf('MOCK_SUGGEST') !== -1 && attempt === 0) {
    base.question = 'You could try keeping a checklist - what happens next?';
    return base;
  }
  if (answer.indexOf('MOCK_TOOL') !== -1) {
    base.solution_jump = true;
    base.proposed_fix_text = answer;
    base.question = 'Before any tool - how do you handle this work today?';
    return base;
  }
  if (answer.indexOf('MOCK_OVERWHELM') !== -1) {
    base.scope_overwhelm = true;
    base.question = 'Let us narrow it down: just think about yesterday morning - what did you do first?';
    return base;
  }
  if (answer.indexOf('MOCK_UNSURE') !== -1) {
    base.genuine_uncertainty = true;
    return base;
  }
  if (answer.indexOf('MOCK_DONE') !== -1) {
    base.client_done = true;
    return base;
  }
  if (answer.indexOf('MOCK_COMPLETE') !== -1) {
    base.status = 'complete';
    base.target_dimension = null;
    base.dimensions = {
      what: 'mock what', how: 'mock how', why_trigger: 'mock why',
      time_cost: 'mock time', pain_level: 'mock pain'
    };
    return base;
  }
  return base;
}

// Guardrail wrapper: scan the generated question for suggestion
// language; discard and regenerate once, logging when it happens.
// If the regenerated question is also flagged (or the call fails),
// fall back to a static safe question.
async function generateGuardedQuestion(env, session, section, convo, mockAnswer) {
  var systemPrompt = buildSystemPrompt(session.language, section);
  var result = await callInterviewModel(env, systemPrompt, convo, mockAnswer, 0);

  if (result && containsSuggestionLanguage(result.question)) {
    console.log('[interview] guardrail triggered on session ' + session.id +
                ' - discarding question: ' + result.question.slice(0, 200));
    var retrySystem = systemPrompt +
      '\n\nIMPORTANT: Your previous question contained suggestion language, which is forbidden. ' +
      'Regenerate the question asking only about the client\'s current reality, with zero advice or suggestions.';
    var retry = await callInterviewModel(env, retrySystem, convo, mockAnswer, 1);
    if (retry && !containsSuggestionLanguage(retry.question)) {
      result = retry;
    } else {
      console.log('[interview] guardrail regeneration also failed on session ' + session.id +
                  ' - using static fallback question');
      if (retry) { result = retry; }
      result.question = FALLBACK_QUESTION[session.language] || FALLBACK_QUESTION.en;
    }
  }

  if (!result) {
    result = {
      question: FALLBACK_QUESTION[session.language] || FALLBACK_QUESTION.en,
      target_dimension: 'how',
      status: 'incomplete',
      internal_note: 'model call failed - static fallback',
      solution_jump: false,
      proposed_fix_text: null,
      scope_overwhelm: false,
      genuine_uncertainty: false,
      client_done: false,
      dimensions: { what: null, how: null, why_trigger: null, time_cost: null, pain_level: null }
    };
  }
  return result;
}

// ------------------------------------------------------------
// DB helpers
// ------------------------------------------------------------

async function getSessionForUser(env, user, sessionId) {
  var session = await env.DB.prepare('SELECT * FROM intake_sessions WHERE id = ?').bind(sessionId).first();
  if (!session) throw new ApiError('Session not found', 404);
  if (user.role !== 'admin' && user.client_id !== session.client_id) {
    throw new ApiError('Forbidden', 403);
  }
  return session;
}

async function touchSession(env, sessionId) {
  await env.DB.prepare('UPDATE intake_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(sessionId).run();
}

async function logMessage(env, sessionId, entryId, role, content, targetDimension, section) {
  await env.DB.prepare(
    'INSERT INTO intake_messages (session_id, entry_id, role, content, target_dimension, section) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(sessionId, entryId, role, content, targetDimension || null, section || null).run();
}

function opener(section, language, isFirst) {
  var key;
  if (section === 'task') key = isFirst ? 'tasks_first' : 'tasks_next';
  else if (section === 'problem') key = isFirst ? 'problems_first' : 'problems_next';
  else key = 'future_first';
  var entry = OPENERS[key];
  return entry[language] || entry.en;
}

async function saveDimensions(env, entry, dims) {
  if (!dims) return;
  await env.DB.prepare(
    'UPDATE intake_entries SET what = ?, how = ?, why_trigger = ?, time_cost = ?, pain_level = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(
    dims.what != null ? dims.what : entry.what,
    dims.how != null ? dims.how : entry.how,
    dims.why_trigger != null ? dims.why_trigger : entry.why_trigger,
    dims.time_cost != null ? dims.time_cost : entry.time_cost,
    dims.pain_level != null ? dims.pain_level : entry.pain_level,
    entry.id
  ).run();
}

// ------------------------------------------------------------
// Route dispatcher - called from index.js router
// Returns a Response, or null if the path is not an interview route.
// ------------------------------------------------------------

export async function routeInterview(request, env, user, url, method, path) {
  var params;

  if (method === 'POST' && path === '/api/interview/sessions') {
    return handleCreateSession(request, env, user);
  }
  if (method === 'GET' && path === '/api/interview/current') {
    return handleGetCurrent(env, user);
  }

  params = match('/api/interview/sessions/:sid', path);
  if (params && method === 'PUT') return handleUpdateSession(params.sid, request, env, user);

  params = match('/api/interview/sessions/:sid/preferences', path);
  if (params && method === 'PUT') return handleSavePreferences(params.sid, request, env, user);

  params = match('/api/interview/sessions/:sid/start', path);
  if (params && method === 'POST') return handleStartSection(params.sid, request, env, user);

  params = match('/api/interview/sessions/:sid/answer', path);
  if (params && method === 'POST') return handleAnswer(params.sid, request, env, user);

  params = match('/api/interview/sessions/:sid/transcribe', path);
  if (params && method === 'POST') return handleTranscribe(params.sid, request, env, user);

  params = match('/api/interview/sessions/:sid/future', path);
  if (params && method === 'POST') return handleFutureAnswer(params.sid, request, env, user);

  params = match('/api/interview/sessions/:sid/future/skip', path);
  if (params && method === 'POST') return handleFutureSkip(params.sid, request, env, user);

  params = match('/api/interview/clients/:cid/export', path);
  if (params && method === 'GET') return handleExport(params.cid, env, user);

  return null;
}

// ------------------------------------------------------------
// Handlers
// ------------------------------------------------------------

// POST /api/interview/sessions  { language: 'en' | 'pt' }
// Creates a session (or resumes the existing in-progress one).
async function handleCreateSession(request, env, user) {
  if (user.role !== 'admin' && !user.client_id) throw new ApiError('No client account linked', 403);
  var body = await request.json();
  var language = body.language;
  if (language !== 'en' && language !== 'pt') throw new ApiError('language must be en or pt', 400);

  var clientId = user.role === 'admin' ? body.client_id : user.client_id;
  if (!clientId) throw new ApiError('client_id required', 400);

  var existing = await env.DB.prepare(
    "SELECT * FROM intake_sessions WHERE client_id = ? AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1"
  ).bind(clientId).first();

  if (existing) {
    // Resume - update language in case the client re-picked it
    await env.DB.prepare(
      'UPDATE intake_sessions SET language = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(language, existing.id).run();
    var resumed = await env.DB.prepare('SELECT * FROM intake_sessions WHERE id = ?').bind(existing.id).first();
    return jsonResponse({ session: resumed, resumed: true }, 200, env);
  }

  var result = await env.DB.prepare(
    "INSERT INTO intake_sessions (client_id, language, current_section, status) VALUES (?, ?, 'preferences', 'in_progress')"
  ).bind(clientId, language).run();

  var session = await env.DB.prepare('SELECT * FROM intake_sessions WHERE id = ?').bind(result.meta.last_row_id).first();
  return jsonResponse({ session: session, resumed: false }, 201, env);
}

// GET /api/interview/current - resume state for the logged-in client
async function handleGetCurrent(env, user) {
  if (!user.client_id) return jsonResponse({ session: null }, 200, null);

  var session = await env.DB.prepare(
    "SELECT * FROM intake_sessions WHERE client_id = ? AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1"
  ).bind(user.client_id).first();
  if (!session) return jsonResponse({ session: null }, 200, null);

  var prefs = await env.DB.prepare('SELECT * FROM intake_preferences WHERE session_id = ?').bind(session.id).first();
  var entriesRes = await env.DB.prepare('SELECT * FROM intake_entries WHERE session_id = ? ORDER BY created_at ASC').bind(session.id).all();
  var future = await env.DB.prepare('SELECT * FROM intake_future_vision WHERE session_id = ?').bind(session.id).first();
  var lastQuestion = await env.DB.prepare(
    "SELECT * FROM intake_messages WHERE session_id = ? AND role = 'question' ORDER BY id DESC LIMIT 1"
  ).bind(session.id).first();

  return jsonResponse({
    session: session,
    preferences: prefs || null,
    entries: entriesRes.results,
    future: future || null,
    last_question: lastQuestion || null
  }, 200, null);
}

// PUT /api/interview/sessions/:sid  { current_section?, status? }
async function handleUpdateSession(sessionId, request, env, user) {
  var session = await getSessionForUser(env, user, sessionId);
  var body = await request.json();
  var section = body.current_section;
  var status = body.status;

  var validSections = ['language', 'preferences', 'tasks', 'problems', 'future', 'complete'];
  var validStatuses = ['in_progress', 'completed', 'abandoned'];
  if (section && validSections.indexOf(section) === -1) throw new ApiError('Invalid section', 400);
  if (status && validStatuses.indexOf(status) === -1) throw new ApiError('Invalid status', 400);

  await env.DB.prepare(
    'UPDATE intake_sessions SET current_section = ?, status = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(
    section || session.current_section,
    status || session.status,
    status === 'completed' ? new Date().toISOString() : session.completed_at,
    sessionId
  ).run();

  var updated = await env.DB.prepare('SELECT * FROM intake_sessions WHERE id = ?').bind(sessionId).first();
  return jsonResponse(updated, 200, env);
}

// PUT /api/interview/sessions/:sid/preferences  { four answers }
async function handleSavePreferences(sessionId, request, env, user) {
  var session = await getSessionForUser(env, user, sessionId);
  var body = await request.json();

  var valid = {
    format_preference: ['written', 'spoken', 'visual', 'hands_on'],
    density_preference: ['short_scannable', 'everything_at_once'],
    data_narrative_preference: ['numbers', 'plain_language', 'headline_then_data'],
    control_trust_preference: ['approve_first', 'flag_exceptions_only', 'depends_on_task']
  };
  var fields = Object.keys(valid);
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (body[f] != null && valid[f].indexOf(body[f]) === -1) {
      throw new ApiError('Invalid value for ' + f, 400);
    }
  }

  var existing = await env.DB.prepare('SELECT * FROM intake_preferences WHERE session_id = ?').bind(sessionId).first();
  if (existing) {
    await env.DB.prepare(
      'UPDATE intake_preferences SET format_preference = ?, density_preference = ?, data_narrative_preference = ?, control_trust_preference = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?'
    ).bind(
      body.format_preference != null ? body.format_preference : existing.format_preference,
      body.density_preference != null ? body.density_preference : existing.density_preference,
      body.data_narrative_preference != null ? body.data_narrative_preference : existing.data_narrative_preference,
      body.control_trust_preference != null ? body.control_trust_preference : existing.control_trust_preference,
      sessionId
    ).run();
  } else {
    await env.DB.prepare(
      'INSERT INTO intake_preferences (session_id, format_preference, density_preference, data_narrative_preference, control_trust_preference) VALUES (?, ?, ?, ?, ?)'
    ).bind(
      sessionId,
      body.format_preference || null,
      body.density_preference || null,
      body.data_narrative_preference || null,
      body.control_trust_preference || null
    ).run();
  }
  await touchSession(env, sessionId);

  var prefs = await env.DB.prepare('SELECT * FROM intake_preferences WHERE session_id = ?').bind(sessionId).first();
  return jsonResponse(prefs, 200, env);
}

// POST /api/interview/sessions/:sid/start  { section: 'tasks'|'problems'|'future' }
// Marks the section current and returns the static opener question.
async function handleStartSection(sessionId, request, env, user) {
  var session = await getSessionForUser(env, user, sessionId);
  var body = await request.json();
  var section = body.section;
  if (['tasks', 'problems', 'future'].indexOf(section) === -1) throw new ApiError('Invalid section', 400);

  await env.DB.prepare(
    'UPDATE intake_sessions SET current_section = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(section, sessionId).run();

  var entrySection = section === 'tasks' ? 'task' : (section === 'problems' ? 'problem' : 'future');
  var question = opener(entrySection, session.language, true);
  await logMessage(env, sessionId, null, 'question', question, null, entrySection);

  return jsonResponse({ question: question, section: section }, 200, env);
}

// POST /api/interview/sessions/:sid/answer
// { section: 'task'|'problem', entry_id: number|null, answer: string }
// The interview engine for the Tasks and Problems sections.
async function handleAnswer(sessionId, request, env, user) {
  var session = await getSessionForUser(env, user, sessionId);
  if (session.status !== 'in_progress') throw new ApiError('Session is not in progress', 400);

  var body = await request.json();
  var section = body.section;
  var answerText = (body.answer || '').trim();
  if (section !== 'task' && section !== 'problem') throw new ApiError('section must be task or problem', 400);
  if (!answerText) throw new ApiError('answer is required', 400);

  // Get or create the entry for this answer
  var entry = null;
  var entryIsNew = false;
  if (body.entry_id) {
    entry = await env.DB.prepare('SELECT * FROM intake_entries WHERE id = ? AND session_id = ?').bind(body.entry_id, sessionId).first();
    if (!entry) throw new ApiError('Entry not found', 404);
  } else {
    var ins = await env.DB.prepare(
      "INSERT INTO intake_entries (session_id, section, completeness) VALUES (?, ?, 'in_progress')"
    ).bind(sessionId, section).run();
    entry = await env.DB.prepare('SELECT * FROM intake_entries WHERE id = ?').bind(ins.meta.last_row_id).first();
    entryIsNew = true;
  }

  // Write the answer to D1 IMMEDIATELY, before any model call
  await logMessage(env, sessionId, entry.id, 'answer', answerText, null, section);
  await touchSession(env, sessionId);

  // Build the conversation for this entry (all questions + answers so far)
  var msgsRes = await env.DB.prepare(
    'SELECT role, content FROM intake_messages WHERE session_id = ? AND (entry_id = ? OR (entry_id IS NULL AND ? = 1)) ORDER BY id ASC'
  ).bind(sessionId, entry.id, entryIsNew ? 1 : 0).all();

  var convo = [];
  var rows = msgsRes.results;
  // Only keep the tail of the conversation relevant to this entry
  for (var i = Math.max(0, rows.length - 12); i < rows.length; i++) {
    convo.push({
      role: rows[i].role === 'question' ? 'assistant' : 'user',
      content: rows[i].content
    });
  }
  if (convo.length === 0 || convo[convo.length - 1].role !== 'user') {
    convo.push({ role: 'user', content: answerText });
  }

  var allowMock = !env.ANTHROPIC_API_KEY && request.headers.get('X-Interview-Mock') === '1';
  var result = await generateGuardedQuestion(env, session, section, convo, allowMock ? answerText : null);

  // ---- Server-side decision logic ----

  // Client says the list is done -> close out and advance the section
  if (result.client_done) {
    if (entryIsNew) {
      // The entry was a placeholder created for the "that is all" answer - remove it
      await env.DB.prepare('DELETE FROM intake_entries WHERE id = ?').bind(entry.id).run();
    }
    var nextSection = section === 'task' ? 'problems' : 'future';
    await env.DB.prepare(
      'UPDATE intake_sessions SET current_section = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(nextSection, sessionId).run();

    var response = { section_complete: true, next_section: nextSection, entry_id: null, question: null };
    if (nextSection === 'problems') {
      response.question = opener('problem', session.language, true);
      await logMessage(env, sessionId, null, 'question', response.question, null, 'problem');
    }
    // For 'future' the frontend shows the click-to-skip gate; no engine call here.
    return jsonResponse(response, 200, env);
  }

  // Save any dimensions the model extracted
  await saveDimensions(env, entry, result.dimensions);

  // Genuine uncertainty -> stop follow-ups immediately, mark skipped
  if (result.genuine_uncertainty) {
    await env.DB.prepare(
      "UPDATE intake_entries SET completeness = 'skipped', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(entry.id).run();
    var q1 = opener(section, session.language, false);
    await logMessage(env, sessionId, null, 'question', q1, null, section);
    return jsonResponse({
      entry_id: null, entry_closed: true, entry_status: 'skipped',
      question: q1, target_dimension: null, section_complete: false
    }, 200, env);
  }

  // Solution jump -> store the proposed fix separately, never accept as the answer
  if (result.solution_jump && result.proposed_fix_text) {
    var existingNote = entry.solution_jump_note;
    var note = existingNote ? existingNote + '\n---\n' + result.proposed_fix_text : result.proposed_fix_text;
    await env.DB.prepare(
      'UPDATE intake_entries SET solution_jump_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(note, entry.id).run();
    result.status = 'incomplete'; // a solution jump can never complete an entry
  }

  // Complete -> close the entry, move to the next item
  if (result.status === 'complete') {
    await env.DB.prepare(
      "UPDATE intake_entries SET completeness = 'complete', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(entry.id).run();
    var q2 = opener(section, session.language, false);
    await logMessage(env, sessionId, null, 'question', q2, null, section);
    return jsonResponse({
      entry_id: null, entry_closed: true, entry_status: 'complete',
      question: q2, target_dimension: null, section_complete: false
    }, 200, env);
  }

  // Incomplete -> enforce the hard cap (max 2 follow-up attempts per entry,
  // tracked server-side; on the 3rd attempt mark incomplete-needs-review and advance)
  if (entry.followup_count >= MAX_FOLLOWUPS) {
    await env.DB.prepare(
      "UPDATE intake_entries SET completeness = 'incomplete_needs_review', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(entry.id).run();
    var q3 = opener(section, session.language, false);
    await logMessage(env, sessionId, null, 'question', q3, null, section);
    return jsonResponse({
      entry_id: null, entry_closed: true, entry_status: 'incomplete_needs_review',
      question: q3, target_dimension: null, section_complete: false
    }, 200, env);
  }

  await env.DB.prepare(
    'UPDATE intake_entries SET followup_count = followup_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(entry.id).run();
  await logMessage(env, sessionId, entry.id, 'question', result.question, result.target_dimension, section);

  return jsonResponse({
    entry_id: entry.id, entry_closed: false, entry_status: 'in_progress',
    question: result.question, target_dimension: result.target_dimension,
    scope_overwhelm: result.scope_overwhelm === true,
    solution_jump: result.solution_jump === true,
    section_complete: false
  }, 200, env);
}

// POST /api/interview/sessions/:sid/transcribe
// Body is raw audio bytes (Content-Type is the recorder mime type), not JSON
// and not multipart. Transcribes with Workers AI Whisper and returns the text;
// nothing is written to D1 - the text becomes the client's answer and the
// normal answer flow persists it.
async function handleTranscribe(sessionId, request, env, user) {
  var session = await getSessionForUser(env, user, sessionId);

  var audioBuffer = await request.arrayBuffer();
  if (!audioBuffer || audioBuffer.byteLength < 1000) throw new ApiError('No audio received', 400);
  if (audioBuffer.byteLength > 20000000) throw new ApiError('Audio too long', 413);

  // Language always follows the session row, never a global default: English
  // and Portuguese clients use this endpoint at the same time.
  var langCode = session.language === 'pt' ? 'pt' : 'en';

  var result;
  try {
    result = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio: [].slice.call(new Uint8Array(audioBuffer)),
      task: 'transcribe',
      // Explicit language stops autodetect flipping when a Portuguese speaker
      // says an English brand name mid sentence.
      language: langCode,
      vad_filter: true,
      // Prevents hallucination loops that repeat a phrase on quiet audio.
      condition_on_previous_text: false
    });
  } catch (e) {
    throw new ApiError('Transcription failed', 502);
  }

  var text = result && result.text ? String(result.text).trim() : '';
  // Silence is a normal outcome, not an error.
  return jsonResponse({ text: text }, 200, env);
}

// POST /api/interview/sessions/:sid/future  { answer }
// Future/Vision section: no overwhelm handling, no solution-jump logic.
async function handleFutureAnswer(sessionId, request, env, user) {
  var session = await getSessionForUser(env, user, sessionId);
  if (session.status !== 'in_progress') throw new ApiError('Session is not in progress', 400);

  var body = await request.json();
  var answerText = (body.answer || '').trim();
  if (!answerText) throw new ApiError('answer is required', 400);

  // Ensure the future_vision row exists
  var future = await env.DB.prepare('SELECT * FROM intake_future_vision WHERE session_id = ?').bind(sessionId).first();
  if (!future) {
    await env.DB.prepare(
      "INSERT INTO intake_future_vision (session_id, skipped, completeness) VALUES (?, 0, 'in_progress')"
    ).bind(sessionId).run();
    future = await env.DB.prepare('SELECT * FROM intake_future_vision WHERE session_id = ?').bind(sessionId).first();
  }
  if (future.skipped) throw new ApiError('Future section was skipped', 400);

  // Immediate writes: message log + accumulated vision text
  await logMessage(env, sessionId, null, 'answer', answerText, null, 'future');
  var visionText = future.vision_text ? future.vision_text + '\n\n' + answerText : answerText;
  await env.DB.prepare(
    'UPDATE intake_future_vision SET vision_text = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?'
  ).bind(visionText, sessionId).run();
  await touchSession(env, sessionId);

  // Count questions already asked in this section (cap)
  var countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM intake_messages WHERE session_id = ? AND role = 'question' AND section = 'future'"
  ).bind(sessionId).first();
  var questionsAsked = countRow ? countRow.n : 0;

  var msgsRes = await env.DB.prepare(
    "SELECT role, content FROM intake_messages WHERE session_id = ? AND section = 'future' ORDER BY id ASC"
  ).bind(sessionId).all();
  var convo = [];
  for (var i = 0; i < msgsRes.results.length; i++) {
    convo.push({
      role: msgsRes.results[i].role === 'question' ? 'assistant' : 'user',
      content: msgsRes.results[i].content
    });
  }
  if (convo.length === 0 || convo[convo.length - 1].role !== 'user') {
    convo.push({ role: 'user', content: answerText });
  }

  var allowMock = !env.ANTHROPIC_API_KEY && request.headers.get('X-Interview-Mock') === '1';
  var result = await generateGuardedQuestion(env, session, 'future', convo, allowMock ? answerText : null);

  var done = result.status === 'complete' || questionsAsked >= MAX_FUTURE_QUESTIONS;
  if (done) {
    var completeness = result.status === 'complete' ? 'complete' : 'incomplete_needs_review';
    await env.DB.prepare(
      'UPDATE intake_future_vision SET completeness = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?'
    ).bind(completeness, sessionId).run();
    await env.DB.prepare(
      "UPDATE intake_sessions SET current_section = 'complete', status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(sessionId).run();
    return jsonResponse({ section_complete: true, interview_complete: true, question: null }, 200, env);
  }

  await logMessage(env, sessionId, null, 'question', result.question, result.target_dimension, 'future');
  return jsonResponse({
    section_complete: false, interview_complete: false, question: result.question
  }, 200, env);
}

// POST /api/interview/sessions/:sid/future/skip
// The upfront click-to-skip gate: no engine call at all.
async function handleFutureSkip(sessionId, request, env, user) {
  var session = await getSessionForUser(env, user, sessionId);

  var future = await env.DB.prepare('SELECT * FROM intake_future_vision WHERE session_id = ?').bind(sessionId).first();
  if (future) {
    await env.DB.prepare(
      "UPDATE intake_future_vision SET skipped = 1, completeness = 'skipped', updated_at = CURRENT_TIMESTAMP WHERE session_id = ?"
    ).bind(sessionId).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO intake_future_vision (session_id, skipped, completeness) VALUES (?, 1, 'skipped')"
    ).bind(sessionId).run();
  }

  await env.DB.prepare(
    "UPDATE intake_sessions SET current_section = 'complete', status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).bind(sessionId).run();

  return jsonResponse({ skipped: true, interview_complete: true }, 200, env);
}

// GET /api/interview/clients/:cid/export - raw structured data for review (admin only)
async function handleExport(clientId, env, user) {
  if (user.role !== 'admin') throw new ApiError('Forbidden - admin only', 403);

  var sessionsRes = await env.DB.prepare(
    'SELECT * FROM intake_sessions WHERE client_id = ? ORDER BY created_at DESC'
  ).bind(clientId).all();

  var sessions = [];
  for (var i = 0; i < sessionsRes.results.length; i++) {
    var s = sessionsRes.results[i];
    var prefs = await env.DB.prepare('SELECT * FROM intake_preferences WHERE session_id = ?').bind(s.id).first();
    var entriesRes = await env.DB.prepare('SELECT * FROM intake_entries WHERE session_id = ? ORDER BY created_at ASC').bind(s.id).all();
    var future = await env.DB.prepare('SELECT * FROM intake_future_vision WHERE session_id = ?').bind(s.id).first();
    var messagesRes = await env.DB.prepare('SELECT * FROM intake_messages WHERE session_id = ? ORDER BY id ASC').bind(s.id).all();
    sessions.push({
      session: s,
      preferences: prefs || null,
      entries: entriesRes.results,
      future: future || null,
      messages: messagesRes.results
    });
  }

  return jsonResponse({ client_id: parseInt(clientId), sessions: sessions }, 200, env);
}
