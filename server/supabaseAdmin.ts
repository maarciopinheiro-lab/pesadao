import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { WhatsAppConfig, WhatsAppMessageLog, WhatsAppSystemLog, WhatsAppSessionInfo, BillingSchedule } from '../types';

export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://udtjrhyblktpnbaynchw.supabase.co';
export const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkdGpyaHlibGt0cG5iYXluY2h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5MzEwMTEsImV4cCI6MjA4MDUwNzAxMX0.QgHFP-qaD_cZ_euwV41nxXsAwUpxjvg0QsWj43d0Qt8';

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
      if (!error && data) {
        let schedules: BillingSchedule[] = inMemoryState.config.schedules || getDefaultSchedules();
        
        // Carregar schedules salvos do DB se existirem
        if (data.billing_schedules || data.schedules) {
          try {
            const raw = data.billing_schedules || data.schedules;
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (Array.isArray(parsed) && parsed.length > 0) {
              schedules = parsed;
            }
          } catch (e) {
            // Manter padrão
          }
        } else if (data.day_of_week !== undefined) {
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

        inMemoryState.config = {
          id: data.id,
          isActive: data.is_active ?? false,
          groupId: data.group_id ?? '',
          groupName: data.group_name ?? '',
          dayOfWeek: schedules[0]?.dayOfWeek ?? data.day_of_week ?? 1,
          sendTime: schedules[0]?.sendTime ?? data.send_time ?? '09:00',
          messageTemplate: schedules[0]?.messageTemplate ?? data.message_template ?? inMemoryState.config.messageTemplate,
          billingType: data.billing_type ?? 'general',
          pixKey: data.pix_key ?? '',
          pixType: data.pix_type ?? 'cpf',
          defaultFee: Number(data.default_fee) || 40,
          schedules: schedules,
          matchGroupId: data.match_group_id ?? inMemoryState.config.matchGroupId ?? '',
          matchGroupName: data.match_group_name ?? inMemoryState.config.matchGroupName ?? '',
          matchMessageTemplate: data.match_template ?? inMemoryState.config.matchMessageTemplate ?? DEFAULT_MATCH_TEMPLATE,
          matchAutoSend: data.match_auto_send ?? false,
          updatedAt: data.updated_at,
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
    updatedAt: new Date().toISOString(),
  };
  inMemoryState.config = updated;

  const supabase = getAdminSupabase();
  if (supabase) {
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
        updated_at: new Date().toISOString(),
      };

      if (updated.matchGroupId !== undefined) payload.match_group_id = updated.matchGroupId;
      if (updated.matchGroupName !== undefined) payload.match_group_name = updated.matchGroupName;
      if (updated.matchMessageTemplate !== undefined) payload.match_template = updated.matchMessageTemplate;
      if (updated.matchAutoSend !== undefined) payload.match_auto_send = updated.matchAutoSend;

      const { error: upsertErr } = await supabase.from('whatsapp_config').upsert(payload);
      if (upsertErr) {
        // Se a coluna billing_schedules ainda não existir no DB do Supabase, tenta sem ela para não travar
        delete payload.billing_schedules;
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
