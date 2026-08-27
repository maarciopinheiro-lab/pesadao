import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { WhatsAppConfig, WhatsAppMessageLog, WhatsAppSystemLog, WhatsAppSessionInfo, BillingSchedule } from '../types';
import WebSocket from 'ws';

if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as any).WebSocket = WebSocket;
}

export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://udtjrhyblktpnbaynchw.supabase.co';
export const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkdGpyaHlibGt0cG5iYXluY2h3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDkzMTAxMSwiZXhwIjoyMDgwNTA3MDExfQ.zmfa5JeymqWkoOndhFw_7SOruzlFXw6rv76PKO88UUY';

let supabaseClient: SupabaseClient | null = null;

export function getAdminSupabase(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;
  try {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });
    return supabaseClient;
  } catch (error) {
    console.error('[SupabaseAdmin] Erro ao instanciar cliente:', error);
    return null;
  }
}

// Default Billing Templates for 3 Slots
export const DEFAULT_BILLING_TEMPLATE_1 = `💰 *COBRANÇA SEMANAL - {nome_grupo} (1º Lembrete)*

Fala, guerreiros! Passando para iniciar a semana lembrando da contribuição da mensalidade de *{data}* ({semana}).

💵 *Valor:* R$ {valor}
🔑 *Chave PIX ({pix_tipo}):* {pix}

📊 *STATUS DOS PAGAMENTOS:*
✅ *Confirmados / Pagos ({total_pago}):*
{lista_pagos}

⏳ *Pendentes ({total_pendentes}):*
{lista_pendentes}

Quem já realizou o pagamento via PIX, favor enviar o comprovante para confirmação. Valeu! ⚽🔥`;

export const DEFAULT_BILLING_TEMPLATE_2 = `📢 *ATUALIZAÇÃO DO CAIXA - {nome_grupo} (2º Aviso)*

Fala, rapaziada! Atualizando o quadro de pagamentos da semana ({semana}) para fecharmos as despesas do time.

💵 *Valor:* R$ {valor}
🔑 *Chave PIX ({pix_tipo}):* {pix}

📊 *COMO ESTÁ O NOSSO QUADRO:*
✅ *Já Pagaram ({total_pago}):*
{lista_pagos}

⏳ *Ainda Falta Confirmar ({total_pendentes}):*
{lista_pendentes}

Contamos com a colaboração de todos para mantermos o time 100% em dia! ⚽👊`;

export const DEFAULT_BILLING_TEMPLATE_3 = `⚠️ *ÚLTIMO AVISO DA SEMANA - {nome_grupo}* ⚠️

Guerreiros, estamos fechando o caixa da semana ({semana}) antes da nossa rodada! Quem ainda não acertou, por favor regularizar hoje:

💵 *Valor:* R$ {valor}
🔑 *Chave PIX ({pix_tipo}):* {pix}

📋 *LISTA DE ATLETAS PENDENTES ({total_pendentes}):*
{lista_pendentes}

✅ *Atletas com Mensalidade em Dia ({total_pago}):*
{lista_pagos}

Favor enviar o comprovante para dar baixa. Bora pro jogo! ⚽🔥`;

export function getDefaultSchedules(baseTemplate?: string): BillingSchedule[] {
  return [
    {
      id: '1',
      title: '1º Disparo (Lembrete Inicial)',
      enabled: true,
      dayOfWeek: 1, // Segunda-feira
      sendTime: '09:00',
      messageTemplate: baseTemplate || DEFAULT_BILLING_TEMPLATE_1,
    },
    {
      id: '2',
      title: '2º Disparo (Reforço do Meio de Semana)',
      enabled: false,
      dayOfWeek: 3, // Quarta-feira
      sendTime: '18:00',
      messageTemplate: DEFAULT_BILLING_TEMPLATE_2,
    },
    {
      id: '3',
      title: '3º Disparo (Cobrança Final da Semana)',
      enabled: false,
      dayOfWeek: 5, // Sexta-feira
      sendTime: '17:00',
      messageTemplate: DEFAULT_BILLING_TEMPLATE_3,
    },
  ];
}

// Default Match Template
export const DEFAULT_MATCH_TEMPLATE = `⚽ *RELATÓRIO PÓS-JOGO - {nome_time}* ⚽

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

// Fallback in-memory state in case database tables are pending creation
const inMemoryState = {
  config: {
    id: 1,
    isActive: false,
    groupId: '',
    groupName: '',
    dayOfWeek: 1, // Segunda-feira
    sendTime: '09:00',
    messageTemplate: DEFAULT_BILLING_TEMPLATE_1,
    billingType: 'general' as 'general' | 'detailed',
    pixKey: '',
    pixType: 'cpf' as any,
    defaultFee: 40,
    schedules: getDefaultSchedules(),
    matchGroupId: '',
    matchGroupName: '',
    matchMessageTemplate: DEFAULT_MATCH_TEMPLATE,
    matchAutoSend: false,
  } as WhatsAppConfig,
  messages: [] as WhatsAppMessageLog[],
  logs: [] as WhatsAppSystemLog[],
  session: {
    status: 'disconnected',
    phoneNumber: null,
    qrCode: null,
    error: null,
    lastConnected: null,
  } as WhatsAppSessionInfo,
};

export async function addSystemLog(event: string, description: string, level: 'info' | 'warn' | 'error' = 'info', metadata?: any) {
  const timestamp = new Date().toISOString();
  const logItem: WhatsAppSystemLog = {
    id: Date.now() + Math.random(),
    timestamp,
    event,
    description,
    level,
  };

  inMemoryState.logs.unshift(logItem);
  if (inMemoryState.logs.length > 200) inMemoryState.logs.pop();

  const supabase = getAdminSupabase();
  if (supabase) {
    try {
      await supabase.from('whatsapp_logs').insert([{
        event,
        description,
        level,
        metadata: metadata ? JSON.stringify(metadata) : null,
      }]);
    } catch (e) {
      // Non-blocking log insertion error
    }
  }
}

export async function getSystemLogs(limit = 100): Promise<WhatsAppSystemLog[]> {
  const supabase = getAdminSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('whatsapp_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!error && data && data.length > 0) {
        return data.map((d: any) => ({
          id: d.id,
          timestamp: d.created_at,
          event: d.event,
          description: d.description,
          level: d.level || 'info',
        }));
      }
    } catch (err) {
      // Fallback
    }
  }
  return inMemoryState.logs.slice(0, limit);
}

export async function getWhatsAppConfig(): Promise<WhatsAppConfig> {
  const supabase = getAdminSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase.from('whatsapp_config').select('*').eq('id', 1).maybeSingle();
      
      let authBackupConfig: any = null;
      try {
        const { data: authBackup } = await supabase.from('whatsapp_auth').select('data').eq('id', 'whatsapp_config_v2').maybeSingle();
        if (authBackup && authBackup.data) {
          authBackupConfig = typeof authBackup.data === 'string' ? JSON.parse(authBackup.data) : authBackup.data;
        }
      } catch (e) {}

      if (!error && (data || authBackupConfig)) {
        let schedules: BillingSchedule[] = authBackupConfig?.schedules || inMemoryState.config.schedules || getDefaultSchedules();
        
        // Carregar schedules salvos do DB se existirem
        if (data?.billing_schedules || data?.schedules) {
          try {
            const raw = data.billing_schedules || data.schedules;
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (Array.isArray(parsed) && parsed.length > 0) {
              schedules = parsed;
            }
          } catch (e) {
            // Manter padrão
          }
        } else if (data?.day_of_week !== undefined) {
          // Inicializar 1º slot a partir das colunas existentes
          schedules = [
            {
              id: '1',
              title: '1º Disparo (Lembrete Inicial)',
              enabled: true,
              dayOfWeek: data.day_of_week ?? 1,
              sendTime: data.send_time ?? '09:00',
              messageTemplate: data.message_template ?? inMemoryState.config.messageTemplate,
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

        const resolvedMatchTemplate = data?.match_template || authBackupConfig?.matchMessageTemplate || inMemoryState.config.matchMessageTemplate || DEFAULT_MATCH_TEMPLATE;

        inMemoryState.config = {
          id: data?.id || 1,
          isActive: data?.is_active ?? authBackupConfig?.isActive ?? false,
          provider: authBackupConfig?.provider || (data?.provider as any) || inMemoryState.config.provider || 'baileys',
          zapiInstanceId: authBackupConfig?.zapiInstanceId || data?.zapi_instance_id || inMemoryState.config.zapiInstanceId || '',
          zapiToken: authBackupConfig?.zapiToken || data?.zapi_token || inMemoryState.config.zapiToken || '',
          zapiClientToken: authBackupConfig?.zapiClientToken || data?.zapi_client_token || inMemoryState.config.zapiClientToken || '',
          evolutionApiUrl: authBackupConfig?.evolutionApiUrl || data?.evolution_api_url || inMemoryState.config.evolutionApiUrl || '',
          evolutionApiKey: authBackupConfig?.evolutionApiKey || data?.evolution_api_key || inMemoryState.config.evolutionApiKey || '',
          evolutionInstance: authBackupConfig?.evolutionInstance || data?.evolution_instance || inMemoryState.config.evolutionInstance || '',
          groupId: data?.group_id ?? authBackupConfig?.groupId ?? '',
          groupName: data?.group_name ?? authBackupConfig?.groupName ?? '',
          dayOfWeek: schedules[0]?.dayOfWeek ?? data?.day_of_week ?? 1,
          sendTime: schedules[0]?.sendTime ?? data?.send_time ?? '09:00',
          messageTemplate: schedules[0]?.messageTemplate ?? data?.message_template ?? inMemoryState.config.messageTemplate,
          billingType: data?.billing_type ?? authBackupConfig?.billingType ?? 'general',
          pixKey: data?.pix_key ?? authBackupConfig?.pixKey ?? '',
          pixType: data?.pix_type ?? authBackupConfig?.pixType ?? 'cpf',
          defaultFee: Number(data?.default_fee ?? authBackupConfig?.defaultFee) || 40,
          schedules: schedules,
          matchGroupId: data?.match_group_id ?? authBackupConfig?.matchGroupId ?? inMemoryState.config.matchGroupId ?? '',
          matchGroupName: data?.match_group_name ?? authBackupConfig?.matchGroupName ?? inMemoryState.config.matchGroupName ?? '',
          matchMessageTemplate: resolvedMatchTemplate,
          matchAutoSend: data?.match_auto_send ?? authBackupConfig?.matchAutoSend ?? false,
          updatedAt: data?.updated_at || authBackupConfig?.updatedAt,
        };
        return inMemoryState.config;
      }
    } catch (err) {
      console.warn('[SupabaseAdmin] Erro ao ler whatsapp_config do Supabase, usando memória:', err);
    }
  }
  return inMemoryState.config;
}

export async function saveWhatsAppConfig(config: Partial<WhatsAppConfig>): Promise<WhatsAppConfig> {
  // Garantir que schedules seja consistente
  let schedules = config.schedules || inMemoryState.config.schedules || getDefaultSchedules();
  
  // Sincronizar slot 1 com campos legados se alterados individualmente
  if (config.dayOfWeek !== undefined && schedules[0]) {
    schedules[0].dayOfWeek = config.dayOfWeek;
  }
  if (config.sendTime !== undefined && schedules[0]) {
    schedules[0].sendTime = config.sendTime;
  }
  if (config.messageTemplate !== undefined && schedules[0]) {
    schedules[0].messageTemplate = config.messageTemplate;
  }

  const updated: WhatsAppConfig = {
    ...inMemoryState.config,
    ...config,
    schedules,
    dayOfWeek: schedules[0]?.dayOfWeek ?? inMemoryState.config.dayOfWeek ?? 1,
    sendTime: schedules[0]?.sendTime ?? inMemoryState.config.sendTime ?? '09:00',
    messageTemplate: schedules[0]?.messageTemplate ?? inMemoryState.config.messageTemplate,
    matchMessageTemplate: config.matchMessageTemplate ?? inMemoryState.config.matchMessageTemplate ?? DEFAULT_MATCH_TEMPLATE,
    updatedAt: new Date().toISOString(),
  };
  inMemoryState.config = updated;

  const supabase = getAdminSupabase();
  if (supabase) {
    // 1. Salvar backup no whatsapp_auth (JSONB tolerante a schema)
    try {
      await supabase.from('whatsapp_auth').upsert({
        id: 'whatsapp_config_v2',
        data: updated,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[SupabaseAdmin] Falha ao salvar backup em whatsapp_auth:', e);
    }

    // 2. Salvar na tabela whatsapp_config
    try {
      const payload: any = {
        id: 1,
        is_active: updated.isActive,
        group_id: updated.groupId,
        group_name: updated.groupName,
        day_of_week: updated.dayOfWeek,
        send_time: updated.sendTime,
        message_template: updated.messageTemplate,
        billing_type: updated.billingType,
        pix_key: updated.pixKey,
        pix_type: updated.pixType,
        default_fee: updated.defaultFee,
        billing_schedules: JSON.stringify(updated.schedules),
        match_group_id: updated.matchGroupId || '',
        match_group_name: updated.matchGroupName || '',
        match_template: updated.matchMessageTemplate || DEFAULT_MATCH_TEMPLATE,
        match_auto_send: updated.matchAutoSend || false,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertErr } = await supabase.from('whatsapp_config').upsert(payload);
      if (upsertErr) {
        console.warn('[SupabaseAdmin] Upsert completo falhou no Supabase, tentando payload reduzido:', upsertErr.message);
        delete payload.billing_schedules;
        delete payload.match_group_id;
        delete payload.match_group_name;
        delete payload.match_template;
        delete payload.match_auto_send;
        await supabase.from('whatsapp_config').upsert(payload);
      }
      await addSystemLog('CONFIG_UPDATED', `Configurações de automação atualizadas com sucesso.`, 'info');
    } catch (err) {
      console.warn('[SupabaseAdmin] Falha ao gravar whatsapp_config no Supabase:', err);
    }
  }
  return updated;
}

export async function logWhatsAppMessage(msg: {
  groupId: string;
  groupName?: string;
  type: 'auto' | 'test' | 'manual' | 'match_report' | 'match_test';
  status: 'sent' | 'processing' | 'error' | 'skipped_duplicate';
  referenceWeek: string;
  message: string;
  error?: string;
}): Promise<WhatsAppMessageLog> {
  const newLog: WhatsAppMessageLog = {
    id: Date.now() + Math.random(),
    sentAt: new Date().toISOString(),
    groupId: msg.groupId,
    groupName: msg.groupName || 'Grupo WhatsApp',
    type: msg.type,
    status: msg.status,
    referenceWeek: msg.referenceWeek,
    message: msg.message,
    error: msg.error,
  };

  inMemoryState.messages.unshift(newLog);
  if (inMemoryState.messages.length > 200) inMemoryState.messages.pop();

  const supabase = getAdminSupabase();
  if (supabase) {
    try {
      const { data } = await supabase.from('whatsapp_messages').insert([{
        group_id: msg.groupId,
        group_name: msg.groupName,
        type: msg.type,
        status: msg.status,
        reference_week: msg.referenceWeek,
        message: msg.message,
        error: msg.error || null,
        sent_at: new Date().toISOString(),
      }]).select().maybeSingle();

      if (data) {
        newLog.id = data.id;
      }
    } catch (err) {
      console.warn('[SupabaseAdmin] Erro ao gravar mensagem no histórico Supabase:', err);
    }
  }

  return newLog;
}

export async function getWhatsAppMessageHistory(limit = 50): Promise<WhatsAppMessageLog[]> {
  const supabase = getAdminSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(limit);

      if (!error && data && data.length > 0) {
        return data.map((d: any) => ({
          id: d.id,
          sentAt: d.sent_at || d.created_at,
          groupId: d.group_id,
          groupName: d.group_name || 'Grupo',
          type: d.type || 'auto',
          status: d.status || 'sent',
          referenceWeek: d.reference_week,
          message: d.message,
          error: d.error,
        }));
      }
    } catch (err) {
      // Fallback
    }
  }
  return inMemoryState.messages.slice(0, limit);
}

export async function hasMessageBeenSentThisWeek(groupId: string, referenceWeek: string): Promise<boolean> {
  const supabase = getAdminSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('id')
        .eq('group_id', groupId)
        .eq('reference_week', referenceWeek)
        .eq('type', 'auto')
        .eq('status', 'sent')
        .limit(1);

      if (!error && data && data.length > 0) {
        return true;
      }
    } catch (err) {
      // Fallback to in-memory check
    }
  }

  return inMemoryState.messages.some(
    m => m.groupId === groupId && m.referenceWeek === referenceWeek && m.type === 'auto' && m.status === 'sent'
  );
}

export async function getPlayersFromDb() {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  try {
    const { data } = await supabase.from('players').select('*').order('name', { ascending: true });
    return data || [];
  } catch (e) {
    return [];
  }
}

export async function getMatchesFromDb() {
  const supabase = getAdminSupabase();
  if (!supabase) return [];
  try {
    const { data } = await supabase.from('matches').select('*').order('date', { ascending: true });
    return data || [];
  } catch (e) {
    return [];
  }
}

// Helper: Enfileira uma mensagem com chave única de execução para evitar duplicados
export async function enqueueMessage(msg: {
  tipo: string;
  destino: string;
  mensagem: string;
  scheduledAt?: string;
  executionKey: string;
}): Promise<{ success: boolean; status: 'sent' | 'pending' | 'processing' | 'failed'; message: string; id?: number }> {
  const supabase = getAdminSupabase();
  const scheduledAt = msg.scheduledAt || new Date().toISOString();

  // 1. Verificar se já existe registro com essa chave no Supabase
  if (supabase) {
    try {
      const { data: existing } = await supabase
        .from('whatsapp_queue')
        .select('*')
        .eq('execution_key', msg.executionKey)
        .maybeSingle();

      if (existing) {
        if (existing.status === 'sent') {
          console.log(`[SupabaseAdmin] Mensagem com chave única ${msg.executionKey} já foi enviada anteriormente.`);
          return {
            success: true,
            status: 'sent',
            message: 'Mensagem enviada com sucesso ao grupo. ✅',
            id: existing.id,
          };
        }
        if (existing.status === 'pending' || existing.status === 'processing') {
          console.log(`[SupabaseAdmin] Mensagem com chave única ${msg.executionKey} já está na fila (status: ${existing.status}).`);
          return {
            success: true,
            status: 'pending',
            message: 'Mensagem adicionada à fila de envio. O WhatsApp fará o envio automaticamente.',
            id: existing.id,
          };
        }
        if (existing.status === 'failed') {
          // Reativar mensagem para re-tentativa imediata
          await supabase
            .from('whatsapp_queue')
            .update({
              status: 'pending',
              attempts: 0,
              error: null,
              scheduled_at: scheduledAt,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);

          return {
            success: true,
            status: 'pending',
            message: 'Mensagem adicionada à fila de envio. O WhatsApp fará o envio automaticamente.',
            id: existing.id,
          };
        }
      }

      const { data: inserted, error } = await supabase
        .from('whatsapp_queue')
        .insert([{
          tipo: msg.tipo,
          destino: msg.destino,
          mensagem: msg.mensagem,
          scheduled_at: scheduledAt,
          status: 'pending',
          execution_key: msg.executionKey,
          attempts: 0,
          max_attempts: 3,
        }])
        .select('id')
        .single();

      if (error) {
        if (error.code === '23505') { // Chave única duplicada
          return {
            success: true,
            status: 'pending',
            message: 'Mensagem adicionada à fila de envio. O WhatsApp fará o envio automaticamente.',
          };
        }
        throw error;
      }

      await addSystemLog('QUEUE_ENQUEUED', `Mensagem enfileirada com sucesso. Chave: ${msg.executionKey}`, 'info');
      return {
        success: true,
        status: 'pending',
        message: 'Mensagem adicionada à fila de envio. O WhatsApp fará o envio automaticamente.',
        id: inserted?.id,
      };
    } catch (err: any) {
      console.error('[SupabaseAdmin] Erro ao salvar fila no Supabase, usando fallback em memória:', err);
    }
  }

  // 2. Fallback em memória caso o Supabase esteja temporariamente inacessível
  const existingMem = (inMemoryState as any).queue?.find?.((q: any) => q.execution_key === msg.executionKey);
  if (existingMem) {
    if (existingMem.status === 'sent') {
      return { success: true, status: 'sent', message: 'Mensagem enviada com sucesso ao grupo. ✅' };
    }
    return { success: true, status: 'pending', message: 'Mensagem adicionada à fila de envio. O WhatsApp fará o envio automaticamente.' };
  }

  if (!(inMemoryState as any).queue) {
    (inMemoryState as any).queue = [];
  }
  const memItem = {
    id: Date.now(),
    tipo: msg.tipo,
    destino: msg.destino,
    mensagem: msg.mensagem,
    scheduled_at: scheduledAt,
    status: 'pending',
    execution_key: msg.executionKey,
    attempts: 0,
    max_attempts: 3,
    created_at: new Date().toISOString(),
  };
  (inMemoryState as any).queue.push(memItem);

  return {
    success: true,
    status: 'pending',
    message: 'Mensagem adicionada à fila de envio. O WhatsApp fará o envio automaticamente.',
    id: memItem.id,
  };
}

// Helper: Busca mensagens prontas para envio (scheduled_at <= agora e tentativas < limite)
export async function getPendingQueueMessages(): Promise<any[]> {
  const supabase = getAdminSupabase();
  if (supabase) {
    try {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('whatsapp_queue')
        .select('*')
        .in('status', ['pending', 'failed'])
        .lte('scheduled_at', nowIso)
        .lt('attempts', 3) // max_attempts = 3
        .order('scheduled_at', { ascending: true });

      if (!error && data) {
        return data;
      }
    } catch (err: any) {
      console.error('[SupabaseAdmin] Erro ao carregar fila de mensagens do Supabase:', err);
    }
  }

  // Fallback em memória
  const queueMem = (inMemoryState as any).queue || [];
  const nowIso = new Date().toISOString();
  return queueMem.filter((item: any) => 
    (item.status === 'pending' || item.status === 'failed') &&
    item.attempts < (item.max_attempts || 3) &&
    item.scheduled_at <= nowIso
  );
}

// Helper: Tenta bloquear e atualizar o status de uma mensagem para processando antes do envio
export async function lockQueueMessage(id: number): Promise<boolean> {
  const supabase = getAdminSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('whatsapp_queue')
        .update({
          status: 'processing',
          last_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .in('status', ['pending', 'failed'])
        .select('id');

      if (!error && data && data.length > 0) {
        return true;
      }
    } catch (err) {
      console.error('[SupabaseAdmin] Erro ao travar mensagem da fila no Supabase:', err);
    }
  }

  // Fallback em memória
  const queueMem = (inMemoryState as any).queue || [];
  const item = queueMem.find((q: any) => q.id === id);
  if (item && (item.status === 'pending' || item.status === 'failed')) {
    item.status = 'processing';
    item.last_attempt_at = new Date().toISOString();
    return true;
  }
  return false;
}

// Helper: Atualiza o status final (sucesso ou falha) de uma mensagem da fila
export async function updateQueueMessageStatus(
  id: number,
  status: 'sent' | 'failed' | 'pending',
  details: { error?: string; attempts: number }
): Promise<void> {
  const supabase = getAdminSupabase();
  const nowIso = new Date().toISOString();

  if (supabase) {
    try {
      const payload: any = {
        status,
        attempts: details.attempts,
        error: details.error || null,
        last_attempt_at: nowIso,
        updated_at: nowIso,
      };

      if (status === 'sent') {
        payload.sent_at = nowIso;
      }

      await supabase
        .from('whatsapp_queue')
        .update(payload)
        .eq('id', id);

      await addSystemLog(
        status === 'sent' ? 'QUEUE_SENT' : 'QUEUE_FAILED',
        `Mensagem da fila id ${id} atualizada para ${status}. Tentativas: ${details.attempts}`,
        status === 'sent' ? 'info' : 'error'
      );
    } catch (err) {
      console.error('[SupabaseAdmin] Erro ao atualizar status da fila no Supabase:', err);
    }
  }

  // Fallback em memória
  const queueMem = (inMemoryState as any).queue || [];
  const item = queueMem.find((q: any) => q.id === id);
  if (item) {
    item.status = status;
    item.attempts = details.attempts;
    item.error = details.error || null;
    item.last_attempt_at = nowIso;
    if (status === 'sent') {
      item.sent_at = nowIso;
    }
  }
}

// Helper: Grava o estado atual da sessão do WhatsApp na tabela whatsapp_sessions
export async function updateWhatsAppSessionInDb(session: WhatsAppSessionInfo): Promise<void> {
  inMemoryState.session = { ...session };
  const supabase = getAdminSupabase();
  if (!supabase) return;
  try {
    await supabase.from('whatsapp_sessions').upsert({
      id: 'default',
      status: session.status,
      phone_number: session.phoneNumber || null,
      qr_code: session.qrCode || null,
      last_error: session.error || null,
      last_connected_at: session.lastConnected || null,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[SupabaseAdmin] Erro ao atualizar whatsapp_sessions no Supabase:', err);
  }
}

// Helper: Obtém o estado da sessão gravado
export async function getWhatsAppSessionFromDb(): Promise<WhatsAppSessionInfo> {
  const supabase = getAdminSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('whatsapp_sessions')
        .select('*')
        .eq('id', 'default')
        .maybeSingle();

      if (!error && data) {
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
  return inMemoryState.session;
}

