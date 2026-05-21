// ============================================================
// Translation system
// Usage:  import { t, setLang, getLang } from './t.js';
//         t('login_title')  →  returns string for current lang
//         setLang('pt')     →  switches language and re-renders [data-i18n] elements
// ============================================================

const STRINGS = {
  en: {
    // Brand
    brand:                   'Resonate Business Systems',
    tagline:                 'An impact that ripples throughout',

    // Auth
    sign_in:                 'Sign In',
    sign_out:                'Sign Out',
    email:                   'Email address',
    password:                'Password',
    signing_in:              'Signing in…',
    login_error:             'Incorrect email or password. Please try again.',

    // Nav
    nav_dashboard:           'Dashboard',
    nav_archive:             'Archive',
    nav_new_client:          'New Client',

    // Dashboard
    active_clients:          'Active Clients',
    all_clients:             'All Clients',
    search_clients:          'Search clients…',
    filter_status:           'Filter by status',
    filter_lang:             'Filter by language',
    all_statuses:            'All statuses',
    all_languages:           'All languages',
    no_clients:              'No clients yet. Create your first client.',
    no_clients_search:       'No clients match your search.',
    last_updated:            'Updated',
    active_projects:         'active',
    completed_projects:      'done',
    language_en:             'English',
    language_pt:             'Portuguese',

    // Client detail — sections
    section_contact:         'Contact',
    section_progress:        'Progress Overview',
    section_projects:        'Projects',
    section_comments:        'Messages',
    section_future:          'Coming Up',
    section_notes:           'Private Notes',
    section_links:           'Internal Links',
    section_portal_access:   'Portal Access',
    section_history:         'Status History',

    // Client detail — actions
    edit_client:             'Edit Client',
    add_project:             'Add Project',
    add_note:                'Add Note',
    add_link:                'Add Link',
    archive_client:          'Archive Client',
    restore_client:          'Restore Client',
    back_to_dashboard:       '← Dashboard',
    back_to_archive:         '← Archive',

    // Project card
    project_status:          'Status',
    project_links:           'Links',
    project_due:             'Due',
    project_description:     'Description',
    project_future:          'Coming Up',
    edit_project:            'Edit',
    delete_project:          'Delete',
    client_visible:          'Visible to client',
    admin_only:              'Admin only',
    no_projects:             'No projects yet.',

    // Comments
    your_message:            'Your message',
    send_message:            'Send',
    reply:                   'Reply',
    delete_comment:          'Delete',
    no_comments:             'No messages yet.',
    admin_sender:            'Resonate',

    // Forms — client
    form_name:               'Contact name',
    form_business:           'Business name',
    form_overall_status:     'Overall status',
    form_language:           'Language preference',
    form_phone:              'Phone',
    form_whatsapp:           'WhatsApp',
    form_email:              'Email',
    form_website:            'Website',
    form_address:            'Address',
    form_contact_notes:      'Other contact info',
    save:                    'Save',
    cancel:                  'Cancel',
    saving:                  'Saving…',
    delete:                  'Delete',
    confirm_delete:          'Are you sure? This cannot be undone.',
    confirm_archive:         'Archive this client? They will move to the Archive tab. All data is preserved.',
    confirm_restore:         'Restore this client to active?',

    // Forms — project
    form_title:              'Project title',
    form_desc_en:            'Description (English)',
    form_desc_pt:            'Description (Portuguese)',
    form_future_en:          'Coming up (English)',
    form_future_pt:          'Coming up (Portuguese)',
    form_link_type:          'Link label',
    form_urls:               'URL(s) — one per line',
    form_due_date:           'Due date (optional)',
    form_client_visible:     'Visible to client',

    // Forms — link
    form_link_label:         'Link label',
    form_link_url:           'URL',
    form_link_type_field:    'Type',
    form_link_client_visible:'Show to client',

    // Status labels
    status_not_started:       'Not Started',
    status_in_progress:       'In Progress',
    status_waiting_on_client: 'Waiting on Client',
    status_v1_done:           'Version 1 Done',
    status_updates_in_progress: 'Updates in Progress',
    status_completed:         'Completed',
    status_active:            'Active',
    status_archived:          'Archived',

    // Link type labels
    link_live_site:           'Live Site',
    link_staging:             'Staging',
    link_test:                'Test Link',
    link_github_repo:         'GitHub Repo',
    link_github_project:      'GitHub Project',
    link_cloudflare:          'Cloudflare',
    link_admin:               'Admin Page',
    link_dashboard:           'Dashboard',
    link_automation:          'Automation Flow',
    link_other:               'Link',

    // Portal
    portal_title:             'Your Project Portal',
    portal_status_heading:    'Project Status',
    portal_contact_heading:   'Get in Touch',
    portal_call:              'Call',
    portal_whatsapp:          'WhatsApp',
    portal_email:             'Email',
    portal_website:           'Website',
    portal_message_us:        'Send a Message',
    portal_no_projects:       'Your projects will appear here once work begins.',
    portal_no_comments:       'No messages yet. Send us a message below.',

    // Archive
    archive_title:            'Archive',
    archive_empty:            'No archived clients.',
    archive_search:           'Search archived clients…',
    archived_on:              'Archived',
    total_projects:           'projects',

    // Users
    portal_access:            'Portal Access',
    linked_user:              'Client login',
    no_linked_user:           'No portal login set up',
    add_portal_access:        'Add Portal Access',
    firebase_uid:             'Firebase UID',
    remove_access:            'Remove Access',

    // Misc
    all_complete_notice:      'All projects are complete. Ready to archive?',
    loading:                  'Loading…',
    error_generic:            'Something went wrong. Please try again.',
  },

  pt: {
    brand:                   'Resonate Business Systems',
    tagline:                 'Um impacto que ressoa por toda parte',

    sign_in:                 'Entrar',
    sign_out:                'Sair',
    email:                   'Endereço de e-mail',
    password:                'Senha',
    signing_in:              'Entrando…',
    login_error:             'E-mail ou senha incorretos. Tente novamente.',

    nav_dashboard:           'Painel',
    nav_archive:             'Arquivo',
    nav_new_client:          'Novo Cliente',

    active_clients:          'Clientes Ativos',
    all_clients:             'Todos os Clientes',
    search_clients:          'Buscar clientes…',
    filter_status:           'Filtrar por status',
    filter_lang:             'Filtrar por idioma',
    all_statuses:            'Todos os status',
    all_languages:           'Todos os idiomas',
    no_clients:              'Nenhum cliente ainda. Crie seu primeiro cliente.',
    no_clients_search:       'Nenhum cliente corresponde à sua busca.',
    last_updated:            'Atualizado',
    active_projects:         'ativo',
    completed_projects:      'concluído',
    language_en:             'Inglês',
    language_pt:             'Português',

    section_contact:         'Contato',
    section_progress:        'Visão Geral do Progresso',
    section_projects:        'Projetos',
    section_comments:        'Mensagens',
    section_future:          'Em Breve',
    section_notes:           'Notas Privadas',
    section_links:           'Links Internos',
    section_portal_access:   'Acesso ao Portal',
    section_history:         'Histórico de Status',

    edit_client:             'Editar Cliente',
    add_project:             'Adicionar Projeto',
    add_note:                'Adicionar Nota',
    add_link:                'Adicionar Link',
    archive_client:          'Arquivar Cliente',
    restore_client:          'Restaurar Cliente',
    back_to_dashboard:       '← Painel',
    back_to_archive:         '← Arquivo',

    project_status:          'Status',
    project_links:           'Links',
    project_due:             'Prazo',
    project_description:     'Descrição',
    project_future:          'Em Breve',
    edit_project:            'Editar',
    delete_project:          'Excluir',
    client_visible:          'Visível para o cliente',
    admin_only:              'Apenas admin',
    no_projects:             'Nenhum projeto ainda.',

    your_message:            'Sua mensagem',
    send_message:            'Enviar',
    reply:                   'Responder',
    delete_comment:          'Excluir',
    no_comments:             'Nenhuma mensagem ainda.',
    admin_sender:            'Resonate',

    form_name:               'Nome do contato',
    form_business:           'Nome da empresa',
    form_overall_status:     'Status geral',
    form_language:           'Idioma preferido',
    form_phone:              'Telefone',
    form_whatsapp:           'WhatsApp',
    form_email:              'E-mail',
    form_website:            'Site',
    form_address:            'Endereço',
    form_contact_notes:      'Outras informações de contato',
    save:                    'Salvar',
    cancel:                  'Cancelar',
    saving:                  'Salvando…',
    delete:                  'Excluir',
    confirm_delete:          'Tem certeza? Isso não pode ser desfeito.',
    confirm_archive:         'Arquivar este cliente? Ele será movido para a aba Arquivo. Todos os dados serão preservados.',
    confirm_restore:         'Restaurar este cliente como ativo?',

    form_title:              'Título do projeto',
    form_desc_en:            'Descrição (Inglês)',
    form_desc_pt:            'Descrição (Português)',
    form_future_en:          'Em breve (Inglês)',
    form_future_pt:          'Em breve (Português)',
    form_link_type:          'Rótulo do link',
    form_urls:               'URL(s) — um por linha',
    form_due_date:           'Prazo (opcional)',
    form_client_visible:     'Visível para o cliente',

    form_link_label:         'Rótulo do link',
    form_link_url:           'URL',
    form_link_type_field:    'Tipo',
    form_link_client_visible:'Mostrar ao cliente',

    status_not_started:       'Não iniciado',
    status_in_progress:       'Em andamento',
    status_waiting_on_client: 'Aguardando cliente',
    status_v1_done:           'Versão 1 concluída',
    status_updates_in_progress: 'Atualizações em andamento',
    status_completed:         'Concluído',
    status_active:            'Ativo',
    status_archived:          'Arquivado',

    link_live_site:           'Site ao Vivo',
    link_staging:             'Staging',
    link_test:                'Link de Teste',
    link_github_repo:         'Repositório GitHub',
    link_github_project:      'Projeto GitHub',
    link_cloudflare:          'Cloudflare',
    link_admin:               'Página Admin',
    link_dashboard:           'Dashboard',
    link_automation:          'Fluxo de Automação',
    link_other:               'Link',

    portal_title:             'Seu Portal de Projetos',
    portal_status_heading:    'Status do Projeto',
    portal_contact_heading:   'Fale Conosco',
    portal_call:              'Ligar',
    portal_whatsapp:          'WhatsApp',
    portal_email:             'E-mail',
    portal_website:           'Site',
    portal_message_us:        'Enviar Mensagem',
    portal_no_projects:       'Seus projetos aparecerão aqui quando o trabalho começar.',
    portal_no_comments:       'Nenhuma mensagem ainda. Envie uma mensagem abaixo.',

    archive_title:            'Arquivo',
    archive_empty:            'Nenhum cliente arquivado.',
    archive_search:           'Buscar clientes arquivados…',
    archived_on:              'Arquivado em',
    total_projects:           'projetos',

    portal_access:            'Acesso ao Portal',
    linked_user:              'Login do cliente',
    no_linked_user:           'Nenhum login configurado',
    add_portal_access:        'Adicionar Acesso ao Portal',
    firebase_uid:             'UID do Firebase',
    remove_access:            'Remover Acesso',

    all_complete_notice:      'Todos os projetos estão concluídos. Pronto para arquivar?',
    loading:                  'Carregando…',
    error_generic:            'Algo deu errado. Tente novamente.',
  }
};

let _lang = 'en';

export function getLang() { return _lang; }

export function setLang(lang) {
  if (!['en', 'pt'].includes(lang)) return;
  _lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const val = STRINGS[_lang][key];
    if (val) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = val;
      else el.textContent = val;
    }
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const key = el.dataset.i18nPh;
    el.placeholder = STRINGS[_lang][key] || key;
  });
}

export function t(key) {
  return STRINGS[_lang]?.[key] ?? STRINGS.en[key] ?? key;
}

export function statusLabel(status) {
  const map = {
    not_started:        t('status_not_started'),
    in_progress:        t('status_in_progress'),
    waiting_on_client:  t('status_waiting_on_client'),
    v1_done:            t('status_v1_done'),
    updates_in_progress:t('status_updates_in_progress'),
    completed:          t('status_completed'),
  };
  return map[status] || status;
}

export function linkTypeLabel(type) {
  return t(`link_${type}`) !== `link_${type}` ? t(`link_${type}`) : type;
}

export const STATUS_OPTIONS = [
  { value: 'not_started',        labelKey: 'status_not_started' },
  { value: 'in_progress',        labelKey: 'status_in_progress' },
  { value: 'waiting_on_client',  labelKey: 'status_waiting_on_client' },
  { value: 'v1_done',            labelKey: 'status_v1_done' },
  { value: 'updates_in_progress',labelKey: 'status_updates_in_progress' },
  { value: 'completed',          labelKey: 'status_completed' },
];

export const LINK_TYPE_OPTIONS = [
  'live_site', 'staging', 'test', 'github_repo', 'github_project',
  'cloudflare', 'admin', 'dashboard', 'automation', 'other'
];
