// ============================================================
// AI-Driven Adaptive Intake Interview - engine routes
// Data collection only. The model never suggests solutions.
// Every answer is written to D1 immediately on submission.
// ============================================================

import { ApiError, jsonResponse, match, effectiveClientId } from './index.js';

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
// Portuguese here is written properly, WITH diacritics. An earlier build-time
// convention wrote every intake string in plain ASCII; that was a source-code
// style choice carried over from the rest of the intake code, never a decision
// about what a Brazilian client should read. Unaccented Portuguese reads as
// foreign to a native speaker, which is the opposite of what this interview is
// for. Nothing depends on ASCII: the pages declare UTF-8, and the guardrail
// scan strips diacritics itself before matching (see normalizeForScan), so
// accented text is checked exactly the same way.
var OPENERS = {
  tasks_first: {
    en: 'Let us start with your day-to-day work. What is one task you do regularly in your business?',
    pt: 'Vamos começar com o seu dia a dia. Qual é uma tarefa que você faz regularmente no seu negócio?'
  },
  tasks_next: {
    en: 'Thank you. What is another task you handle regularly? If nothing else comes to mind, just say "that is all".',
    pt: 'Obrigada. Qual é outra tarefa que você faz regularmente? Se não lembrar de mais nada, diga apenas "é só isso".'
  },
  problems_first: {
    en: 'Now let us talk about problems. What is one thing in your business that regularly goes wrong, gets stuck, or causes stress?',
    pt: 'Agora vamos falar de problemas. O que no seu negócio costuma dar errado, travar ou causar estresse?'
  },
  problems_next: {
    en: 'Thank you. What is another problem that comes up in your business? If nothing else comes to mind, just say "that is all".',
    pt: 'Obrigada. Qual é outro problema que aparece no seu negócio? Se não lembrar de mais nada, diga apenas "é só isso".'
  },
  future_first: {
    en: 'Where would you like your business to go in the next few years? Describe what you would love it to look like.',
    pt: 'Para onde você gostaria que o seu negócio fosse nos próximos anos? Descreva como você adoraria que ele ficasse.'
  }
};

// Safe fallback follow-up if the model call fails or the guardrail
// rejects the regenerated question too.
var FALLBACK_QUESTION = {
  en: 'Could you tell me more about how you currently do this, step by step?',
  pt: 'Você pode me contar mais sobre como você faz isso hoje, passo a passo?'
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
  if (language === 'pt') {
    prompt += 'Write natural, correctly spelled Brazilian Portuguese WITH full accents and diacritics: ';
    prompt += 'você, não, negócio, situação, é, só, frequência, mês, peça. ';
    prompt += 'Never strip accents. The client is a native speaker, and unaccented Portuguese reads as foreign and careless. ';
  }
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
  if (user.role !== 'admin') {
    if (user.client_id !== session.client_id) throw new ApiError('Forbidden', 403);
    // A session that belongs to a named person is reachable only by that
    // person. Without this, two people at one client could still write into
    // each other's interview by passing a session id directly, which is the
    // same merge the resolution fix prevents, one layer down.
    if (session.user_id != null && user.db_id !== session.user_id) {
      throw new ApiError('Forbidden', 403);
    }
  }
  return session;
}

// Which PERSON is this interview request about.
//
// This is the fix for the merge bug. Resolution used to key on client_id
// alone, so the second person at a client was handed the first person's
// half-finished session and answered into it. It now keys on the person.
//
// For a client caller that is always their own user row: a client can never
// be redirected to somebody else's interview by a query parameter. For an
// admin previewing a client, ?asUser= names WHICH person's session to reach,
// so an admin can open a specific person's interview rather than whichever
// happens to be newest. An admin who names nobody gets null, and callers
// treat that as "no specific person" rather than "anyone".
function effectiveUserId(user, request) {
  if (user.role !== 'admin') return user.db_id;
  var url = new URL(request.url);
  var asUser = url.searchParams.get('asUser');
  return asUser ? parseInt(asUser) : null;
}

// Resolve the in-progress session for one person at one client.
//
// Keyed on (client_id, user_id) together. The client_id term is not
// redundant: it keeps a mis-supplied asUser from reaching a session that
// belongs to a different client entirely.
async function findInProgressSession(env, clientId, userId) {
  if (userId == null) return null;
  return await env.DB.prepare(
    "SELECT * FROM intake_sessions WHERE client_id = ? AND user_id = ? AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1"
  ).bind(clientId, userId).first();
}

// Intake is enabled per PERSON, with the client-level flag as the overall
// on switch for the business. Nicole turns intake on for the client, then
// chooses which people actually take it, so both must be on.
//
// The client flag alone is the wrong grain: it says this business does
// interviews, not who takes one.
async function requireIntakeEnabled(env, clientId, userId) {
  var client = await env.DB.prepare('SELECT intake_enabled FROM clients WHERE id = ?').bind(clientId).first();
  if (!client || client.intake_enabled !== 1) {
    throw new ApiError('The intake interview is not enabled for this client.', 403);
  }
  if (userId == null) throw new ApiError('No portal user linked to this interview.', 403);

  var person = await env.DB.prepare('SELECT intake_enabled FROM users WHERE id = ?').bind(userId).first();
  if (!person || person.intake_enabled !== 1) {
    throw new ApiError('The intake interview is not enabled for this person.', 403);
  }
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
// Translation (admin read path)
//
// Clients answer in Brazilian Portuguese; Nicole reads English. Translation
// happens on READ, in the Worker, never at interview time: a translation that
// turns out wrong stays re-runnable, and the client never waits on a model
// call mid-interview.
//
// One model call per SESSION, not per field. Every field goes out in a single
// structured request, so cost is one call per interview and the model has the
// whole interview as context to translate consistently - the same task
// described in two entries comes back worded the same way.
// ------------------------------------------------------------

// Which fields are worth translating, per structure. Everything else in a row
// (ids, enums, counts, timestamps) is language-neutral and is left alone.
var TRANSLATABLE_ENTRY_FIELDS = ['what', 'how', 'why_trigger', 'time_cost', 'pain_level', 'solution_jump_note'];

function buildTranslationPrompt() {
  var prompt = '';
  prompt += 'You are translating a Brazilian Portuguese business intake interview into English for a consultant to read.\n\n';

  prompt += 'TRANSLATE FAITHFULLY, DO NOT TIDY:\n';
  prompt += 'Keep the client\'s own register and structure. If they wrote a run-on sentence, keep it a run-on sentence. ';
  prompt += 'If they repeated themselves, keep the repetition. If they were vague, stay vague - do not resolve it. ';
  prompt += 'Do not summarise, do not reorder, do not add connecting words to make it flow better, and do not make a rough answer sound polished. ';
  prompt += 'How a person describes their own work is itself information the consultant reads: hesitation, repetition and disorder are signal, not noise to be cleaned up.\n\n';

  prompt += 'DO NOT TRANSLATE PROPER NOUNS:\n';
  prompt += 'Product names, tool names, company names, brand names and place names stay exactly as written. ';
  prompt += 'WhatsApp stays WhatsApp, Excel stays Excel, Correios stays Correios, Instagram stays Instagram. ';
  prompt += 'Never translate them and never localise them to an equivalent product.\n\n';

  prompt += 'OUTPUT:\n';
  prompt += 'You receive a JSON object mapping opaque field keys to Portuguese strings. ';
  prompt += 'Return a JSON object with EXACTLY the same keys, each mapped to its English translation. ';
  prompt += 'Never add keys, never drop keys, and never return a key whose value is not a string. ';
  prompt += 'If a value is already in English, return it unchanged.';

  return prompt;
}

// Flatten one session into { key: portugueseText } so the whole interview
// travels in a single call. Keys encode where each string came from so the
// result can be put back exactly where it belongs.
function collectTranslatableFields(bundle) {
  var fields = {};
  var i, j;

  var entries = bundle.entries || [];
  for (i = 0; i < entries.length; i++) {
    for (j = 0; j < TRANSLATABLE_ENTRY_FIELDS.length; j++) {
      var name = TRANSLATABLE_ENTRY_FIELDS[j];
      var value = entries[i][name];
      if (value) fields['entry.' + entries[i].id + '.' + name] = String(value);
    }
  }

  if (bundle.future && bundle.future.vision_text) {
    fields['future.vision_text'] = String(bundle.future.vision_text);
  }

  var messages = bundle.messages || [];
  for (i = 0; i < messages.length; i++) {
    if (messages[i].content) {
      fields['message.' + messages[i].id + '.content'] = String(messages[i].content);
    }
  }

  return fields;
}

// One structured call for the whole session. Returns null on any failure -
// callers must treat null as "translation unavailable" and still render.
async function callTranslationModel(env, fields) {
  var keys = Object.keys(fields);
  if (!keys.length) return {};
  if (!env.ANTHROPIC_API_KEY) return null;

  // The schema pins the exact key set, so the model cannot drop a field or
  // invent one; a mismatch is retried at the API layer rather than silently
  // producing a half-translated interview.
  var properties = {};
  for (var i = 0; i < keys.length; i++) {
    properties[keys[i]] = { type: 'string' };
  }
  var schema = {
    type: 'object',
    additionalProperties: false,
    properties: properties,
    required: keys
  };

  var body = {
    model: CLAUDE_MODEL,
    max_tokens: 8192,
    system: buildTranslationPrompt(),
    messages: [{ role: 'user', content: JSON.stringify(fields) }],
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: schema }
    }
  };

  var res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.error('[interview] translation request failed:', e);
    return null;
  }

  if (!res.ok) {
    var errText = await res.text().catch(function () { return ''; });
    console.error('[interview] translation API error', res.status, errText.slice(0, 500));
    return null;
  }

  var data = await res.json().catch(function () { return null; });
  if (!data || !data.content) return null;

  var text = '';
  for (var k = 0; k < data.content.length; k++) {
    if (data.content[k].type === 'text') { text += data.content[k].text; }
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('[interview] failed to parse translation JSON:', text.slice(0, 300));
    return null;
  }
}

async function storeTranslation(env, sessionId, payload) {
  await env.DB.prepare(
    'INSERT INTO intake_translations (session_id, payload, model, generated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)' +
    ' ON CONFLICT(session_id) DO UPDATE SET payload = excluded.payload, model = excluded.model, generated_at = CURRENT_TIMESTAMP'
  ).bind(sessionId, JSON.stringify(payload), CLAUDE_MODEL).run();
}

// Read the cached translation for a session, if one exists.
// Returns null when the session has never been translated.
async function getStoredTranslation(env, sessionId) {
  var row = await env.DB.prepare(
    'SELECT payload, model, generated_at FROM intake_translations WHERE session_id = ?'
  ).bind(sessionId).first();
  if (!row) return null;

  var payload;
  try {
    payload = JSON.parse(row.payload);
  } catch (e) {
    // A corrupt cache row must not take down the results page. Treat it as
    // "not translated yet" so Nicole still sees the Portuguese original.
    console.error('[interview] corrupt translation payload for session ' + sessionId);
    return null;
  }
  return { fields: payload, model: row.model, generated_at: row.generated_at };
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
    return handleGetCurrent(env, user, request);
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

  params = match('/api/interview/sessions/:sid/translated', path);
  if (params && method === 'GET') return handleTranslatedSession(params.sid, request, env, user);

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

  // A previewing admin creates the session for the client being previewed.
  // effectiveClientId ignores previewAs entirely for a client caller, so a
  // client session still resolves only to its own client_id.
  var clientId = effectiveClientId(user, request);
  if (user.role === 'admin' && !clientId) clientId = body.client_id;
  if (!clientId) throw new ApiError('client_id required', 400);

  // Whose interview this is. Resuming is scoped to this person, so a second
  // person at the same client starts their OWN session instead of being
  // handed the first person's half-finished one.
  var userId = effectiveUserId(user, request);

  // Intake is enabled per person now, with the client flag as the overall
  // switch. Both must be on. Admins bypass this so previewing still works.
  if (user.role !== 'admin') {
    await requireIntakeEnabled(env, clientId, userId);
  }

  var existing = await findInProgressSession(env, clientId, userId);

  if (existing) {
    // Resume - update language in case the client re-picked it
    await env.DB.prepare(
      'UPDATE intake_sessions SET language = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(language, existing.id).run();
    var resumed = await env.DB.prepare('SELECT * FROM intake_sessions WHERE id = ?').bind(existing.id).first();
    return jsonResponse({ session: resumed, resumed: true }, 200, env);
  }

  var result = await env.DB.prepare(
    "INSERT INTO intake_sessions (client_id, user_id, language, current_section, status) VALUES (?, ?, ?, 'preferences', 'in_progress')"
  ).bind(clientId, userId, language).run();

  var session = await env.DB.prepare('SELECT * FROM intake_sessions WHERE id = ?').bind(result.meta.last_row_id).first();
  return jsonResponse({ session: session, resumed: false }, 201, env);
}

// GET /api/interview/current - resume state for the logged-in client,
// or for the previewed client when an admin is previewing.
async function handleGetCurrent(env, user, request) {
  // effectiveClientId resolves to user.client_id for a client session and is
  // only redirectable by previewAs for an admin caller.
  var clientId = effectiveClientId(user, request);
  if (!clientId) return jsonResponse({ session: null }, 200, null);

  // Keyed on the PERSON, not just their client. This is the query that stops
  // a second person at one client from being handed the first person's
  // in-progress session and answering into it.
  var userId = effectiveUserId(user, request);
  var session = await findInProgressSession(env, clientId, userId);
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

  // whisper-large-v3-turbo takes BASE64, not a byte array. Passing an array
  // fails with a misleading error ("Type mismatch of '/audio', 'string' not in
  // 'array','binary'") that reads as though an array were wanted. Verified
  // 2026-08-09 against real Brazilian Portuguese audio: the array form fails
  // 100% of the time, base64 transcribes correctly. Chunked to stay clear of
  // the argument limit on String.fromCharCode for multi-MB recordings.
  var bytes = new Uint8Array(audioBuffer);
  var binary = '';
  for (var i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  var audioBase64 = btoa(binary);

  var result;
  try {
    result = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio: audioBase64,
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

// GET /api/interview/sessions/:sid/translated?refresh=1 - admin only.
// Returns the same structures the export returns, with English ALONGSIDE
// every Portuguese field rather than replacing it. The original is never
// discarded: Nicole must be able to read the client's own words when a
// translation seems off.
async function handleTranslatedSession(sessionId, request, env, user) {
  if (user.role !== 'admin') throw new ApiError('Forbidden - admin only', 403);

  var session = await env.DB.prepare('SELECT * FROM intake_sessions WHERE id = ?').bind(sessionId).first();
  if (!session) throw new ApiError('Session not found', 404);

  var prefs = await env.DB.prepare('SELECT * FROM intake_preferences WHERE session_id = ?').bind(sessionId).first();
  var entriesRes = await env.DB.prepare('SELECT * FROM intake_entries WHERE session_id = ? ORDER BY created_at ASC').bind(sessionId).all();
  var future = await env.DB.prepare('SELECT * FROM intake_future_vision WHERE session_id = ?').bind(sessionId).first();
  var messagesRes = await env.DB.prepare('SELECT * FROM intake_messages WHERE session_id = ? ORDER BY id ASC').bind(sessionId).all();

  var person = null;
  if (session.user_id != null) {
    person = await env.DB.prepare(
      'SELECT id, email, first_name, last_name, interview_role FROM users WHERE id = ?'
    ).bind(session.user_id).first();
  }

  var bundle = {
    session: session,
    person: person || null,
    preferences: prefs || null,
    entries: entriesRes.results,
    future: future || null,
    messages: messagesRes.results
  };

  // An English interview needs no translation at all: skip the model call
  // entirely rather than paying to translate English into English.
  if (session.language !== 'pt') {
    bundle.translation = null;
    bundle.translation_status = 'not_needed';
    return jsonResponse(bundle, 200, env);
  }

  var url = new URL(request.url);
  var refresh = url.searchParams.get('refresh') === '1';

  if (!refresh) {
    var cached = await getStoredTranslation(env, sessionId);
    if (cached) {
      bundle.translation = cached;
      bundle.translation_status = 'cached';
      return jsonResponse(bundle, 200, env);
    }
  }

  var fields = collectTranslatableFields(bundle);
  var translated = await callTranslationModel(env, fields);

  // A failed translation must never fail the request. Nicole reading
  // Portuguese is far better than Nicole reading an error page.
  if (!translated) {
    var stale = await getStoredTranslation(env, sessionId);
    bundle.translation = stale;
    bundle.translation_status = stale ? 'stale_unavailable' : 'unavailable';
    return jsonResponse(bundle, 200, env);
  }

  await storeTranslation(env, sessionId, translated);
  bundle.translation = await getStoredTranslation(env, sessionId);
  bundle.translation_status = refresh ? 'refreshed' : 'generated';
  return jsonResponse(bundle, 200, env);
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

    // Whose answers these are and what their vantage point was. A session
    // predating the user_id column has no person; that reads as unattributed
    // rather than being quietly assigned to somebody.
    var person = null;
    if (s.user_id != null) {
      person = await env.DB.prepare(
        'SELECT id, email, first_name, last_name, interview_role FROM users WHERE id = ?'
      ).bind(s.user_id).first();
    }

    // The stored translation, if one has been generated. Null means the
    // results page has not translated this session yet.
    var translation = await getStoredTranslation(env, s.id);

    sessions.push({
      session: s,
      person: person || null,
      preferences: prefs || null,
      entries: entriesRes.results,
      future: future || null,
      messages: messagesRes.results,
      translation: translation
    });
  }

  return jsonResponse({ client_id: parseInt(clientId), sessions: sessions }, 200, env);
}
