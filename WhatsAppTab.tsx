import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Player, WhatsAppConfig, WhatsAppGroup, WhatsAppMessageLog, WhatsAppSessionInfo, WhatsAppStatus, WhatsAppSystemLog } from './types';
import {
  connectWhatsApp,
  disconnectWhatsApp,
  getWhatsAppConfig,
  getWhatsAppGroups,
  getWhatsAppHistory,
  getWhatsAppLogs,
  getWhatsAppStatus,
  previewWhatsAppMessage,
  previewMatchWhatsAppMessage,
  saveWhatsAppConfig,
  sendNow,
  sendTestMessage,
  sendMatchTestWhatsAppMessage,
  switchWhatsAppNumber,
} from './whatsappClient';

interface WhatsAppTabProps {
  players: Player[];
  selectedDate: Date;
  matches?: any[];
}

export const DEFAULT_BILLING_TEMPLATE_1 = `💰 *1º LEMBRETE SEMANAL - {nome_grupo}*

Fala, guerreiros! Passando no início da semana para lembrar da nossa contribuição do mês de *{data}* ({semana}).

💵 *Valor:* R$ {valor}
🔑 *Chave PIX ({pix_tipo}):* {pix}

📊 *STATUS DOS PAGAMENTOS:*
✅ *Confirmados / Pagos ({total_pago}):*
{lista_pagos}

⏳ *Pendentes ({total_pendentes}):*
{lista_pendentes}

Quem já realizou o pagamento via PIX, favor enviar o comprovante para confirmação. Valeu! ⚽🔥`;

export const DEFAULT_BILLING_TEMPLATE_2 = `⚡ *ATUALIZAÇÃO DO CAIXA (MEIO DE SEMANA) - {nome_grupo}*

Fala time! Passando para atualizar a lista dos confirmados da mensalidade de *{data}*.

💵 *Valor:* R$ {valor}
🔑 *Chave PIX ({pix_tipo}):* {pix}
💰 *Total Arrecadado:* {total_arrecadado} | *Falta Arrecadar:* {total_pendente}

✅ *JÁ CONFIRMADOS ({total_pago}):*
{lista_pagos}

⏳ *AINDA PENDENTES ({total_pendentes}):*
{lista_pendentes}

Bora regularizar quem ainda não pagou para mantermos tudo organizado pro próximo jogo! Tmj! ⚽👊`;

export const DEFAULT_BILLING_TEMPLATE_3 = `🚨 *ÚLTIMO AVISO / FECHAMENTO DA SEMANA - {nome_grupo}*

Atenção rapaziada! Estamos fechando o caixa da semana e ainda temos pendências da mensalidade de *{data}*.

💵 *Valor:* R$ {valor}
🔑 *Chave PIX ({pix_tipo}):* {pix}

⏳ *ATLETAS PENDENTES ({total_pendentes}):*
{lista_pendentes}

✅ *CONFIRMADOS / PAGOS ({total_pago}):*
{lista_pagos_linha}

Pedimos a gentileza de regularizarem via PIX o quanto antes para fecharmos a rodada sem pendências. Bora pro jogo! ⚽🔥`;

export const DEFAULT_BILLING_TEMPLATE = DEFAULT_BILLING_TEMPLATE_1;

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

export const getEffectiveSchedules = (cfg: WhatsAppConfig) => {
  const list = Array.isArray(cfg.schedules) ? [...cfg.schedules] : [];
  const defaultSchedules = [
    {
      id: '1',
      title: '1º Disparo (Início da Semana)',
      enabled: cfg.isActive ?? true,
      dayOfWeek: cfg.dayOfWeek ?? 1,
      sendTime: cfg.sendTime || '09:00',
      messageTemplate: cfg.messageTemplate || DEFAULT_BILLING_TEMPLATE_1,
    },
    {
      id: '2',
      title: '2º Disparo (Meio da Semana)',
      enabled: false,
      dayOfWeek: 3,
      sendTime: '18:00',
      messageTemplate: DEFAULT_BILLING_TEMPLATE_2,
    },
    {
      id: '3',
      title: '3º Disparo (Fim da Semana / Fechamento)',
      enabled: false,
      dayOfWeek: 5,
      sendTime: '17:00',
      messageTemplate: DEFAULT_BILLING_TEMPLATE_3,
    },
  ];

  return defaultSchedules.map((def, idx) => {
    const existing = list.find((s) => s.id === def.id) || list[idx];
    if (existing) {
      return {
        id: def.id,
        title: existing.title || def.title,
        enabled: existing.enabled !== undefined ? existing.enabled : def.enabled,
        dayOfWeek: existing.dayOfWeek !== undefined ? existing.dayOfWeek : def.dayOfWeek,
        sendTime: existing.sendTime || def.sendTime,
        messageTemplate: existing.messageTemplate || def.messageTemplate,
      };
    }
    return def;
  });
};

export const WhatsAppTab: React.FC<WhatsAppTabProps> = ({ players, selectedDate, matches = [] }) => {
  // Session State
  const [session, setSession] = useState<WhatsAppSessionInfo>({
    status: 'disconnected',
    phoneNumber: null,
    qrCode: null,
    error: null,
  });
  const [isPolling, setIsPolling] = useState(true);

  // Config State
  const [config, setConfig] = useState<WhatsAppConfig>({
    isActive: false,
    groupId: '',
    groupName: '',
    dayOfWeek: 1, // Segunda-feira
    sendTime: '09:00',
    messageTemplate: DEFAULT_BILLING_TEMPLATE_1,
    billingType: 'general',
    pixKey: '',
    pixType: 'cpf',
    defaultFee: 40,
    matchGroupId: '',
    matchGroupName: '',
    matchMessageTemplate: DEFAULT_MATCH_TEMPLATE,
    matchAutoSend: false,
    schedules: [
      {
        id: '1',
        title: '1º Disparo (Início da Semana)',
        enabled: true,
        dayOfWeek: 1,
        sendTime: '09:00',
        messageTemplate: DEFAULT_BILLING_TEMPLATE_1,
      },
      {
        id: '2',
        title: '2º Disparo (Meio da Semana)',
        enabled: false,
        dayOfWeek: 3,
        sendTime: '18:00',
        messageTemplate: DEFAULT_BILLING_TEMPLATE_2,
      },
      {
        id: '3',
        title: '3º Disparo (Fim da Semana / Fechamento)',
        enabled: false,
        dayOfWeek: 5,
        sendTime: '17:00',
        messageTemplate: DEFAULT_BILLING_TEMPLATE_3,
      },
    ],
  });

  // Schedule UI State (Editing & Preview)
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>('1');
  const [previewScheduleId, setPreviewScheduleId] = useState<string>('1');
  const [isScheduleExpanded, setIsScheduleExpanded] = useState<boolean>(false);

  // Groups & Data
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [history, setHistory] = useState<WhatsAppMessageLog[]>([]);
  const [logs, setLogs] = useState<WhatsAppSystemLog[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'config' | 'match_config' | 'history' | 'logs'>('config');

  // Preview States
  const [liveBillingPreview, setLiveBillingPreview] = useState<string>('');
  const [previewWeek, setPreviewWeek] = useState<string>('');
  const [liveMatchPreview, setLiveMatchPreview] = useState<string>('');

  // UI state
  const [savingConfig, setSavingConfig] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [sendingMatchTest, setSendingMatchTest] = useState(false);
  const [sendingManual, setSendingManual] = useState(false);
  const [feedbackToast, setFeedbackToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [showSwitchModal, setShowSwitchModal] = useState(false);
  const [selectedMessageForModal, setSelectedMessageForModal] = useState<WhatsAppMessageLog | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'billing' | 'match' | 'test'>('all');
  const [logFilter, setLogFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');

  const billingTextareaRef = useRef<HTMLTextAreaElement>(null);
  const matchTextareaRef = useRef<HTMLTextAreaElement>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setFeedbackToast({ text, type });
    setTimeout(() => setFeedbackToast(null), 4000);
  };

  // Initial load
  useEffect(() => {
    loadInitialData();
  }, []);

  // Polling for WhatsApp status while in connecting / qr_ready mode
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isPolling) {
      interval = setInterval(async () => {
        try {
          const s = await getWhatsAppStatus();
          setSession(s);
          if (s.status === 'connected' && groups.length === 0) {
            loadGroups();
          }
        } catch (e) {
          // ignore
        }
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPolling, groups.length]);

  const currentSchedules = useMemo(() => getEffectiveSchedules(config), [config.schedules, config.isActive, config.dayOfWeek, config.sendTime, config.messageTemplate]);
  
  const activeEditingSchedule = useMemo(() => {
    return currentSchedules.find((s) => s.id === selectedScheduleId) || currentSchedules[0];
  }, [currentSchedules, selectedScheduleId]);

  const updateSchedule = (scheduleId: string, updates: Partial<any>) => {
    const list = getEffectiveSchedules(config);
    const updatedList = list.map((s) => (s.id === scheduleId ? { ...s, ...updates } : s));
    const anyActive = updatedList.some((s) => s.enabled);
    const s1 = updatedList[0];

    setConfig((prev) => ({
      ...prev,
      schedules: updatedList,
      isActive: anyActive,
      dayOfWeek: s1 ? s1.dayOfWeek : prev.dayOfWeek,
      sendTime: s1 ? s1.sendTime : prev.sendTime,
      messageTemplate: s1 ? s1.messageTemplate : prev.messageTemplate,
    }));
  };

  const restoreScheduleTemplate = (scheduleId: string) => {
    let defaultCopy = DEFAULT_BILLING_TEMPLATE_1;
    if (scheduleId === '2') defaultCopy = DEFAULT_BILLING_TEMPLATE_2;
    if (scheduleId === '3') defaultCopy = DEFAULT_BILLING_TEMPLATE_3;
    updateSchedule(scheduleId, { messageTemplate: defaultCopy });
    showToast(`Template padrão restaurado para o disparo ${scheduleId}!`, 'success');
  };

  // Update live previews
  useEffect(() => {
    generateBillingPreview();
  }, [config.schedules, previewScheduleId, config.messageTemplate, config.billingType, config.pixKey, config.pixType, config.defaultFee, config.groupName, players, selectedDate]);

  useEffect(() => {
    generateMatchPreview();
  }, [config.matchMessageTemplate, config.matchGroupName, matches]);

  const loadInitialData = async () => {
    try {
      const [s, c, h, l] = await Promise.all([
        getWhatsAppStatus().catch(() => ({ status: 'disconnected' as WhatsAppStatus })),
        getWhatsAppConfig().catch(() => null),
        getWhatsAppHistory().catch(() => []),
        getWhatsAppLogs().catch(() => []),
      ]);

      if (s) {
        setSession(s);
      }
      if (c) {
        setConfig((prev) => ({
          ...prev,
          ...c,
          schedules: c.schedules && c.schedules.length > 0 ? c.schedules : prev.schedules,
          matchMessageTemplate: c.matchMessageTemplate || DEFAULT_MATCH_TEMPLATE,
        }));
      }
      if (h) setHistory(h);
      if (l) setLogs(l);

      if (s && s.status === 'connected') {
        loadGroups();
      }
    } catch (err) {
      console.error('Erro ao carregar dados iniciais do WhatsApp:', err);
    }
  };

  const loadGroups = async () => {
    setLoadingGroups(true);
    try {
      const g = await getWhatsAppGroups();
      setGroups(g);
    } catch (err: any) {
      console.warn('Não foi possível carregar grupos:', err.message);
    } finally {
      setLoadingGroups(false);
    }
  };

  const refreshHistoryAndLogs = async () => {
    try {
      const [h, l] = await Promise.all([getWhatsAppHistory(), getWhatsAppLogs()]);
      setHistory(h);
      setLogs(l);
    } catch (e) {
      // ignore
    }
  };

  const getMonthKey = (d: Date) => `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getFullYear()}`;

  const currentMonthKey = getMonthKey(selectedDate);
  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  const formattedMonthName = `${monthNames[selectedDate.getMonth()]} de ${selectedDate.getFullYear()}`;

  const eligiblePlayers = useMemo(() => {
    return players.filter((p) => p.position !== 'GOL' && p.status !== 'injured');
  }, [players]);

  const livePaidPlayers = useMemo(() => {
    return eligiblePlayers.filter((p) => {
      if (p.paymentHistory && typeof p.paymentHistory === 'object') {
        return !!p.paymentHistory[currentMonthKey];
      }
      if (p.paymentDate) {
        return p.paymentDate.includes(currentMonthKey);
      }
      return !!p.isPaid;
    });
  }, [eligiblePlayers, currentMonthKey]);

  const livePendingPlayers = useMemo(() => {
    return eligiblePlayers.filter((p) => {
      if (p.paymentHistory && typeof p.paymentHistory === 'object') {
        return !p.paymentHistory[currentMonthKey];
      }
      if (p.paymentDate) {
        return !p.paymentDate.includes(currentMonthKey);
      }
      return !p.isPaid;
    });
  }, [eligiblePlayers, currentMonthKey]);

  const liveTotalCollected = useMemo(() => {
    return livePaidPlayers.reduce((acc, p) => acc + (p.value || config.defaultFee || 40), 0);
  }, [livePaidPlayers, config.defaultFee]);

  const liveTotalPending = useMemo(() => {
    return livePendingPlayers.reduce((acc, p) => acc + (p.value || config.defaultFee || 40), 0);
  }, [livePendingPlayers, config.defaultFee]);

  const generateBillingPreview = async () => {
    const dataStr = `${monthNames[selectedDate.getMonth()]}/${selectedDate.getFullYear()}`;
    const targetSched = currentSchedules.find((s) => s.id === previewScheduleId) || currentSchedules[0];
    const templateToUse = targetSched.messageTemplate || config.messageTemplate || DEFAULT_BILLING_TEMPLATE_1;

    try {
      const res = await previewWhatsAppMessage(
        templateToUse,
        config.billingType,
        players,
        currentMonthKey
      );
      setLiveBillingPreview(res.preview);
      setPreviewWeek(res.referenceWeek);
    } catch (e) {
      // Fallback local calculation directly synchronized with players and selectedDate
      let paidCount = 0;
      let pendingCount = 0;
      let totalCollected = 0;
      let totalPending = 0;
      const paidNames: string[] = [];
      const pendingNames: string[] = [];

      players.forEach((p) => {
        if (p.position === 'GOL') return;
        if (p.status === 'injured') return;

        let isPaid = false;
        if (p.paymentHistory && typeof p.paymentHistory === 'object') {
          isPaid = !!p.paymentHistory[currentMonthKey];
        } else if (p.paymentDate) {
          isPaid = p.paymentDate.includes(currentMonthKey);
        } else if (p.isPaid !== undefined) {
          isPaid = !!p.isPaid;
        }

        const val = p.value || config.defaultFee || 40;
        const name = p.name.trim();

        if (isPaid) {
          paidCount++;
          totalCollected += val;
          paidNames.push(name);
        } else {
          pendingCount++;
          totalPending += val;
          pendingNames.push(name);
        }
      });

      const listaPagosBullets = paidNames.length > 0
        ? paidNames.map((n) => `• ✅ ${n}`).join('\n')
        : '• _Nenhum pagamento registrado ainda_';

      const listaPendentesBullets = pendingNames.length > 0
        ? pendingNames.map((n) => `• ⏳ ${n}`).join('\n')
        : '• _Todos os atletas estão com a mensalidade em dia! 👏_';

      let txt = templateToUse;
      txt = txt.replace(/{nome_grupo}/g, config.groupName || 'Pesadão F.C.');
      txt = txt.replace(/{valor}/g, (config.defaultFee || 40).toFixed(2).replace('.', ','));
      txt = txt.replace(/{pix}/g, config.pixKey || '[Chave não configurada]');
      txt = txt.replace(/{pix_tipo}/g, (config.pixType || 'cpf').toUpperCase());
      txt = txt.replace(/{semana}/g, 'Semana Atual');
      txt = txt.replace(/{data}/g, dataStr);
      txt = txt.replace(/{total_pago}/g, paidCount.toString());
      txt = txt.replace(/{total_confirmados}/g, paidCount.toString());
      txt = txt.replace(/{total_pendentes}/g, pendingCount.toString());
      txt = txt.replace(/{total_arrecadado}/g, `R$ ${totalCollected.toFixed(2).replace('.', ',')}`);
      txt = txt.replace(/{total_pendente}/g, `R$ ${totalPending.toFixed(2).replace('.', ',')}`);
      txt = txt.replace(/{lista_pagos}/g, listaPagosBullets);
      txt = txt.replace(/{lista_confirmados}/g, listaPagosBullets);
      txt = txt.replace(/{lista_pendentes}/g, listaPendentesBullets);
      txt = txt.replace(/{lista_pagos_linha}/g, paidNames.join(', ') || 'Nenhum');
      txt = txt.replace(/{lista_confirmados_linha}/g, paidNames.join(', ') || 'Nenhum');
      txt = txt.replace(/{lista_pendentes_linha}/g, pendingNames.join(', ') || 'Nenhum');
      setLiveBillingPreview(txt);
    }
  };

  const generateMatchPreview = async () => {
    try {
      const sampleMatch = matches.find((m) => m.isFinished) || {
        opponent: 'Real Madruga F.C.',
        homeScore: 3,
        awayScore: 1,
        date: new Date().toISOString().split('T')[0],
        time: '08:30',
        location: 'Campo do Pesadão',
        comments: 'Partida impecável com grande atuação da zaga e do meio-campo!',
        lineup: {
          '1': { goals: 2, starterPos: 5 },
          '2': { goals: 1, starterPos: 4 },
        },
      };

      const res = await previewMatchWhatsAppMessage(sampleMatch, config.matchMessageTemplate);
      setLiveMatchPreview(res.preview);
    } catch (e) {
      let txt = config.matchMessageTemplate || DEFAULT_MATCH_TEMPLATE;
      txt = txt.replace(/{nome_time}/g, 'Pesadão F.C.');
      txt = txt.replace(/{adversario}/g, 'Real Madruga F.C.');
      txt = txt.replace(/{placar}/g, '3 x 1');
      txt = txt.replace(/{resultado}/g, 'VITÓRIA 🏆');
      txt = txt.replace(/{data}/g, '24/08/2026');
      txt = txt.replace(/{horario}/g, '08:30');
      txt = txt.replace(/{local}/g, 'Campo do Pesadão');
      txt = txt.replace(/{artilheiros}/g, '• ⚽ *Bruninho* (2 gols)\n• ⚽ *Vitinho* (1 gol)');
      txt = txt.replace(/{titulares}/g, 'Goleiro, Zagueiro 1, Zagueiro 2, Meio 1, Meio 2, Atacante');
      txt = txt.replace(/{observacoes}/g, 'Partida impecável com grande atuação coletiva!');
      setLiveMatchPreview(txt);
    }
  };

  const handleConnect = async () => {
    try {
      showToast('Iniciando conexão do WhatsApp...', 'success');
      const s = await connectWhatsApp();
      setSession(s);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Tem certeza de que deseja desconectar o WhatsApp?')) return;
    try {
      await disconnectWhatsApp();
      setSession({ status: 'disconnected', phoneNumber: null, qrCode: null });
      showToast('WhatsApp desconectado com sucesso.', 'success');
      refreshHistoryAndLogs();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleSwitchNumber = async () => {
    setShowSwitchModal(false);
    try {
      showToast('Preparando para conectar novo número...', 'success');
      const s = await switchWhatsAppNumber();
      setSession(s);
      showToast('Sessão resetada. Escaneie o novo QR Code com o novo número.', 'success');
      refreshHistoryAndLogs();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const updated = await saveWhatsAppConfig(config);
      setConfig(updated);
      showToast('Configurações salvas com sucesso!', 'success');
      refreshHistoryAndLogs();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSendBillingTest = async (scheduleId?: string) => {
    if (session.status !== 'connected') {
      showToast('O WhatsApp precisa estar conectado para enviar mensagens.', 'error');
      return;
    }
    if (!config.groupId) {
      showToast('Selecione um grupo de cobrança nas configurações antes de testar.', 'error');
      return;
    }

    const targetSched = currentSchedules.find((s) => s.id === (scheduleId || selectedScheduleId)) || currentSchedules[0];
    const templateToSend = targetSched.messageTemplate || config.messageTemplate || DEFAULT_BILLING_TEMPLATE_1;

    setSendingTest(true);
    try {
      const currentMonthKey = getMonthKey(selectedDate);
      const idempotencyKey = `test_billing_${config.groupId}_slot${targetSched.id}_${Date.now()}`;
      const res = await sendTestMessage(templateToSend, players, currentMonthKey, idempotencyKey);
      showToast(res.message || 'Mensagem adicionada à fila de envio. O WhatsApp fará o envio automaticamente.', 'success');
      await refreshHistoryAndLogs();
    } catch (err: any) {
      showToast(err.message || 'Não foi possível preparar o envio. Tente novamente.', 'error');
      await refreshHistoryAndLogs();
    } finally {
      setSendingTest(false);
    }
  };

  const handleSendMatchTest = async () => {
    if (session.status !== 'connected') {
      showToast('O WhatsApp precisa estar conectado para enviar mensagens.', 'error');
      return;
    }
    const targetGroup = config.matchGroupId || config.groupId;
    if (!targetGroup) {
      showToast('Selecione o grupo da partida nas configurações antes de testar.', 'error');
      return;
    }

    setSendingMatchTest(true);
    try {
      const idempotencyKey = `match_test_${targetGroup}_${Date.now()}`;
      const res = await sendMatchTestWhatsAppMessage(idempotencyKey);
      showToast(res.message || 'Mensagem adicionada à fila de envio. O WhatsApp fará o envio automaticamente.', 'success');
      await refreshHistoryAndLogs();
    } catch (err: any) {
      showToast(err.message || 'Não foi possível preparar o envio. Tente novamente.', 'error');
      await refreshHistoryAndLogs();
    } finally {
      setSendingMatchTest(false);
    }
  };

  const handleSendManual = async (scheduleId?: string) => {
    if (session.status !== 'connected') {
      showToast('O WhatsApp precisa estar conectado.', 'error');
      return;
    }
    if (!config.groupId) {
      showToast('Selecione um grupo nas configurações de cobrança.', 'error');
      return;
    }

    const targetSched = currentSchedules.find((s) => s.id === (scheduleId || selectedScheduleId)) || currentSchedules[0];
    const templateToSend = targetSched.messageTemplate || config.messageTemplate || DEFAULT_BILLING_TEMPLATE_1;

    if (!window.confirm(`Deseja disparar agora a cobrança oficial (${targetSched.title}) no grupo "${config.groupName}"?`)) return;

    setSendingManual(true);
    try {
      const currentMonthKey = getMonthKey(selectedDate);
      const idempotencyKey = `manual_billing_${config.groupId}_slot${targetSched.id}_${Date.now()}`;
      const res = await sendNow(templateToSend, players, currentMonthKey, targetSched.id, idempotencyKey);
      showToast(res.message || 'Mensagem adicionada à fila de envio. O WhatsApp fará o envio automaticamente.', 'success');
      await refreshHistoryAndLogs();
    } catch (err: any) {
      showToast(err.message || 'Não foi possível preparar o envio. Tente novamente.', 'error');
      await refreshHistoryAndLogs();
    } finally {
      setSendingManual(false);
    }
  };

  const insertBillingVariable = (variableName: string) => {
    if (!billingTextareaRef.current) return;
    const textarea = billingTextareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentText = activeEditingSchedule.messageTemplate || '';
    const before = currentText.substring(0, start);
    const after = currentText.substring(end);
    const newText = `${before}${variableName}${after}`;

    updateSchedule(selectedScheduleId, { messageTemplate: newText });

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + variableName.length, start + variableName.length);
    }, 50);
  };

  const insertMatchVariable = (variableName: string) => {
    if (!matchTextareaRef.current) return;
    const textarea = matchTextareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = config.matchMessageTemplate || DEFAULT_MATCH_TEMPLATE;
    const before = text.substring(0, start);
    const after = text.substring(end);
    const newText = `${before}${variableName}${after}`;

    setConfig({ ...config, matchMessageTemplate: newText });

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + variableName.length, start + variableName.length);
    }, 50);
  };

  const filteredHistory = history.filter((item) => {
    if (historyFilter === 'billing') return item.type === 'auto' || item.type === 'manual';
    if (historyFilter === 'match') return item.type === 'match_report';
    if (historyFilter === 'test') return item.type === 'test' || item.type === 'match_test';
    return true;
  });

  const filteredLogs = logs.filter((log) => {
    if (logFilter === 'all') return true;
    return log.level === logFilter;
  });

  return (
    <div className="space-y-8 animation-fade-in pb-24">
      {/* FEEDBACK TOAST */}
      {feedbackToast && (
        <div className="fixed top-20 right-4 z-[120] animate-bounce">
          <div
            className={`px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 text-white text-xs font-bold ${
              feedbackToast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
            }`}
          >
            <span className="material-icons-outlined text-sm">
              {feedbackToast.type === 'success' ? 'check_circle' : 'error'}
            </span>
            {feedbackToast.text}
          </div>
        </div>
      )}

      {/* HEADER STATUS BAR */}
      <div className="bg-surface-light dark:bg-surface-dark rounded-3xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative overflow-hidden">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-green-500/10 flex items-center justify-center flex-shrink-0">
            <span className="material-icons-outlined text-3xl text-green-500">chat</span>
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold">Automação WhatsApp</h2>
              {session.status === 'connected' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-green-500/10 text-green-500 border border-green-500/20">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                  Conectado
                </span>
              )}
              {session.status === 'connecting' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
                  <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></span>
                  Conectando...
                </span>
              )}
              {session.status === 'pairing' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-500/10 text-purple-500 border border-purple-500/20">
                  <span className="w-2 h-2 rounded-full bg-purple-500 animate-ping"></span>
                  Pareando com celular...
                </span>
              )}
              {session.status === 'reconnecting' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                  Reconectando...
                </span>
              )}
              {session.status === 'qr_ready' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-500/10 text-blue-500 border border-blue-500/20">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  Aguardando QR Code
                </span>
              )}
              {session.status === 'disconnected' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-gray-500/10 text-gray-500 border border-gray-500/20">
                  <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                  Desconectado
                </span>
              )}
              {session.status === 'error' && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-500/10 text-red-500 border border-red-500/20">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  Erro
                </span>
              )}
            </div>
            <p className="text-xs text-muted-light dark:text-muted-dark mt-1 font-medium">
              {session.status === 'connected'
                ? `Número: ${session.phoneNumber || 'Ativo'} • Grupo Cobrança: ${config.groupName || 'Não definido'} • Grupo Jogo: ${config.matchGroupName || 'Não definido'}`
                : session.status === 'pairing'
                ? 'Pareando credenciais de criptografia com seu WhatsApp... Por favor, aguarde.'
                : 'Conecte sua conta do WhatsApp para automatizar cobranças e relatórios de partidas nos seus grupos.'}
            </p>
          </div>
        </div>

        {/* Quick Session Actions */}
        <div className="flex items-center gap-2 w-full lg:w-auto flex-wrap">
          {session.status === 'connected' ? (
            <>
              <button
                onClick={() => setShowSwitchModal(true)}
                className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-gray-100 dark:bg-black/20 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                <span className="material-icons-outlined text-sm">swap_horiz</span>
                Trocar Número
              </button>
              <button
                onClick={handleDisconnect}
                className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-red-500 bg-red-500/10 hover:bg-red-500/20 transition-colors"
              >
                <span className="material-icons-outlined text-sm">power_settings_new</span>
                Desconectar
              </button>
            </>
          ) : (
            <button
              onClick={handleConnect}
              disabled={session.status === 'connecting' || session.status === 'qr_ready' || session.status === 'pairing' || session.status === 'reconnecting'}
              className="w-full lg:w-auto flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-wider bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-600/20 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100"
            >
              <span className="material-icons-outlined text-base">qr_code_scanner</span>
              {session.status === 'pairing'
                ? 'Pareando com celular...'
                : session.status === 'connecting'
                ? 'Conectando...'
                : session.status === 'reconnecting'
                ? 'Reconectando...'
                : session.status === 'qr_ready'
                ? 'Aguardando Leitura...'
                : 'Conectar WhatsApp'}
            </button>
          )}
        </div>
      </div>

      {/* QR CODE DISPLAY BOX (WHEN CONNECTING / QR READY) */}
      {session.status === 'qr_ready' && session.qrCode && (
        <div className="bg-gradient-to-br from-green-500/10 via-surface-light dark:via-surface-dark to-surface-light dark:to-surface-dark rounded-3xl p-6 md:p-8 border-2 border-green-500/30 shadow-xl animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="flex flex-col items-center justify-center bg-white p-6 rounded-3xl shadow-inner border border-gray-200 max-w-[280px] mx-auto w-full">
              <img src={session.qrCode} alt="WhatsApp QR Code" className="w-56 h-56 object-contain" />
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mt-3 text-center">
                Aponte a câmera do WhatsApp aqui
              </p>
            </div>
            <div className="space-y-4">
              <h3 className="text-xl font-bold flex items-center gap-2 text-green-600 dark:text-green-400">
                <span className="material-icons-outlined">smartphone</span>
                Como conectar o WhatsApp:
              </h3>
              <ol className="space-y-3 text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300">
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-green-500 text-white text-xs font-black flex items-center justify-center flex-shrink-0">
                    1
                  </span>
                  <span>
                    Abra o <strong>WhatsApp</strong> no seu celular.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-green-500 text-white text-xs font-black flex items-center justify-center flex-shrink-0">
                    2
                  </span>
                  <span>
                    Toque no menu (3 pontinhos) ou <strong>Configurações</strong> &rarr; <strong>Aparelhos conectados</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-green-500 text-white text-xs font-black flex items-center justify-center flex-shrink-0">
                    3
                  </span>
                  <span>
                    Toque em <strong>Conectar um aparelho</strong> e aponte a câmera para este QR Code.
                  </span>
                </li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* SUB TABS NAVIGATION */}
      <div className="flex bg-gray-200 dark:bg-surface-dark p-1.5 rounded-2xl w-full sm:w-auto self-start border border-gray-100 dark:border-gray-800 flex-nowrap overflow-x-auto gap-1 scrollbar-none">
        <button
          onClick={() => setActiveSubTab('config')}
          className={`flex-1 sm:flex-none px-4 sm:px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 whitespace-nowrap shrink-0 ${
            activeSubTab === 'config'
              ? 'bg-white dark:bg-gray-700 shadow text-primary font-black'
              : 'text-muted-light hover:text-primary'
          }`}
        >
          <span className="material-icons-outlined text-sm">payments</span>
          Configurações de Cobrança
        </button>

        <button
          onClick={() => {
            setActiveSubTab('match_config');
            generateMatchPreview();
          }}
          className={`flex-1 sm:flex-none px-4 sm:px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 whitespace-nowrap shrink-0 ${
            activeSubTab === 'match_config'
              ? 'bg-white dark:bg-gray-700 shadow text-primary font-black'
              : 'text-muted-light hover:text-primary'
          }`}
        >
          <span className="material-icons-outlined text-sm">sports_soccer</span>
          Configurações da Partida
        </button>

        <button
          onClick={() => {
            setActiveSubTab('history');
            refreshHistoryAndLogs();
          }}
          className={`flex-1 sm:flex-none px-4 sm:px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 whitespace-nowrap shrink-0 ${
            activeSubTab === 'history'
              ? 'bg-white dark:bg-gray-700 shadow text-primary font-black'
              : 'text-muted-light hover:text-primary'
          }`}
        >
          <span className="material-icons-outlined text-sm">history</span>
          Histórico
          {history.length > 0 && (
            <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-black">
              {history.length}
            </span>
          )}
        </button>

        <button
          onClick={() => {
            setActiveSubTab('logs');
            refreshHistoryAndLogs();
          }}
          className={`flex-1 sm:flex-none px-4 sm:px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 whitespace-nowrap shrink-0 ${
            activeSubTab === 'logs'
              ? 'bg-white dark:bg-gray-700 shadow text-primary font-black'
              : 'text-muted-light hover:text-primary'
          }`}
        >
          <span className="material-icons-outlined text-sm">receipt_long</span>
          Diagnóstico e Logs
        </button>
      </div>

      {/* ========================================================================= */}
      {/* --- SUBTAB 1: CONFIGURAÇÃO DA COBRANÇA --- */}
      {/* ========================================================================= */}
      {activeSubTab === 'config' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-fade-in">
          {/* PAINEL DE CONTROLE E AGENDAMENTO (ESQUERDA) */}
          <div className="lg:col-span-7 space-y-6">
            {/* CARD 1: STATUS DA AUTOMAÇÃO E SELEÇÃO DE GRUPO */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-3xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm space-y-6">
              <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-4">
                <div>
                  <h3 className="text-lg font-bold">Automação de Cobrança Semanal</h3>
                  <p className="text-xs text-muted-light">Disparo automático programado para o grupo financeiro.</p>
                </div>
                <label className="cursor-pointer flex items-center gap-3">
                  <span className={`text-xs font-black uppercase ${config.isActive ? 'text-green-500' : 'text-gray-400'}`}>
                    {config.isActive ? 'ATIVADO' : 'DESATIVADO'}
                  </span>
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={config.isActive}
                    onChange={(e) => {
                      const active = e.target.checked;
                      const list = getEffectiveSchedules(config);
                      const updated = list.map((s, idx) => (idx === 0 ? { ...s, enabled: active } : s));
                      setConfig({ ...config, isActive: active, schedules: updated });
                    }}
                  />
                  <div className="w-14 h-8 bg-gray-200 dark:bg-gray-800 rounded-full peer-checked:bg-green-500 transition-all relative">
                    <div
                      className={`absolute top-1 left-1 bg-white w-6 h-6 rounded-full transition-all shadow-md ${
                        config.isActive ? 'translate-x-6' : ''
                      }`}
                    ></div>
                  </div>
                </label>
              </div>

              {/* SELEÇÃO DO GRUPO */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase text-primary tracking-widest block">
                    Grupo Destino das Cobranças (Grupo 1)
                  </label>
                  {session.status === 'connected' && (
                    <button
                      type="button"
                      onClick={loadGroups}
                      disabled={loadingGroups}
                      className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1"
                    >
                      <span className={`material-icons-outlined text-xs ${loadingGroups ? 'animate-spin' : ''}`}>
                        sync
                      </span>
                      Atualizar grupos
                    </button>
                  )}
                </div>

                {session.status !== 'connected' ? (
                  <div className="p-4 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-xs flex items-center gap-2">
                    <span className="material-icons-outlined text-base">info</span>
                    Conecte o WhatsApp para listar e selecionar o grupo.
                  </div>
                ) : groups.length === 0 ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="ID do grupo (ex: 120363...@g.us)"
                      value={config.groupId}
                      onChange={(e) => setConfig({ ...config, groupId: e.target.value })}
                      className="w-full bg-gray-100 dark:bg-black/20 border-0 rounded-2xl p-4 text-sm font-bold"
                    />
                    <button onClick={loadGroups} className="text-xs text-primary font-bold hover:underline">
                      Clique para buscar grupos no WhatsApp conectado
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={config.groupId}
                      onChange={(e) => {
                        const selected = groups.find((g) => g.id === e.target.value);
                        setConfig({
                          ...config,
                          groupId: e.target.value,
                          groupName: selected ? selected.name : config.groupName,
                        });
                      }}
                      className="w-full bg-gray-100 dark:bg-black/20 border-0 rounded-2xl p-4 text-sm font-bold appearance-none cursor-pointer focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="">-- Selecione o Grupo de Cobrança --</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.participantsCount} participantes)
                        </option>
                      ))}
                    </select>
                    {config.groupId && (
                      <p className="text-[10px] text-muted-light font-mono px-1">
                        ID: {config.groupId}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* CARD 2: PROGRAMAÇÃO SEMANAL MULTI-DISPARO (EXPANSÍVEL / ACCORDION) */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden transition-all">
              {/* CABEÇALHO DO ACCORDION (CLICÁVEL PARA EXPANDIR/RECOLHER) */}
              <button
                type="button"
                onClick={() => setIsScheduleExpanded((prev) => !prev)}
                className="w-full text-left p-6 md:p-8 flex items-center justify-between gap-4 hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors focus:outline-none"
              >
                <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
                    <span className="material-icons-outlined text-xl">event_repeat</span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">
                        Programação Semanal de Cobrança
                      </h3>
                      <span className="text-[10px] font-black uppercase tracking-wider text-primary bg-primary/10 px-2.5 py-0.5 rounded-full shrink-0">
                        {currentSchedules.filter((s) => s.enabled).length} de 3 Ativos
                      </span>
                    </div>
                    <p className="text-xs text-muted-light mt-0.5">
                      {isScheduleExpanded
                        ? 'Clique para recolher este painel de agendamento.'
                        : 'Clique para abrir e configurar os dias, horários e textos (copies) de até 3 disparos semanais.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-bold text-primary hidden sm:inline-block">
                    {isScheduleExpanded ? 'Recolher' : 'Configurar'}
                  </span>
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center bg-gray-100 dark:bg-black/20 text-gray-600 dark:text-gray-300 transition-transform duration-300 ${
                      isScheduleExpanded ? 'rotate-180 bg-primary/10 text-primary' : ''
                    }`}
                  >
                    <span className="material-icons-outlined text-lg">expand_more</span>
                  </div>
                </div>
              </button>

              {/* CONTEÚDO EXPANSÍVEL */}
              {isScheduleExpanded && (
                <div className="p-6 md:p-8 pt-0 md:pt-0 space-y-6 border-t border-gray-100 dark:border-gray-800/80 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-4 pb-1 gap-2">
                    <p className="text-xs text-muted-light">
                      Selecione um dos <strong>3 disparos</strong> abaixo para personalizar o dia da semana, o horário e a mensagem que o bot enviará:
                    </p>
                    <span className="text-[10px] font-mono font-bold text-muted-light">
                      Fuso: Horário de Brasília
                    </span>
                  </div>

                  {/* SELETOR DOS 3 DISPAROS (CARDS INTERATIVOS COM RESPONSIVIDADE) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {currentSchedules.map((sched, idx) => {
                      const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
                      const isSelected = selectedScheduleId === sched.id;
                      return (
                        <div
                          key={sched.id}
                          onClick={() => {
                            setSelectedScheduleId(sched.id);
                            setPreviewScheduleId(sched.id);
                          }}
                          className={`cursor-pointer rounded-2xl p-4 transition-all relative border ${
                            isSelected
                              ? 'border-primary bg-primary/5 shadow-md ring-2 ring-primary/20'
                              : 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-black/20 hover:border-gray-300 dark:hover:border-gray-700'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span
                              className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${
                                sched.enabled
                                  ? 'bg-green-500/10 text-green-600 dark:text-green-400 font-bold border border-green-500/20'
                                  : 'bg-gray-200 dark:bg-gray-800 text-gray-500 font-medium'
                              }`}
                            >
                              {sched.enabled ? 'Ativo' : 'Desativado'}
                            </span>
                            <span className="text-[11px] font-black text-muted-light">
                              #{idx + 1}
                            </span>
                          </div>

                          <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate">
                            {sched.title}
                          </h4>

                          <div className="mt-2 text-[11px] text-muted-light flex items-center gap-1.5 truncate">
                            <span className="material-icons-outlined text-xs shrink-0">schedule</span>
                            <span className="truncate">{dayNames[sched.dayOfWeek]}, às {sched.sendTime}</span>
                          </div>

                          <div className="mt-3 flex items-center justify-between pt-2 border-t border-black/5 dark:border-white/5">
                            <span className="text-[10px] text-primary font-bold">
                              {isSelected ? '● Editando este' : 'Clique para editar'}
                            </span>
                            <input
                              type="checkbox"
                              checked={sched.enabled}
                              onChange={(e) => {
                                e.stopPropagation();
                                updateSchedule(sched.id, { enabled: e.target.checked });
                              }}
                              className="h-4 w-4 rounded text-primary focus:ring-primary cursor-pointer"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* CAIXA DE EDIÇÃO DETALHADA DO DISPARO SELECIONADO */}
                  <div className="p-4 sm:p-5 rounded-2xl bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-gray-800 space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-gray-200 dark:border-gray-700/60 pb-3 gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="material-icons-outlined text-primary text-base shrink-0">edit_note</span>
                        <h4 className="text-sm font-black text-gray-900 dark:text-white truncate">
                          Editando: {activeEditingSchedule.title}
                        </h4>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={activeEditingSchedule.enabled}
                            onChange={(e) => updateSchedule(activeEditingSchedule.id, { enabled: e.target.checked })}
                            className="h-4 w-4 rounded text-primary focus:ring-primary cursor-pointer"
                          />
                          <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                            Ativar envio automático
                          </span>
                        </label>

                        <button
                          type="button"
                          onClick={() => restoreScheduleTemplate(activeEditingSchedule.id)}
                          className="text-[11px] font-bold text-muted-light hover:text-primary transition-colors flex items-center gap-1"
                          title="Restaurar a copy padrão sugerida para este disparo"
                        >
                          <span className="material-icons-outlined text-xs">restart_alt</span>
                          Sugerir Copy
                        </button>
                      </div>
                    </div>

                    {/* CONTROLES: NOME, DIA DA SEMANA E HORÁRIO */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                      <div>
                        <label className="text-[10px] font-black uppercase text-primary tracking-widest mb-1.5 block">
                          Nome / Título do Disparo
                        </label>
                        <input
                          type="text"
                          value={activeEditingSchedule.title}
                          onChange={(e) => updateSchedule(activeEditingSchedule.id, { title: e.target.value })}
                          placeholder="Ex: 1º Lembrete Leve"
                          className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-xs font-bold outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-black uppercase text-primary tracking-widest mb-1.5 block">
                          Dia da Semana
                        </label>
                        <select
                          value={activeEditingSchedule.dayOfWeek}
                          onChange={(e) => updateSchedule(activeEditingSchedule.id, { dayOfWeek: parseInt(e.target.value) })}
                          className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-xs font-bold appearance-none cursor-pointer outline-none focus:ring-2 focus:ring-primary/20"
                        >
                          <option value={1}>Segunda-feira</option>
                          <option value={2}>Terça-feira</option>
                          <option value={3}>Quarta-feira</option>
                          <option value={4}>Quinta-feira</option>
                          <option value={5}>Sexta-feira</option>
                          <option value={6}>Sábado</option>
                          <option value={0}>Domingo</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-black uppercase text-primary tracking-widest mb-1.5 block">
                          Horário do Envio
                        </label>
                        <input
                          type="time"
                          value={activeEditingSchedule.sendTime}
                          onChange={(e) => updateSchedule(activeEditingSchedule.id, { sendTime: e.target.value })}
                          className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-xs font-bold outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      </div>
                    </div>

                    {/* VARIÁVEIS DINÂMICAS DISPONÍVEIS */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <label className="text-[10px] font-black uppercase text-muted-light tracking-widest block">
                          Variáveis Dinâmicas do Financeiro (Clique para Inserir):
                        </label>
                        <span className="text-[10px] text-muted-light">
                          Sincronizadas com a aba Financeiro
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                        {[
                          { label: '{lista_pagos}', desc: 'Lista com nomes dos que já pagaram (com marcadores)' },
                          { label: '{lista_pendentes}', desc: 'Lista com nomes dos pendentes (com marcadores)' },
                          { label: '{total_pago}', desc: 'Quantidade de jogadores confirmados/pagos' },
                          { label: '{total_pendentes}', desc: 'Quantidade de jogadores pendentes' },
                          { label: '{total_arrecadado}', desc: 'Valor total arrecadado (R$)' },
                          { label: '{total_pendente}', desc: 'Valor total que falta arrecadar (R$)' },
                          { label: '{lista_pagos_linha}', desc: 'Nomes dos pagos em linha única' },
                          { label: '{lista_pendentes_linha}', desc: 'Nomes dos pendentes em linha única' },
                          { label: '{nome_grupo}', desc: 'Nome do grupo destino' },
                          { label: '{valor}', desc: 'Valor da mensalidade padrão' },
                          { label: '{pix}', desc: 'Chave PIX' },
                          { label: '{pix_tipo}', desc: 'Tipo da chave PIX' },
                          { label: '{data}', desc: 'Mês e ano de referência' },
                          { label: '{semana}', desc: 'Semana do ano' },
                        ].map((v) => (
                          <button
                            key={v.label}
                            type="button"
                            onClick={() => insertBillingVariable(v.label)}
                            title={v.desc}
                            className="px-2 py-1 rounded-lg text-[10px] font-mono font-bold bg-white dark:bg-gray-800 hover:bg-primary/20 hover:text-primary text-gray-700 dark:text-gray-300 transition-colors border border-black/5 dark:border-white/5 whitespace-nowrap"
                          >
                            {v.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* TEXTAREA DO TEMPLATE EXCLUSIVO DO DISPARO */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-black uppercase text-primary tracking-widest block">
                          Texto / Copy da Mensagem deste Disparo:
                        </label>
                        <span className="text-[10px] text-muted-light font-mono">
                          Disparo #{activeEditingSchedule.id}
                        </span>
                      </div>
                      <textarea
                        ref={billingTextareaRef}
                        rows={8}
                        value={activeEditingSchedule.messageTemplate}
                        onChange={(e) => updateSchedule(activeEditingSchedule.id, { messageTemplate: e.target.value })}
                        className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-3.5 sm:p-4 text-xs font-mono font-medium focus:ring-2 focus:ring-primary/20 outline-none resize-y leading-relaxed"
                      />
                    </div>

                    {/* BOTÕES RÁPIDOS DE TESTE E SALVAR */}
                    <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                      <button
                        type="button"
                        onClick={handleSaveConfig}
                        disabled={savingConfig}
                        className="w-full sm:flex-1 py-3.5 bg-primary text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-primary/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                      >
                        {savingConfig ? (
                          <span className="animate-spin border-2 border-white/20 border-t-white rounded-full w-4 h-4"></span>
                        ) : (
                          <>
                            <span className="material-icons-outlined text-base">save</span>
                            Salvar Todas as Configurações
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSendBillingTest(activeEditingSchedule.id)}
                        disabled={sendingTest || session.status !== 'connected'}
                        className="w-full sm:w-auto px-5 py-3.5 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 font-black text-xs uppercase tracking-wider rounded-xl border border-yellow-500/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {sendingTest ? (
                          <span className="animate-spin border-2 border-yellow-600/20 border-t-yellow-600 rounded-full w-4 h-4"></span>
                        ) : (
                          <>
                            <span className="material-icons-outlined text-base">science</span>
                            Testar Disparo #{activeEditingSchedule.id}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* CARD 3: DADOS PIX E FORMATO */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-3xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm space-y-6">
              <h3 className="text-lg font-bold border-b border-gray-100 dark:border-gray-800 pb-4">
                Dados Financeiros & PIX
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-primary tracking-widest mb-2 block">
                    Tipo de Chave
                  </label>
                  <select
                    value={config.pixType}
                    onChange={(e) => setConfig({ ...config, pixType: e.target.value as any })}
                    className="w-full bg-gray-100 dark:bg-black/20 border-0 rounded-2xl p-4 text-sm font-bold appearance-none cursor-pointer"
                  >
                    <option value="cpf">CPF</option>
                    <option value="cnpj">CNPJ</option>
                    <option value="phone">Celular</option>
                    <option value="email">E-mail</option>
                    <option value="random">Chave Aleatória</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] font-black uppercase text-primary tracking-widest mb-2 block">
                    Chave PIX
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: 11999999999 ou chave@pix.com"
                    value={config.pixKey}
                    onChange={(e) => setConfig({ ...config, pixKey: e.target.value })}
                    className="w-full bg-gray-100 dark:bg-black/20 border-0 rounded-2xl p-4 text-sm font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-primary tracking-widest mb-2 block">
                    Valor Padrão da Mensalidade (R$)
                  </label>
                  <input
                    type="number"
                    value={config.defaultFee || 40}
                    onChange={(e) => setConfig({ ...config, defaultFee: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-gray-100 dark:bg-black/20 border-0 rounded-2xl p-4 text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-primary tracking-widest mb-2 block">
                    Tipo de Resumo
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setConfig({ ...config, billingType: 'general' })}
                      className={`p-4 rounded-2xl text-xs font-bold border transition-all ${
                        config.billingType === 'general'
                          ? 'bg-primary/10 border-primary text-primary'
                          : 'bg-gray-100 dark:bg-black/20 border-transparent text-gray-500'
                      }`}
                    >
                      Geral
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfig({ ...config, billingType: 'detailed' })}
                      className={`p-4 rounded-2xl text-xs font-bold border transition-all ${
                        config.billingType === 'detailed'
                          ? 'bg-primary/10 border-primary text-primary'
                          : 'bg-gray-100 dark:bg-black/20 border-transparent text-gray-500'
                      }`}
                    >
                      Com Lista
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* CARD 4: STATUS DE SINCRONIZAÇÃO COM O FINANCEIRO */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-3xl p-6 border border-emerald-500/30 bg-emerald-500/[0.02] shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-emerald-500/10 pb-3">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </span>
                  <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
                    Sincronização com o Financeiro
                  </h3>
                </div>
                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                  {formattedMonthName}
                </span>
              </div>

              <p className="text-xs text-muted-light leading-relaxed">
                O bot está 100% sincronizado com a aba <strong>Financeiro</strong>. Quando você clica que um jogador pagou, ele é transferido na mesma hora para a lista de <strong>Confirmados / Pagos</strong>!
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {/* BLOCO CONFIRMADOS / PAGOS */}
                <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    <span className="flex items-center gap-1.5">
                      <span className="material-icons-outlined text-sm text-emerald-500">check_circle</span>
                      Confirmados / Pagos ({livePaidPlayers.length})
                    </span>
                    <span className="font-mono text-[11px]">R$ {liveTotalCollected.toFixed(2).replace('.', ',')}</span>
                  </div>

                  <div className="max-h-28 overflow-y-auto pr-1 flex flex-wrap gap-1">
                    {livePaidPlayers.length > 0 ? (
                      livePaidPlayers.map((p) => (
                        <span
                          key={p.id}
                          className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-200 border border-emerald-500/30"
                        >
                          ✅ {p.name}
                        </span>
                      ))
                    ) : (
                      <span className="text-[11px] text-muted-light italic">Nenhum pagamento confirmado para este mês</span>
                    )}
                  </div>
                </div>

                {/* BLOCO PENDENTES */}
                <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-amber-700 dark:text-amber-300">
                    <span className="flex items-center gap-1.5">
                      <span className="material-icons-outlined text-sm text-amber-500">schedule</span>
                      Pendentes ({livePendingPlayers.length})
                    </span>
                    <span className="font-mono text-[11px]">R$ {liveTotalPending.toFixed(2).replace('.', ',')}</span>
                  </div>

                  <div className="max-h-28 overflow-y-auto pr-1 flex flex-wrap gap-1">
                    {livePendingPlayers.length > 0 ? (
                      livePendingPlayers.map((p) => (
                        <span
                          key={p.id}
                          className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-500/30"
                        >
                          ⏳ {p.name}
                        </span>
                      ))
                    ) : (
                      <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold">Todos pagaram! 👏</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* PAINEL LATERAL DE PRÉ-VISUALIZAÇÃO (DIREITA) */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-surface-light dark:bg-surface-dark rounded-3xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="material-icons-outlined text-green-500">visibility</span>
                  <h3 className="text-base font-bold">Prévia no WhatsApp</h3>
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  Ao Vivo
                </span>
              </div>

              {/* SELETOR DE PRÉVIA POR DISPARO */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-muted-light tracking-widest block">
                  Selecione o disparo para pré-visualizar:
                </label>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-gray-100 dark:bg-black/30 rounded-xl">
                  {currentSchedules.map((s, i) => {
                    const isPrevSelected = previewScheduleId === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setPreviewScheduleId(s.id)}
                        className={`py-1.5 px-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all truncate ${
                          isPrevSelected
                            ? 'bg-white dark:bg-gray-800 text-primary shadow-sm font-black'
                            : 'text-muted-light hover:text-gray-800 dark:hover:text-white'
                        }`}
                      >
                        {i + 1}º Disparo
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className="text-[11px] text-muted-light">
                Veja exatamente como o texto do <strong>{currentSchedules.find(s => s.id === previewScheduleId)?.title}</strong> chegará no grupo com os valores calculados:
              </p>

              {/* SIMULADOR DE BOLHA DO WHATSAPP */}
              <div className="p-4 rounded-3xl bg-[#0b141a] text-[#e9edef] border border-white/5 shadow-2xl relative">
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10 text-[10px] text-gray-400">
                  <div className="flex items-center gap-2 truncate">
                    <span className="material-icons-outlined text-sm text-green-400">group</span>
                    <span className="font-bold text-white truncate">{config.groupName || 'Grupo de Cobrança'}</span>
                  </div>
                  <span className="text-[9px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded">
                    Disparo #{previewScheduleId}
                  </span>
                </div>

                <div className="bg-[#005c4b] text-[#e9edef] rounded-2xl p-4 text-xs font-sans whitespace-pre-wrap leading-relaxed shadow-sm relative">
                  {liveBillingPreview || 'Carregando prévia...'}
                  <div className="text-[9px] text-right text-gray-300 mt-2 font-mono">
                    {currentSchedules.find(s => s.id === previewScheduleId)?.sendTime || '09:00'} ✓✓
                  </div>
                </div>
              </div>

              {/* SELO DE PROTEÇÃO CONTRA DUPLICIDADE */}
              <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-500 text-xs space-y-1">
                <div className="flex items-center gap-2 font-bold">
                  <span className="material-icons-outlined text-sm">verified_user</span>
                  Proteção Semanal Ativa ({previewWeek || '2026-W34'})
                </div>
                <p className="text-[11px] opacity-80 leading-snug">
                  O sistema previne envios repetidos da mesma rotina dentro do mesmo minuto ou semana.
                </p>
              </div>

              {/* AÇÕES DE ENVIO E COMPARTILHAMENTO */}
              <div className="pt-2 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (liveBillingPreview) {
                        navigator.clipboard.writeText(liveBillingPreview);
                        showToast('Texto copiado para a área de transferência!', 'success');
                      }
                    }}
                    className="py-2.5 px-3 bg-gray-100 dark:bg-black/30 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold text-xs rounded-2xl transition-all flex items-center justify-center gap-1.5 border border-black/5"
                  >
                    <span className="material-icons-outlined text-sm">content_copy</span>
                    Copiar Texto
                  </button>

                  <a
                    href={`https://api.whatsapp.com/send?text=${encodeURIComponent(liveBillingPreview || '')}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="py-2.5 px-3 bg-green-600 hover:bg-green-700 text-white font-bold text-xs rounded-2xl transition-all flex items-center justify-center gap-1.5 shadow-sm text-center"
                  >
                    <span className="material-icons-outlined text-sm">open_in_new</span>
                    Abrir WhatsApp
                  </a>
                </div>

                <button
                  type="button"
                  onClick={() => handleSendManual(previewScheduleId)}
                  disabled={sendingManual || session.status !== 'connected'}
                  className="w-full py-3.5 bg-gray-100 dark:bg-black/30 hover:bg-primary hover:text-white dark:hover:bg-primary text-gray-700 dark:text-gray-300 font-bold text-xs uppercase tracking-wider rounded-2xl transition-all flex items-center justify-center gap-2 border border-black/5 disabled:opacity-40"
                >
                  {sendingManual ? (
                    <span className="animate-spin border-2 border-current border-t-transparent rounded-full w-4 h-4"></span>
                  ) : (
                    <>
                      <span className="material-icons-outlined text-sm">send</span>
                      Disparar {currentSchedules.find(s => s.id === previewScheduleId)?.title} via Bot
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* --- SUBTAB 2: CONFIGURAÇÃO DA PARTIDA / PÓS-JOGO --- */}
      {/* ========================================================================= */}
      {activeSubTab === 'match_config' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-fade-in">
          {/* PAINEL ESQUERDA: CONFIG DO GRUPO E TEMPLATE */}
          <div className="lg:col-span-7 space-y-6">
            {/* CARD 1: SELEÇÃO DO GRUPO DE PARTIDA */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-3xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm space-y-6">
              <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-4">
                <div>
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <span className="material-icons-outlined text-primary">sports_soccer</span>
                    Grupo de Disparo dos Jogos
                  </h3>
                  <p className="text-xs text-muted-light">
                    Configure o grupo oficial de jogos (diferente do grupo financeiro).
                  </p>
                </div>

                <label className="cursor-pointer flex items-center gap-3">
                  <span className={`text-xs font-black uppercase ${config.matchAutoSend ? 'text-green-500' : 'text-gray-400'}`}>
                    {config.matchAutoSend ? 'Auto-Envio' : 'Manual'}
                  </span>
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={config.matchAutoSend || false}
                    onChange={(e) => setConfig({ ...config, matchAutoSend: e.target.checked })}
                  />
                  <div className="w-14 h-8 bg-gray-200 dark:bg-gray-800 rounded-full peer-checked:bg-green-500 transition-all relative">
                    <div
                      className={`absolute top-1 left-1 bg-white w-6 h-6 rounded-full transition-all shadow-md ${
                        config.matchAutoSend ? 'translate-x-6' : ''
                      }`}
                    ></div>
                  </div>
                </label>
              </div>

              {/* SELEÇÃO DO GRUPO DA PARTIDA */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase text-primary tracking-widest block">
                    Grupo Destino das Partidas (Grupo 2 - Status do Jogo)
                  </label>
                  {session.status === 'connected' && (
                    <button
                      type="button"
                      onClick={loadGroups}
                      disabled={loadingGroups}
                      className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1"
                    >
                      <span className={`material-icons-outlined text-xs ${loadingGroups ? 'animate-spin' : ''}`}>
                        sync
                      </span>
                      Atualizar grupos
                    </button>
                  )}
                </div>

                {session.status !== 'connected' ? (
                  <div className="p-4 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-xs flex items-center gap-2">
                    <span className="material-icons-outlined text-base">info</span>
                    Conecte o WhatsApp para selecionar o grupo de jogos.
                  </div>
                ) : groups.length === 0 ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="ID do grupo de jogos (ex: 120363...@g.us)"
                      value={config.matchGroupId || ''}
                      onChange={(e) => setConfig({ ...config, matchGroupId: e.target.value })}
                      className="w-full bg-gray-100 dark:bg-black/20 border-0 rounded-2xl p-4 text-sm font-bold"
                    />
                    <button onClick={loadGroups} className="text-xs text-primary font-bold hover:underline">
                      Clique para buscar grupos no WhatsApp conectado
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={config.matchGroupId || ''}
                      onChange={(e) => {
                        const selected = groups.find((g) => g.id === e.target.value);
                        setConfig({
                          ...config,
                          matchGroupId: e.target.value,
                          matchGroupName: selected ? selected.name : config.matchGroupName,
                        });
                      }}
                      className="w-full bg-gray-100 dark:bg-black/20 border-0 rounded-2xl p-4 text-sm font-bold appearance-none cursor-pointer focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="">-- Selecione o Grupo das Partidas --</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.participantsCount} participantes)
                        </option>
                      ))}
                    </select>
                    {config.matchGroupId && (
                      <p className="text-[10px] text-muted-light font-mono px-1">
                        ID: {config.matchGroupId}
                      </p>
                    )}
                  </div>
                )}

                <div className="p-3 rounded-2xl bg-gray-100 dark:bg-black/20 text-xs text-muted-light flex items-center gap-2">
                  <span className="material-icons-outlined text-sm text-primary">alt_route</span>
                  <span>
                    <strong>Automação Separada:</strong> Cobranças vão para o <em>Grupo 1</em> ({config.groupName || 'Cobrança'}) e Relatórios de Jogo vão para o <em>Grupo 2</em> ({config.matchGroupName || 'Partidas'}).
                  </span>
                </div>
              </div>
            </div>

            {/* CARD 2: TEMPLATE DO PÓS-JOGO */}
            <div className="bg-surface-light dark:bg-surface-dark rounded-3xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
                <div>
                  <h3 className="text-lg font-bold">Template do Relatório Pós-Jogo</h3>
                  <p className="text-xs text-muted-light">Personalize a mensagem enviada após salvar a partida.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, matchMessageTemplate: DEFAULT_MATCH_TEMPLATE })}
                  className="text-[10px] font-bold text-muted-light hover:text-primary transition-colors flex items-center gap-1"
                >
                  <span className="material-icons-outlined text-xs">restart_alt</span>
                  Restaurar Padrão
                </button>
              </div>

              {/* VARIÁVEIS DISPONÍVEIS PARA JOGOS */}
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-muted-light tracking-widest block">
                  Clique nas variáveis para inserir:
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: '{nome_time}', desc: 'Nome do time' },
                    { label: '{adversario}', desc: 'Nome do adversário' },
                    { label: '{placar}', desc: 'Placar (ex: 3 x 1)' },
                    { label: '{resultado}', desc: 'VITÓRIA / EMPATE / DERROTA' },
                    { label: '{artilheiros}', desc: 'Gols e autores' },
                    { label: '{titulares}', desc: 'Escalação titular' },
                    { label: '{data}', desc: 'Data do jogo' },
                    { label: '{horario}', desc: 'Horário do jogo' },
                    { label: '{local}', desc: 'Local da partida' },
                    { label: '{observacoes}', desc: 'Observações e destaques' },
                    { label: '{gols_pesadao}', desc: 'Gols do Pesadão' },
                    { label: '{gols_adversario}', desc: 'Gols do adversário' },
                    { label: '{total_gols}', desc: 'Total de gols' },
                  ].map((v) => (
                    <button
                      key={v.label}
                      type="button"
                      onClick={() => insertMatchVariable(v.label)}
                      title={v.desc}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold bg-gray-100 dark:bg-black/30 hover:bg-primary/20 hover:text-primary text-gray-700 dark:text-gray-300 transition-colors border border-black/5"
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* TEXTAREA DO TEMPLATE DE JOGO */}
              <div className="relative">
                <textarea
                  ref={matchTextareaRef}
                  rows={11}
                  value={config.matchMessageTemplate || DEFAULT_MATCH_TEMPLATE}
                  onChange={(e) => setConfig({ ...config, matchMessageTemplate: e.target.value })}
                  className="w-full bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 text-xs font-mono font-medium focus:ring-2 focus:ring-primary/20 outline-none resize-y leading-relaxed"
                />
              </div>

              {/* BOTAO SALVAR E TESTAR */}
              <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  disabled={savingConfig}
                  className="w-full sm:flex-1 py-4 bg-primary text-white font-black text-xs uppercase tracking-wider rounded-2xl shadow-xl shadow-primary/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  {savingConfig ? (
                    <span className="animate-spin border-2 border-white/20 border-t-white rounded-full w-4 h-4"></span>
                  ) : (
                    <>
                      <span className="material-icons-outlined text-base">save</span>
                      Salvar Configurações da Partida
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleSendMatchTest}
                  disabled={sendingMatchTest || session.status !== 'connected'}
                  className="w-full sm:w-auto px-6 py-4 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 font-black text-xs uppercase tracking-wider rounded-2xl border border-yellow-500/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {sendingMatchTest ? (
                    <span className="animate-spin border-2 border-yellow-600/20 border-t-yellow-600 rounded-full w-4 h-4"></span>
                  ) : (
                    <>
                      <span className="material-icons-outlined text-base">sports_soccer</span>
                      Enviar Teste no Grupo do Jogo
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* PAINEL DIREITA: PRÉ-VISUALIZAÇÃO AO VIVO DO PÓS-JOGO */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-surface-light dark:bg-surface-dark rounded-3xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="material-icons-outlined text-green-500">visibility</span>
                  <h3 className="text-base font-bold">Prévia do Relatório do Jogo</h3>
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  Pós-Jogo
                </span>
              </div>

              <p className="text-[11px] text-muted-light">
                Exemplo de como a mensagem final da partida chegará no grupo após você salvar a súmula:
              </p>

              {/* SIMULADOR DE BOLHA DO WHATSAPP */}
              <div className="p-4 rounded-3xl bg-[#0b141a] text-[#e9edef] border border-white/5 shadow-2xl relative">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/10 text-[10px] text-gray-400">
                  <span className="material-icons-outlined text-sm text-green-400">sports_soccer</span>
                  <span className="font-bold text-white truncate">{config.matchGroupName || config.groupName || 'Grupo das Partidas'}</span>
                </div>

                <div className="bg-[#005c4b] text-[#e9edef] rounded-2xl p-4 text-xs font-sans whitespace-pre-wrap leading-relaxed shadow-sm relative">
                  {liveMatchPreview || 'Carregando prévia do pós-jogo...'}
                  <div className="text-[9px] text-right text-gray-300 mt-2 font-mono">
                    10:30 ✓✓
                  </div>
                </div>
              </div>

              {/* AÇÕES RÁPIDAS PARA O RELATÓRIO DO JOGO */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (liveMatchPreview) {
                      navigator.clipboard.writeText(liveMatchPreview);
                      showToast('Relatório copiado para a área de transferência!', 'success');
                    }
                  }}
                  className="py-2.5 px-3 bg-gray-100 dark:bg-black/30 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold text-xs rounded-2xl transition-all flex items-center justify-center gap-1.5 border border-black/5"
                >
                  <span className="material-icons-outlined text-sm">content_copy</span>
                  Copiar Relatório
                </button>

                <a
                  href={`https://api.whatsapp.com/send?text=${encodeURIComponent(liveMatchPreview || '')}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="py-2.5 px-3 bg-green-600 hover:bg-green-700 text-white font-bold text-xs rounded-2xl transition-all flex items-center justify-center gap-1.5 shadow-sm text-center"
                >
                  <span className="material-icons-outlined text-sm">open_in_new</span>
                  Abrir WhatsApp
                </a>
              </div>

              {/* DICA DE FLUXO */}
              <div className="p-4 rounded-2xl bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 text-xs space-y-2">
                <div className="flex items-center gap-2 font-bold">
                  <span className="material-icons-outlined text-sm">bolt</span>
                  Como funciona no dia a dia:
                </div>
                <p className="text-[11px] leading-relaxed">
                  Ao preencher o placar e salvar o relatório no menu <strong>Jogos</strong>, o sistema exibirá automaticamente a opção de <strong>Compartilhar no WhatsApp</strong> com 1 clique direto para o grupo configurado.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* --- SUBTAB 3: HISTÓRICO DE ENVIOS --- */}
      {/* ========================================================================= */}
      {activeSubTab === 'history' && (
        <div className="bg-surface-light dark:bg-surface-dark rounded-3xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm space-y-6 animate-fade-in">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h3 className="text-lg font-bold flex items-center gap-2">
                <span className="material-icons-outlined text-primary">history</span>
                Histórico de Mensagens Enviadas
              </h3>
              <p className="text-xs text-muted-light">Registro completo de todos os envios automáticos, manuais e relatórios de partidas.</p>
            </div>

            {/* Filtros */}
            <div className="flex bg-gray-200 dark:bg-black/30 p-1 rounded-full text-xs flex-wrap gap-1">
              <button
                onClick={() => setHistoryFilter('all')}
                className={`px-3 py-1 rounded-full font-bold ${historyFilter === 'all' ? 'bg-white dark:bg-gray-700 shadow text-primary' : 'text-muted-light'}`}
              >
                Todas ({history.length})
              </button>
              <button
                onClick={() => setHistoryFilter('billing')}
                className={`px-3 py-1 rounded-full font-bold ${historyFilter === 'billing' ? 'bg-white dark:bg-gray-700 shadow text-primary' : 'text-muted-light'}`}
              >
                Cobranças
              </button>
              <button
                onClick={() => setHistoryFilter('match')}
                className={`px-3 py-1 rounded-full font-bold ${historyFilter === 'match' ? 'bg-white dark:bg-gray-700 shadow text-primary' : 'text-muted-light'}`}
              >
                Partidas
              </button>
              <button
                onClick={() => setHistoryFilter('test')}
                className={`px-3 py-1 rounded-full font-bold ${historyFilter === 'test' ? 'bg-white dark:bg-gray-700 shadow text-primary' : 'text-muted-light'}`}
              >
                Testes
              </button>
            </div>
          </div>

          {filteredHistory.length === 0 ? (
            <div className="py-16 text-center text-muted-light text-xs opacity-60">
              <span className="material-icons-outlined text-4xl block mb-2 opacity-30">inbox</span>
              Nenhuma mensagem registrada no histórico ainda.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 text-[10px] font-black uppercase tracking-wider text-muted-light">
                    <th className="py-3 px-2">Data & Horário</th>
                    <th className="py-3 px-2">Tipo</th>
                    <th className="py-3 px-2">Grupo Destino</th>
                    <th className="py-3 px-2">Semana / Ref</th>
                    <th className="py-3 px-2">Status</th>
                    <th className="py-3 px-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredHistory.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-black/20 transition-colors">
                      <td className="py-3 px-2 font-mono text-[11px]">
                        {new Date(item.sentAt).toLocaleString('pt-BR')}
                      </td>
                      <td className="py-3 px-2">
                        {item.type === 'auto' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-500/10 text-blue-500 border border-blue-500/20">
                            Cobrança Auto
                          </span>
                        )}
                        {item.type === 'manual' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-purple-500/10 text-purple-500 border border-purple-500/20">
                            Cobrança Manual
                          </span>
                        )}
                        {item.type === 'match_report' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-green-500/10 text-green-600 border border-green-500/20">
                            Pós-Jogo
                          </span>
                        )}
                        {item.type === 'test' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-yellow-500/10 text-yellow-600 border border-yellow-500/20">
                            Teste Cobrança
                          </span>
                        )}
                        {item.type === 'match_test' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500/10 text-amber-600 border border-amber-500/20">
                            Teste Jogo
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-2 font-bold">{item.groupName || item.groupId}</td>
                      <td className="py-3 px-2 font-mono text-muted-light">{item.referenceWeek}</td>
                      <td className="py-3 px-2">
                        {item.status === 'sent' && (
                          <span className="inline-flex items-center gap-1 text-green-500 font-bold">
                            <span className="material-icons-outlined text-xs">done_all</span>
                            Enviado
                          </span>
                        )}
                        {item.status === 'skipped_duplicate' && (
                          <span className="inline-flex items-center gap-1 text-yellow-500 font-bold">
                            <span className="material-icons-outlined text-xs">block</span>
                            Ignorado (Duplicidade)
                          </span>
                        )}
                        {item.status === 'error' && (
                          <span className="inline-flex items-center gap-1 text-red-500 font-bold" title={item.error}>
                            <span className="material-icons-outlined text-xs">error</span>
                            Erro
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-2 text-right">
                        <button
                          onClick={() => setSelectedMessageForModal(item)}
                          className="px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-black/30 hover:bg-primary/20 text-xs font-bold transition-colors"
                        >
                          Ver Texto
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* --- SUBTAB 4: DIAGNÓSTICO E LOGS --- */}
      {/* ========================================================================= */}
      {activeSubTab === 'logs' && (
        <div className="bg-surface-light dark:bg-surface-dark rounded-3xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm space-y-6 animate-fade-in">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h3 className="text-lg font-bold flex items-center gap-2">
                <span className="material-icons-outlined text-primary">receipt_long</span>
                Logs do Sistema & Diagnóstico
              </h3>
              <p className="text-xs text-muted-light">Eventos internos de conexão, agendamentos e status da automação.</p>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex bg-gray-200 dark:bg-black/30 p-1 rounded-full text-xs">
                <button
                  onClick={() => setLogFilter('all')}
                  className={`px-3 py-1 rounded-full font-bold ${logFilter === 'all' ? 'bg-white dark:bg-gray-700 shadow text-primary' : 'text-muted-light'}`}
                >
                  Todos ({logs.length})
                </button>
                <button
                  onClick={() => setLogFilter('info')}
                  className={`px-3 py-1 rounded-full font-bold ${logFilter === 'info' ? 'bg-white dark:bg-gray-700 shadow text-primary' : 'text-muted-light'}`}
                >
                  Info
                </button>
                <button
                  onClick={() => setLogFilter('warn')}
                  className={`px-3 py-1 rounded-full font-bold ${logFilter === 'warn' ? 'bg-white dark:bg-gray-700 shadow text-primary' : 'text-muted-light'}`}
                >
                  Avisos
                </button>
                <button
                  onClick={() => setLogFilter('error')}
                  className={`px-3 py-1 rounded-full font-bold ${logFilter === 'error' ? 'bg-white dark:bg-gray-700 shadow text-primary' : 'text-muted-light'}`}
                >
                  Erros
                </button>
              </div>

              <button
                onClick={refreshHistoryAndLogs}
                className="p-2 rounded-xl bg-gray-100 dark:bg-black/30 hover:bg-gray-200 transition-colors"
                title="Atualizar Logs"
              >
                <span className="material-icons-outlined text-sm">refresh</span>
              </button>
            </div>
          </div>

          <div className="font-mono text-xs max-h-96 overflow-y-auto space-y-2 p-4 rounded-2xl bg-gray-50 dark:bg-black/40 border border-gray-100 dark:border-gray-800">
            {filteredLogs.length === 0 ? (
              <p className="text-muted-light py-8 text-center">Nenhum evento registrado no log.</p>
            ) : (
              filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className={`p-2.5 rounded-xl border flex items-start gap-3 ${
                    log.level === 'error'
                      ? 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
                      : log.level === 'warn'
                      ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                      : 'bg-white/50 dark:bg-white/5 border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200'
                  }`}
                >
                  <span className="text-[10px] text-muted-light flex-shrink-0">
                    {new Date(log.timestamp).toLocaleTimeString('pt-BR')}
                  </span>
                  <span className="font-black text-[10px] uppercase px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 flex-shrink-0">
                    {log.event}
                  </span>
                  <span className="flex-1 text-[11px] leading-relaxed">{log.description}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: VER MENSAGEM DO HISTÓRICO */}
      {/* ========================================================================= */}
      {selectedMessageForModal && (
        <div className="fixed inset-0 z-[150] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-light dark:bg-surface-dark rounded-3xl max-w-lg w-full p-6 border border-gray-200 dark:border-gray-800 shadow-2xl space-y-4 animate-scale-up">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
              <h4 className="font-bold text-base flex items-center gap-2">
                <span className="material-icons-outlined text-green-500">chat</span>
                Mensagem Enviada
              </h4>
              <button
                onClick={() => setSelectedMessageForModal(null)}
                className="w-8 h-8 rounded-full bg-gray-100 dark:bg-black/30 flex items-center justify-center text-gray-500 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <p className="text-muted-light">
                <strong>Destino:</strong> {selectedMessageForModal.groupName} ({selectedMessageForModal.groupId})
              </p>
              <p className="text-muted-light">
                <strong>Enviado em:</strong> {new Date(selectedMessageForModal.sentAt).toLocaleString('pt-BR')}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-[#0b141a] text-[#e9edef] text-xs font-sans whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed border border-white/5">
              {selectedMessageForModal.message}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedMessageForModal(null)}
                className="px-5 py-2 rounded-xl bg-primary text-white text-xs font-bold"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: TROCA DE NÚMERO */}
      {/* ========================================================================= */}
      {showSwitchModal && (
        <div className="fixed inset-0 z-[150] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-light dark:bg-surface-dark rounded-3xl max-w-md w-full p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-2xl space-y-6 animate-scale-up">
            <div className="flex items-center gap-3 text-yellow-500">
              <div className="w-12 h-12 rounded-2xl bg-yellow-500/10 flex items-center justify-center flex-shrink-0">
                <span className="material-icons-outlined text-2xl">swap_horiz</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Trocar Número do WhatsApp</h3>
                <p className="text-xs text-muted-light">A sessão atual será desconectada para vincular outro aparelho.</p>
              </div>
            </div>

            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              Ao confirmar, a conexão atual com <strong>{session.phoneNumber || 'o número atual'}</strong> será encerrada e um novo QR Code será gerado para que você possa escanear com outro celular.
            </p>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowSwitchModal(false)}
                className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-black/30 text-xs font-bold hover:bg-gray-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSwitchNumber}
                className="flex-1 py-3 rounded-xl bg-primary text-white text-xs font-black uppercase tracking-wider shadow-lg shadow-primary/20 hover:bg-primary-hover transition-all"
              >
                Continuar e Trocar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
