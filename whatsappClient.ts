import { WhatsAppConfig, WhatsAppGroup, WhatsAppMessageLog, WhatsAppSessionInfo, WhatsAppSystemLog, BillingSchedule } from './types';
import { getSupabase } from './supabaseClient';

const PROD_CLOUD_BACKEND = 'https://ais-pre-ybjbk7lhnyuayauhjkdylp-92263901255.us-west1.run.app';

export function getBackendUrl(): string {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('whatsapp_backend_url');
    if (saved && saved.trim()) return saved.trim();
  }
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_WHATSAPP_API_URL) {
      return (import.meta as any).env.VITE_WHATSAPP_API_URL.trim();
    }
  } catch (e) {}
  // Sempre usa rotas relativas por padrão para usar o Proxy do netlify.toml (CORS-free e centralizado)
  return '';
}

export function setBackendUrl(url: string): void {
  if (typeof localStorage !== 'undefined') {
    if (url && url.trim()) {
      localStorage.setItem('whatsapp_backend_url', url.trim());
    } else {
      localStorage.removeItem('whatsapp_backend_url');
    }
  }
}

function getApiBase(): string {
  const backend = getBackendUrl();
  if (backend) {
    if (backend.endsWith('/api/whatsapp')) return backend;
    return `${backend.replace(/\/$/, '')}/api/whatsapp`;
  }
  return '/api/whatsapp';
}

async function requestWhatsAppApi(path: string, options: RequestInit = {}, timeoutMs = 12000): Promise<any> {
  const base = getApiBase();
  let lastError: any = null;

  try {
    const url = `${base}${path.startsWith('/') ? path : '/' + path}`;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    clearTimeout(id);

    if (res.ok) {
      return await res.json();
    }

    const errJson = await res.json().catch(() => ({}));
    lastError = new Error(errJson.error || `Erro HTTP ${res.status}: Servidor backend não respondeu corretamente.`);
    
    // Custom error for 404 to help the user understand static hosting issues
    if (res.status === 404) {
      throw new Error(`Erro HTTP 404: A rota do WhatsApp não foi encontrada. Se você publicou em um serviço estático (como Netlify ou Vercel), o servidor backend Node.js não foi iniciado. Por favor, faça o deploy em um ambiente Full-Stack como Google Cloud Run, Render ou Railway, ou utilize o botão 'Deploy'/'Share' nativo do editor.`);
    }

    throw lastError;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('O tempo de conexão com o servidor do WhatsApp esgotou. Tente novamente.');
    }
    throw err;
  }
}

const DEFAULT_BILLING_TEMPLATE_1 = `💰 *COBRANÇA SEMANAL - {nome_grupo} (1º Lembrete)*

Fala, guerreiros! Passando para iniciar a semana lembrando da contribuição da mensalidade de *{data}* ({semana}).

💵 *Valor:* R$ {valor}
🔑 *Chave PIX ({pix_tipo}):* {pix}

📊 *STATUS DOS PAGAMENTOS:*
✅ *Confirmados / Pagos ({total_pago}):*
{lista_pagos}

⏳ *Pendentes ({total_pendentes}):*
{lista_pendentes}

Quem já realizou o pagamento via PIX, favor enviar o comprovante para confirmação. Valeu! ⚽🔥`;

const DEFAULT_BILLING_TEMPLATE_2 = `📢 *ATUALIZAÇÃO DO CAIXA - {nome_grupo} (2º Aviso)*

Fala, rapaziada! Atualizando o quadro de pagamentos da semana ({semana}) para fecharmos as despesas do time.

💵 *Valor:* R$ {valor}
🔑 *Chave PIX ({pix_tipo}):* {pix}

📊 *COMO ESTÁ O NOSSO QUADRO:*
✅ *Já Pagaram ({total_pago}):*
{lista_pagos}

⏳ *Ainda Falta Confirmar ({total_pendentes}):*
{lista_pendentes}

Contamos com a colaboração de todos para mantermos o time 100% em dia! ⚽👊`;

const DEFAULT_BILLING_TEMPLATE_3 = `⚠️ *ÚLTIMO AVISO DA SEMANA - {nome_grupo}* ⚠️

Guerreiros, estamos fechando o caixa da semana ({semana}) antes da nossa rodada! Quem ainda não acertou, por favor regularizar hoje:

💵 *Valor:* R$ {valor}
🔑 *Chave PIX ({pix_tipo}):* {pix}

📋 *LISTA DE ATLETAS PENDENTES ({total_pendentes}):*
{lista_pendentes}

✅ *Atletas com Mensalidade em Dia ({total_pago}):*
{lista_pagos}

Favor enviar o comprovante para dar baixa. Bora pro jogo! ⚽🔥`;

const DEFAULT_MATCH_TEMPLATE = `⚽ *RELATÓRIO PÓS-JOGO - {nome_time}* ⚽

🆚 *Adversário:* {adversario}
📊 *Placar:* {nome_time} {placar} {adversario}
🏅 *Resultado:* {resultado}
📅 *Data:* {data} às {horario}
📍 *Local:* {local}

🎯 *Gols da Partida:*
{artilheiros}

📋 *Escalação Titular:*
{titulares}

📝 *Destaques & Observações:*
{observacoes}

_#PesadãoFC #FutebolDeDomingo #FamiliaPesadão_`;

function getDefaultSchedules(): BillingSchedule[] {
  return [
    {
      id: '1',
      title: '1º Disparo (Lembrete Inicial)',
      enabled: true,
      dayOfWeek: 1,
      sendTime: '09:00',
      messageTemplate: DEFAULT_BILLING_TEMPLATE_1,
    },
    {
      id: '2',
      title: '2º Disparo (Reforço do Meio de Semana)',
      enabled: false,
      dayOfWeek: 3,
      sendTime: '18:00',
      messageTemplate: DEFAULT_BILLING_TEMPLATE_2,
    },
    {
      id: '3',
      title: '3º Disparo (Cobrança Final da Semana)',
      enabled: false,
      dayOfWeek: 5,
      sendTime: '17:00',
      messageTemplate: DEFAULT_BILLING_TEMPLATE_3,
    },
  ];
}

const DEFAULT_CONFIG: WhatsAppConfig = {
  id: 1,
  isActive: false,
  groupId: '',
  groupName: '',
  dayOfWeek: 1,
  sendTime: '09:00',
  messageTemplate: DEFAULT_BILLING_TEMPLATE_1,
  billingType: 'general',
  pixKey: '',
  pixType: 'cpf',
  defaultFee: 40,
  schedules: getDefaultSchedules(),
  matchGroupId: '',
  matchGroupName: '',
  matchMessageTemplate: DEFAULT_MATCH_TEMPLATE,
  matchAutoSend: false,
};

function getLocalConfigCache(): WhatsAppConfig {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('pesadao_whatsapp_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          schedules: parsed.schedules || getDefaultSchedules(),
        };
      }
    }
  } catch (e) {}
  return DEFAULT_CONFIG;
}

function saveLocalConfigCache(cfg: WhatsAppConfig) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('pesadao_whatsapp_config', JSON.stringify(cfg));
    }
  } catch (e) {}
}

export async function getWhatsAppStatus(): Promise<WhatsAppSessionInfo> {
  try {
    const data = await requestWhatsAppApi('/status', { method: 'GET' }, 8000);
    if (data) return data;
  } catch (err: any) {
    // Falha de conexão direta com backend
  }

  // Tentar ler status da sessão gravada no Supabase
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data } = await supabase.from('whatsapp_sessions').select('*').eq('id', 'default').maybeSingle();
      if (data) {
        return {
          status: data.status || 'disconnected',
          phoneNumber: data.phone_number || null,
          qrCode: data.qr_code || null,
          error: data.last_error || null,
          lastConnected: data.last_connected_at || null,
        };
      }
    } catch (e) {}
  }

  return {
    status: 'disconnected',
    phoneNumber: null,
    qrCode: null,
    error: null,
    lastConnected: null,
  };
}

export async function connectWhatsApp(): Promise<WhatsAppSessionInfo> {
  try {
    return await requestWhatsAppApi('/connect', { method: 'POST' }, 20000);
  } catch (err: any) {
    console.warn('[WhatsAppClient] Erro ao conectar:', err);
    throw new Error(err.message || 'Erro ao iniciar conexão com o WhatsApp. Tente novamente em instantes.');
  }
}

export async function disconnectWhatsApp(): Promise<{ success: boolean; message: string }> {
  return await requestWhatsAppApi('/disconnect', { method: 'POST' }, 10000);
}

export async function switchWhatsAppNumber(): Promise<WhatsAppSessionInfo> {
  return await requestWhatsAppApi('/switch-number', { method: 'POST' }, 15000);
}

export async function getWhatsAppGroups(): Promise<WhatsAppGroup[]> {
  try {
    const data = await requestWhatsAppApi('/groups', { method: 'GET' }, 10000);
    return data.groups || [];
  } catch (e) {
    return [];
  }
}

export async function getWhatsAppConfig(): Promise<WhatsAppConfig> {
  // 1. Tentar ler do backend Node.js
  try {
    const data = await requestWhatsAppApi('/config', { method: 'GET' }, 6000);
    if (data && data.schedules) {
      saveLocalConfigCache(data);
      return data;
    }
  } catch (e) {}

  // 2. Fallback direto no Supabase (essencial para Netlify, Render e client-side)
  const supabase = getSupabase();
  if (supabase) {
    try {
      // 2a. Tentar ler da tabela whatsapp_config
      const { data, error } = await supabase.from('whatsapp_config').select('*').eq('id', 1).maybeSingle();
      
      // 2b. Tentar ler backup em JSON da tabela whatsapp_auth caso exista
      let authBackupConfig: any = null;
      try {
        const { data: authBackup } = await supabase.from('whatsapp_auth').select('data').eq('id', 'whatsapp_config_v2').maybeSingle();
        if (authBackup && authBackup.data) {
          authBackupConfig = typeof authBackup.data === 'string' ? JSON.parse(authBackup.data) : authBackup.data;
        }
      } catch (e) {}

      if (!error && (data || authBackupConfig)) {
        let schedules: BillingSchedule[] = authBackupConfig?.schedules || getDefaultSchedules();
        if (data?.billing_schedules || data?.schedules) {
          try {
            const raw = data.billing_schedules || data.schedules;
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (Array.isArray(parsed) && parsed.length > 0) schedules = parsed;
          } catch (e) {}
        } else if (data?.day_of_week !== undefined) {
          schedules[0].dayOfWeek = data.day_of_week ?? 1;
          schedules[0].sendTime = data.send_time ?? '09:00';
          schedules[0].messageTemplate = data.message_template ?? DEFAULT_BILLING_TEMPLATE_1;
        }

        const resolvedMatchTemplate = data?.match_template || authBackupConfig?.matchMessageTemplate || getLocalConfigCache().matchMessageTemplate || DEFAULT_MATCH_TEMPLATE;

        const config: WhatsAppConfig = {
          id: data?.id || 1,
          isActive: data?.is_active ?? authBackupConfig?.isActive ?? false,
          groupId: data?.group_id ?? authBackupConfig?.groupId ?? '',
          groupName: data?.group_name ?? authBackupConfig?.groupName ?? '',
          dayOfWeek: schedules[0]?.dayOfWeek ?? data?.day_of_week ?? 1,
          sendTime: schedules[0]?.sendTime ?? data?.send_time ?? '09:00',
          messageTemplate: schedules[0]?.messageTemplate ?? data?.message_template ?? DEFAULT_BILLING_TEMPLATE_1,
          billingType: data?.billing_type ?? authBackupConfig?.billingType ?? 'general',
          pixKey: data?.pix_key ?? authBackupConfig?.pixKey ?? '',
          pixType: data?.pix_type ?? authBackupConfig?.pixType ?? 'cpf',
          defaultFee: Number(data?.default_fee ?? authBackupConfig?.defaultFee) || 40,
          schedules: schedules,
          matchGroupId: data?.match_group_id ?? authBackupConfig?.matchGroupId ?? '',
          matchGroupName: data?.match_group_name ?? authBackupConfig?.matchGroupName ?? '',
          matchMessageTemplate: resolvedMatchTemplate,
          matchAutoSend: data?.match_auto_send ?? authBackupConfig?.matchAutoSend ?? false,
          updatedAt: data?.updated_at || authBackupConfig?.updatedAt,
        };
        saveLocalConfigCache(config);
        return config;
      }
    } catch (err) {
      console.warn('[WhatsAppClient] Erro ao carregar config direto do Supabase:', err);
    }
  }

  // 3. Fallback no LocalStorage
  return getLocalConfigCache();
}

export async function saveWhatsAppConfig(config: Partial<WhatsAppConfig>): Promise<WhatsAppConfig> {
  const current = getLocalConfigCache();
  const schedules = config.schedules || current.schedules || getDefaultSchedules();

  const merged: WhatsAppConfig = {
    ...current,
    ...config,
    schedules,
    dayOfWeek: schedules[0]?.dayOfWeek ?? current.dayOfWeek ?? 1,
    sendTime: schedules[0]?.sendTime ?? current.sendTime ?? '09:00',
    messageTemplate: schedules[0]?.messageTemplate ?? current.messageTemplate ?? DEFAULT_BILLING_TEMPLATE_1,
    matchMessageTemplate: config.matchMessageTemplate ?? current.matchMessageTemplate ?? DEFAULT_MATCH_TEMPLATE,
    updatedAt: new Date().toISOString(),
  };

  // 1. Salvar no LocalStorage para acesso síncrono imediato no frontend
  saveLocalConfigCache(merged);

  // 2. Salvar diretamente no Supabase em dupla persistência
  const supabase = getSupabase();
  if (supabase) {
    // 2a. Salvar backup no whatsapp_auth (JSONB seguro independente de schema)
    try {
      await supabase.from('whatsapp_auth').upsert({
        id: 'whatsapp_config_v2',
        data: merged,
        updated_at: new Date().toISOString(),
      });
    } catch (authErr) {
      console.warn('[WhatsAppClient] Erro ao salvar config no whatsapp_auth backup:', authErr);
    }

    // 2b. Salvar na tabela whatsapp_config
    try {
      const payload: any = {
        id: 1,
        is_active: merged.isActive,
        group_id: merged.groupId,
        group_name: merged.groupName,
        day_of_week: merged.dayOfWeek,
        send_time: merged.sendTime,
        message_template: merged.messageTemplate,
        billing_type: merged.billingType,
        pix_key: merged.pixKey,
        pix_type: merged.pixType,
        default_fee: merged.defaultFee,
        billing_schedules: JSON.stringify(merged.schedules),
        match_group_id: merged.matchGroupId || '',
        match_group_name: merged.matchGroupName || '',
        match_template: merged.matchMessageTemplate || DEFAULT_MATCH_TEMPLATE,
        match_auto_send: merged.matchAutoSend || false,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertErr } = await supabase.from('whatsapp_config').upsert(payload);
      if (upsertErr) {
        console.warn('[WhatsAppClient] Upsert completo falhou, tentando payload reduzido:', upsertErr.message);
        // Tentar remover colunas novas caso ainda não existam no banco do usuário
        delete payload.billing_schedules;
        delete payload.match_group_id;
        delete payload.match_group_name;
        delete payload.match_template;
        delete payload.match_auto_send;
        await supabase.from('whatsapp_config').upsert(payload);
      }
    } catch (e) {
      console.warn('[WhatsAppClient] Erro ao sincronizar config com Supabase:', e);
    }
  }

  // 3. Notificar backend Node se acessível (Render / local)
  try {
    const res = await requestWhatsAppApi('/config', {
      method: 'POST',
      body: JSON.stringify(merged),
    }, 6000);
    if (res) return res;
  } catch (e) {}

  return merged;
}

function sanitizePlayers(players?: any[]) {
  if (!players || !Array.isArray(players)) return undefined;
  return players.map((p) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    status: p.status,
    value: p.value,
    paymentHistory: p.paymentHistory,
    paymentDate: p.paymentDate,
    isPaid: p.isPaid,
  }));
}

function computeClientReferenceWeek(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
}

export async function previewWhatsAppMessage(
  template: string,
  billingType: 'general' | 'detailed',
  players?: any[],
  monthKey?: string
): Promise<{ preview: string; referenceWeek: string }> {
  try {
    const data = await requestWhatsAppApi('/preview', {
      method: 'POST',
      body: JSON.stringify({ template, billingType, players: sanitizePlayers(players), monthKey }),
    }, 4000);
    if (data) return data;
  } catch (e) {}

  // Geração local no client-side como fallback instantâneo
  const config = await getWhatsAppConfig();
  const list = players || [];
  const activePlayers = list.filter((p: any) => p.status !== 'inactive' && p.status !== 'injured');
  
  const paidPlayers = activePlayers.filter((p: any) => {
    if (monthKey && p.paymentHistory) return !!p.paymentHistory[monthKey];
    return !!p.isPaid;
  });
  const pendingPlayers = activePlayers.filter((p: any) => {
    if (monthKey && p.paymentHistory) return !p.paymentHistory[monthKey];
    return !p.isPaid;
  });

  const fee = config.defaultFee || 40;
  const totalCollected = paidPlayers.reduce((acc: number, p: any) => acc + (Number(p.value) || fee), 0);
  const totalPending = pendingPlayers.reduce((acc: number, p: any) => acc + (Number(p.value) || fee), 0);

  const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const now = new Date();
  const curMonthStr = `${months[now.getMonth()]}/${now.getFullYear()}`;
  const refWeek = computeClientReferenceWeek();

  const listaPagosFormatted = paidPlayers.length > 0
    ? paidPlayers.map((p: any) => `• ✅ ${p.name.split(' ')[0]} ${p.name.split(' ')[1] ? p.name.split(' ')[1][0] + '.' : ''}`).join('\n')
    : '• Nenhum pagamento confirmado ainda';

  const listaPendentesFormatted = pendingPlayers.length > 0
    ? pendingPlayers.map((p: any) => `• ⏳ ${p.name.split(' ')[0]} ${p.name.split(' ')[1] ? p.name.split(' ')[1][0] + '.' : ''}`).join('\n')
    : '• Todos os atletas em dia! Parabéns! 🎉';

  const replacements: Record<string, string> = {
    '{nome_grupo}': config.groupName || 'Pesadão F.C.',
    '{valor}': fee.toFixed(2).replace('.', ','),
    '{pix}': config.pixKey || 'CHAVE_PIX_AQUI',
    '{pix_tipo}': config.pixType ? config.pixType.toUpperCase() : 'PIX',
    '{data}': curMonthStr,
    '{semana}': refWeek,
    '{total_pago}': paidPlayers.length.toString(),
    '{total_pendentes}': pendingPlayers.length.toString(),
    '{total_jogadores}': activePlayers.length.toString(),
    '{total_arrecadado}': totalCollected.toFixed(2).replace('.', ','),
    '{total_pendente}': totalPending.toFixed(2).replace('.', ','),
    '{lista_pagos}': listaPagosFormatted,
    '{lista_pendentes}': listaPendentesFormatted,
    '{lista_pagos_linha}': paidPlayers.map((p: any) => p.name.split(' ')[0]).join(', ') || 'Nenhum',
    '{lista_pendentes_linha}': pendingPlayers.map((p: any) => p.name.split(' ')[0]).join(', ') || 'Nenhum',
  };

  let rendered = template || DEFAULT_BILLING_TEMPLATE_1;
  for (const [key, val] of Object.entries(replacements)) {
    rendered = rendered.split(key).join(val);
  }

  return { preview: rendered, referenceWeek: refWeek };
}

export async function previewMatchWhatsAppMessage(
  matchData: any,
  template?: string,
  playersList?: any[]
): Promise<{ preview: string }> {
  // 1. Resolver template: usar o customizado fornecido ou o mais recente salvo na configuração
  let templateToUse = template;
  if (!templateToUse) {
    try {
      const config = await getWhatsAppConfig();
      templateToUse = config.matchMessageTemplate || DEFAULT_MATCH_TEMPLATE;
    } catch (e) {
      templateToUse = getLocalConfigCache().matchMessageTemplate || DEFAULT_MATCH_TEMPLATE;
    }
  }

  // 2. Tentar rota do backend se disponível (passando o template explicitamente)
  try {
    const data = await requestWhatsAppApi('/match-preview', {
      method: 'POST',
      body: JSON.stringify({ matchData, template: templateToUse }),
    }, 4000);
    if (data && data.preview) return data;
  } catch (e) {}

  // 3. Fallback / Renderizador de alta precisão
  const opponent = matchData?.opponent || 'Adversário';
  const homeScore = Number(matchData?.homeScore ?? matchData?.home_score ?? 0);
  const awayScore = Number(matchData?.awayScore ?? matchData?.away_score ?? 0);
  const placar = `${homeScore} x ${awayScore}`;
  const resultado = homeScore > awayScore ? 'VITÓRIA 🏆' : homeScore < awayScore ? 'DERROTA ❌' : 'EMPATE 🤝';

  let dataFormatted = matchData?.date || '';
  if (dataFormatted.includes('-')) {
    const parts = dataFormatted.split('-');
    if (parts.length === 3) dataFormatted = `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  // Resolver lista de atletas
  let players = playersList || [];
  if (players.length === 0) {
    try {
      const stored = localStorage.getItem('pesadao_players');
      if (stored) players = JSON.parse(stored);
    } catch (e) {}
  }

  // Artilheiros
  let artilheirosText = '';
  const goalScorers: { name: string; goals: number }[] = [];
  const lineup = typeof matchData?.lineup === 'string' ? JSON.parse(matchData.lineup || '{}') : (matchData?.lineup || {});

  if (matchData?.matchPlayerStats) {
    for (const [pid, stat] of Object.entries<any>(matchData.matchPlayerStats)) {
      if (stat && stat.goals > 0) {
        const player = players.find((p: any) => p.id?.toString() === pid?.toString());
        const name = player ? player.name.split(' ')[0] : `Atleta #${pid}`;
        goalScorers.push({ name, goals: stat.goals });
      }
    }
  } else if (lineup && Object.keys(lineup).length > 0) {
    for (const [pid, pdata] of Object.entries<any>(lineup)) {
      const g = Number(pdata?.goals || 0);
      if (g > 0) {
        const player = players.find((p: any) => p.id?.toString() === pid?.toString());
        const name = player ? player.name.split(' ')[0] : `Atleta #${pid}`;
        goalScorers.push({ name, goals: g });
      }
    }
  }

  if (goalScorers.length > 0) {
    artilheirosText = goalScorers.map(s => `• ⚽ *${s.name}* (${s.goals} ${s.goals === 1 ? 'gol' : 'gols'})`).join('\n');
  } else if (homeScore > 0) {
    artilheirosText = `• ⚽ ${homeScore} ${homeScore === 1 ? 'gol marcado' : 'gols marcados'}`;
  } else {
    artilheirosText = '• Nenhum gol marcado';
  }

  // Titulares
  const startersList: string[] = [];
  if (lineup && Object.keys(lineup).length > 0) {
    for (const [pid, pdata] of Object.entries<any>(lineup)) {
      if (pdata?.starterPos !== undefined) {
        const player = players.find((p: any) => p.id?.toString() === pid?.toString());
        if (player) startersList.push(player.name.split(' ')[0]);
      }
    }
  }
  const titularesText = startersList.length > 0 ? startersList.join(', ') : 'Quadro Titular Pesadão F.C.';

  const replacements: Record<string, string> = {
    '{adversario}': opponent,
    '{placar}': placar,
    '{gols_pesadao}': homeScore.toString(),
    '{gols_adversario}': awayScore.toString(),
    '{resultado}': resultado,
    '{data}': dataFormatted || 'Data do Jogo',
    '{horario}': matchData?.time || '08:00',
    '{local}': matchData?.location || 'Campo do Pesadão',
    '{artilheiros}': artilheirosText,
    '{titulares}': titularesText,
    '{observacoes}': matchData?.comments || 'Partida com grande entrega e espírito de equipe!',
    '{nome_time}': 'Pesadão F.C.',
    '{total_gols}': (homeScore + awayScore).toString(),
  };

  let rendered = templateToUse || DEFAULT_MATCH_TEMPLATE;
  for (const [key, val] of Object.entries(replacements)) {
    rendered = rendered.split(key).join(val);
  }

  return { preview: rendered };
}

// Helper para enfileirar diretamente no Supabase como fallback de resiliência caso o backend esteja em cold-start / 502
async function enqueueDirectToSupabase(params: {
  tipo: string;
  destino: string;
  mensagem: string;
  executionKey: string;
}): Promise<{ success: boolean; message: string; status: string }> {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      throw new Error('Supabase client não disponível.');
    }

    // Verificar se já existe registro com a mesma chave
    const { data: existing } = await supabase
      .from('whatsapp_queue')
      .select('id, status')
      .eq('execution_key', params.executionKey)
      .maybeSingle();

    if (existing) {
      if (existing.status === 'sent') {
        return {
          success: true,
          status: 'sent',
          message: 'Mensagem enviada com sucesso ao grupo. ✅',
        };
      }
      return {
        success: true,
        status: 'pending',
        message: 'Mensagem adicionada à fila de envio. O WhatsApp fará o envio automaticamente.',
      };
    }

    const { error } = await supabase.from('whatsapp_queue').insert([{
      tipo: params.tipo,
      destino: params.destino,
      mensagem: params.mensagem,
      scheduled_at: new Date().toISOString(),
      status: 'pending',
      execution_key: params.executionKey,
      attempts: 0,
      max_attempts: 3,
    }]);

    if (error && error.code !== '23505') {
      console.warn('[WhatsAppClient] Erro ao inserir na fila direta do Supabase:', error);
      throw error;
    }

    return {
      success: true,
      status: 'pending',
      message: 'Mensagem adicionada à fila de envio. O WhatsApp fará o envio automaticamente.',
    };
  } catch (err: any) {
    console.error('[WhatsAppClient] Falha no fallback direto do Supabase:', err);
    throw new Error(err.message || 'Não foi possível preparar o envio. Tente novamente.');
  }
}

export async function sendTestMessage(customTemplate?: string, players?: any[], monthKey?: string, idempotencyKey?: string): Promise<{ success: boolean; message: string; status?: string }> {
  const key = idempotencyKey || `test_${Date.now()}`;
  try {
    return await requestWhatsAppApi('/send-test', {
      method: 'POST',
      body: JSON.stringify({ customTemplate, players: sanitizePlayers(players), monthKey, idempotencyKey: key }),
    }, 12000);
  } catch (err: any) {
    console.warn('[WhatsAppClient] Erro ou timeout na rota /send-test, tentando enfileiramento via Supabase:', err.message);
    const config = await getWhatsAppConfig();
    if (!config.groupId) {
      throw new Error('Nenhum grupo do WhatsApp configurado nas opções.');
    }
    const previewRes = await previewWhatsAppMessage(customTemplate, undefined, players, monthKey);
    const testMsg = `🤖 *TESTE DE AUTOMAÇÃO - APP PESADÃO*\n_Esta é uma mensagem de teste enviada pelo painel administrativo._\n\n${previewRes.preview}`;
    return await enqueueDirectToSupabase({
      tipo: 'test',
      destino: config.groupId,
      mensagem: testMsg,
      executionKey: key,
    });
  }
}

export async function sendNow(customTemplate?: string, players?: any[], monthKey?: string, scheduleId?: string, idempotencyKey?: string): Promise<{ success: boolean; message: string; status?: string }> {
  const key = idempotencyKey || `manual_${scheduleId || '1'}_${Date.now()}`;
  try {
    return await requestWhatsAppApi('/send-now', {
      method: 'POST',
      body: JSON.stringify({ customTemplate, players: sanitizePlayers(players), monthKey, scheduleId, idempotencyKey: key }),
    }, 12000);
  } catch (err: any) {
    console.warn('[WhatsAppClient] Erro ou timeout na rota /send-now, tentando enfileiramento via Supabase:', err.message);
    const config = await getWhatsAppConfig();
    if (!config.groupId) {
      throw new Error('Nenhum grupo do WhatsApp configurado nas opções.');
    }
    const previewRes = await previewWhatsAppMessage(customTemplate, undefined, players, monthKey);
    return await enqueueDirectToSupabase({
      tipo: 'billing',
      destino: config.groupId,
      mensagem: previewRes.preview,
      executionKey: key,
    });
  }
}

export async function sendMatchWhatsAppReport(matchData: any, template?: string, targetGroupId?: string, idempotencyKey?: string): Promise<{ success: boolean; message: string; status?: string }> {
  const matchId = matchData?.id || matchData?.date || Date.now();
  const key = idempotencyKey || `match_report_${matchId}_${matchData?.homeScore ?? 0}x${matchData?.awayScore ?? 0}`;
  try {
    return await requestWhatsAppApi('/send-match', {
      method: 'POST',
      body: JSON.stringify({ matchData, template, targetGroupId, idempotencyKey: key }),
    }, 12000);
  } catch (err: any) {
    console.warn('[WhatsAppClient] Erro ou timeout na rota /send-match, tentando enfileiramento via Supabase:', err.message);
    const config = await getWhatsAppConfig();
    const destGroupId = targetGroupId || config.matchGroupId || config.groupId;
    if (!destGroupId) {
      throw new Error('Nenhum grupo de WhatsApp configurado para envio do pós-jogo.');
    }
    const previewRes = await previewMatchWhatsAppMessage(matchData, template);
    return await enqueueDirectToSupabase({
      tipo: 'match_report',
      destino: destGroupId,
      mensagem: previewRes.preview,
      executionKey: key,
    });
  }
}

export async function sendMatchTestWhatsAppMessage(idempotencyKey?: string): Promise<{ success: boolean; message: string; status?: string }> {
  const key = idempotencyKey || `match_test_${Date.now()}`;
  try {
    return await requestWhatsAppApi('/send-match-test', {
      method: 'POST',
      body: JSON.stringify({ idempotencyKey: key }),
    }, 12000);
  } catch (err: any) {
    console.warn('[WhatsAppClient] Erro ou timeout na rota /send-match-test, tentando enfileiramento via Supabase:', err.message);
    const config = await getWhatsAppConfig();
    const destGroupId = config.matchGroupId || config.groupId;
    if (!destGroupId) {
      throw new Error('Nenhum grupo de WhatsApp configurado para envio do pós-jogo.');
    }
    const dummyMatch = {
      opponent: 'Real Madruga F.C.',
      homeScore: 4,
      awayScore: 2,
      date: new Date().toISOString().split('T')[0],
      time: '08:00',
      location: 'Arena Pesadão - Campo 1',
      comments: 'Grande atuação com pressão ofensiva e vitória convincente!',
    };
    const previewRes = await previewMatchWhatsAppMessage(dummyMatch, config.matchMessageTemplate);
    const testText = `🤖 *TESTE DE RELATÓRIO PÓS-JOGO*\n_Esta é uma mensagem de demonstração do pós-jogo._\n\n${previewRes.preview}`;
    return await enqueueDirectToSupabase({
      tipo: 'match_test',
      destino: destGroupId,
      mensagem: testText,
      executionKey: key,
    });
  }
}

export async function getWhatsAppHistory(limit = 50): Promise<WhatsAppMessageLog[]> {
  try {
    const data = await requestWhatsAppApi(`/history?limit=${limit}`, { method: 'GET' }, 5000);
    if (data && data.history) return data.history;
  } catch (e) {}

  // Fallback Supabase
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(limit);
      if (data) {
        return data.map((d: any) => ({
          id: d.id,
          groupId: d.group_id,
          groupName: d.group_name || 'Grupo',
          type: d.type || 'auto',
          status: d.status || 'sent',
          referenceWeek: d.reference_week || '',
          sentAt: d.sent_at || d.created_at,
          message: d.message,
          error: d.error,
        }));
      }
    } catch (e) {}
  }
  return [];
}

export async function getWhatsAppLogs(limit = 100): Promise<WhatsAppSystemLog[]> {
  try {
    const data = await requestWhatsAppApi(`/logs?limit=${limit}`, { method: 'GET' }, 5000);
    if (data && data.logs) return data.logs;
  } catch (e) {}

  // Fallback Supabase
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data } = await supabase
        .from('whatsapp_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (data) {
        return data.map((d: any) => ({
          id: d.id,
          timestamp: d.created_at,
          event: d.event,
          description: d.description,
          level: d.level || 'info',
        }));
      }
    } catch (e) {}
  }
  return [];
}
