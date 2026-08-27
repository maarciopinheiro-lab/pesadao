import { 
  makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  WASocket,
  Browsers,
  proto,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import {
  getWhatsAppConfig,
  saveWhatsAppConfig,
  logWhatsAppMessage,
  hasMessageBeenSentThisWeek,
  addSystemLog,
  getPlayersFromDb,
  getMatchesFromDb,
  getAdminSupabase,
  enqueueMessage,
  getPendingQueueMessages,
  lockQueueMessage,
  updateQueueMessageStatus,
  updateWhatsAppSessionInDb,
} from './supabaseAdmin';
import { useSupabaseAuthState, memCache } from './supabaseAuthState';
import { WhatsAppGroup, WhatsAppSessionInfo, WhatsAppConfig } from '../types';

function normalizeJid(jid: string): string {
  if (!jid) return '';
  const clean = jid.trim();
  if (clean.includes('@')) {
    return clean.replace('@c.us', '@s.whatsapp.net');
  }
  if (clean.includes('-') || clean.length > 15) {
    return `${clean}@g.us`;
  }
  return `${clean.replace(/\D/g, '')}@s.whatsapp.net`;
}

class WhatsAppService {
  private sock: WASocket | null = null;
  private qrCodeDataUrl: string | null = null;
  private rawQr: string | null = null;
  private status: WhatsAppSessionInfo['status'] = 'disconnected';
  private phoneNumber: string | null = null;
  private lastConnected: string | null = null;
  private lastError: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private cronJob: cron.ScheduledTask | null = null;
  private isConnecting = false;
  private reconnectInProgress = false;
  private pairingInProgress = false;
  private isProcessingQueue = false;
  private isManualDisconnect = false;

  private keepAliveInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initCron();
    
    // EVITAR CONFLITO DE INSTÂNCIAS (AI Studio vs Render):
    // Se estivermos rodando no ambiente de desenvolvimento do AI Studio (detectado pelo APPLET_ID ou K_SERVICE),
    // desativamos o keep-alive e auto-resume automáticos em segundo plano.
    // Isso é crítico porque senão a instância de desenvolvimento aqui fica "derrubando" a conexão do servidor de produção no Render,
    // criando um loop eterno de reconexões.
    const isAIStudioPreview = !!process.env.APPLET_ID || !!process.env.K_SERVICE;
    
    if (isAIStudioPreview) {
      console.log('[WhatsAppService] [AI_STUDIO_PREVIEW_DETECTED] Desativando auto-conexão e keep-alive automático em background para não derrubar a sua conexão ativa no Render.');
      this.status = 'disconnected';
    } else {
      this.startKeepAlive();
      // Auto-resume único no boot se existirem credenciais salvas no Supabase
      setTimeout(() => {
        this.tryAutoResumeConnection();
      }, 1500);
    }
  }

  private startKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    // Verificação de integridade e auto-recuperação (Self-Healing) gratuita a cada 30 segundos
    this.keepAliveInterval = setInterval(async () => {
      // 1. Se estiver conectado, enviar ping para manter o socket acordado
      if (this.sock && this.status === 'connected') {
        try {
          const ws = (this.sock as any)?.ws;
          if (ws && ws.readyState === 1 && typeof ws.ping === 'function') {
            ws.ping();
          }
        } catch (e) {}
        return;
      }

      // 2. Auto-recuperação: se não estiver conectado, mas temos credenciais salvas no Supabase, reconectar silenciosamente
      if (!this.isManualDisconnect && !this.isConnecting && this.status !== 'pairing' && this.status !== 'qr_ready') {
        const supabase = getAdminSupabase();
        if (supabase) {
          try {
            const { hasSavedAuth } = await useSupabaseAuthState(supabase);
            const hasAuth = await hasSavedAuth();
            if (hasAuth && (!this.sock || this.status !== 'connected')) {
              console.log('[WhatsAppService] [SELF_HEALING] Sessão salva detectada no banco. Restaurando conexão automaticamente...');
              this.internalConnect(true).catch((e) => {
                console.warn('[WhatsAppService] [SELF_HEALING] Tentativa em background falhou, tentará no próximo ciclo:', e?.message);
              });
            }
          } catch (e) {}
        }
      }
    }, 30000);
  }

  private async tryAutoResumeConnection() {
    const supabase = getAdminSupabase();
    if (!supabase) return;
    try {
      const { hasSavedAuth } = await useSupabaseAuthState(supabase);
      const isSaved = await hasSavedAuth();
      if (isSaved) {
        console.log('[WhatsAppService] [AUTH_LOADED] Sessão autenticada encontrada no Supabase. Restaurando conexão automaticamente...');
        await this.internalConnect(true);
      } else {
        console.log('[WhatsAppService] [AUTH_LOADED] Nenhuma sessão prévia autenticada. Aguardando comando do usuário.');
        this.status = 'disconnected';
        await updateWhatsAppSessionInDb(this.getSessionInfo());
      }
    } catch (e) {
      console.warn('[WhatsAppService] Falha ao verificar sessão salva no startup:', e);
    }
  }

  public getSessionInfo(): WhatsAppSessionInfo {
    return {
      status: this.status,
      phoneNumber: this.phoneNumber,
      qrCode: this.qrCodeDataUrl,
      error: this.lastError,
      lastConnected: this.lastConnected,
    };
  }

  public async getEffectiveSessionInfo(): Promise<WhatsAppSessionInfo> {
    return this.getSessionInfo();
  }

  private cleanOldSocket() {
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners('connection.update');
        this.sock.ev.removeAllListeners('creds.update');
        this.sock.end(undefined);
      } catch (e) {}
      this.sock = null;
    }
  }

  public async connect(force = false): Promise<WhatsAppSessionInfo> {
    // 1. Se já está conectado, retorna estado atual
    if (!force && this.sock && this.status === 'connected') {
      console.log('[WhatsAppService] [CONNECT_IGNORED_ALREADY_RUNNING] WhatsApp já está conectado.');
      await updateWhatsAppSessionInDb(this.getSessionInfo());
      return this.getSessionInfo();
    }

    // 2. Se for chamado pelo usuário enquanto está conectando ou com QR pronto, e não for forçado, apenas retorna
    if (!force && (this.isConnecting || this.status === 'connecting' || (this.status === 'qr_ready' && this.qrCodeDataUrl) || this.status === 'pairing')) {
      console.log(`[WhatsAppService] [CONNECT_IGNORED_ALREADY_RUNNING] Operação em andamento com status: ${this.status}`);
      return this.getSessionInfo();
    }

    // Se estava em reconexão ou se force=true, cancela timer de reconexão anterior e prossegue
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectInProgress = false;

    return await this.internalConnect(force);
  }

  private async internalConnect(force = false): Promise<WhatsAppSessionInfo> {
    if (this.isConnecting && !force) {
      return this.getSessionInfo();
    }

    this.isConnecting = true;
    if (this.status !== 'pairing' && this.status !== 'reconnecting') {
      this.status = 'connecting';
    }
    this.lastError = null;
    await updateWhatsAppSessionInDb(this.getSessionInfo());

    // Limpa socket anterior
    this.cleanOldSocket();

    const supabase = getAdminSupabase();
    if (!supabase) {
      this.status = 'error';
      this.lastError = 'Erro: Supabase não está configurado.';
      this.isConnecting = false;
      await updateWhatsAppSessionInDb(this.getSessionInfo());
      return this.getSessionInfo();
    }

    try {
      console.log('[WhatsAppService] [CONNECT_REQUEST] Carregando credenciais e criando socket Baileys...');
      const { state, saveCreds } = await useSupabaseAuthState(supabase);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] as [number, number, number] }));

      const silentLogger = pino({ level: 'silent' });

      this.sock = makeWASocket({
        version,
        logger: silentLogger,
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.macOS('Desktop'),
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 60_000,
        keepAliveIntervalMs: 25_000,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: false,
        retryRequestDelayMs: 500,
        maxMsgRetryCount: 5,
        getMessage: async () => {
          return proto.Message.fromObject({});
        },
      });

      console.log('[WhatsAppService] [SOCKET_CREATED] Instância WASocket criada com sucesso.');

      this.sock.ev.on('creds.update', async () => {
        try {
          await saveCreds();
          console.log('[WhatsAppService] [AUTH_SAVED] Credenciais atualizadas gravadas no Supabase.');
        } catch (e) {
          console.error('[WhatsAppService] Erro ao salvar creds no Supabase:', e);
        }
      });

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.rawQr = qr;
          try {
            this.qrCodeDataUrl = await QRCode.toDataURL(qr, {
              width: 320,
              margin: 2,
              color: {
                dark: '#000000',
                light: '#ffffff',
              },
            });
            if (this.status !== 'pairing') {
              this.status = 'qr_ready';
            }
            this.isConnecting = false;
            console.log('[WhatsAppService] [QR_RECEIVED] QR Code válido gerado e disponibilizado.');
            await updateWhatsAppSessionInDb(this.getSessionInfo());
            await addSystemLog('QR_CODE_GENERATED', 'Novo QR Code gerado para conexão do WhatsApp.', 'info');
          } catch (qrErr) {
            console.error('[WhatsAppService] Erro gerando QR Code:', qrErr);
          }
        }

        if (connection === 'connecting') {
          console.log(`[WhatsAppService] [CONNECTING] Handshake de conexão em andamento (status atual: ${this.status})...`);
        }

        if (connection === 'open') {
          this.status = 'connected';
          this.qrCodeDataUrl = null;
          this.rawQr = null;
          this.reconnectAttempts = 0;
          this.lastError = null;
          this.lastConnected = new Date().toISOString();
          this.pairingInProgress = false;
          this.isConnecting = false;
          this.reconnectInProgress = false;

          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }

          // Extrair número conectado
          const userJid = this.sock?.user?.id;
          if (userJid) {
            const rawPhone = userJid.split('@')[0].split(':')[0];
            this.phoneNumber = rawPhone.length > 10 ? `+${rawPhone}` : rawPhone;
          } else {
            this.phoneNumber = 'Conectado';
          }

          await saveCreds(); // Persiste credenciais autenticadas imediatamente
          console.log(`[WhatsAppService] [CONNECTED] WhatsApp conectado com sucesso! Número: ${this.phoneNumber}`);
          console.log('[WhatsAppService] [AUTH_SAVED] Sessão autenticada persistida no Supabase.');
          await updateWhatsAppSessionInDb(this.getSessionInfo());
          await addSystemLog(
            'WHATSAPP_CONNECTED',
            `WhatsApp conectado com sucesso. Número: ${this.phoneNumber}`,
            'info',
            { phoneNumber: this.phoneNumber }
          );

          // Processar mensagens pendentes da fila que aguardavam conexão
          setImmediate(() => {
            this.processPendingQueue().catch((err) => {
              console.error('[WhatsAppService] Erro ao processar fila pós-conexão:', err);
            });
          });
        }

        if (connection === 'close') {
          this.isConnecting = false;
          if (this.isManualDisconnect) {
            console.log('[WhatsAppService] [CONNECTION_CLOSED] Conexão finalizada manualmente pelo usuário.');
            return;
          }

          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403;
          const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;

          console.log(`[WhatsAppService] [CONNECTION_CLOSED] Conexão fechada. StatusCode: ${statusCode}, RestartRequired: ${isRestartRequired}, LoggedOut: ${isLoggedOut}`);

          if (isLoggedOut) {
            this.status = 'disconnected';
            this.phoneNumber = null;
            this.qrCodeDataUrl = null;
            this.rawQr = null;
            this.pairingInProgress = false;
            this.reconnectInProgress = false;
            this.reconnectAttempts = 0;
            this.lastError = 'Sessão desconectada pelo aplicativo do WhatsApp no celular.';
            console.log('[WhatsAppService] [LOGGED_OUT] Sessão desvinculada no celular. Limpando credenciais...');
            await this.clearAuthFiles();
            await updateWhatsAppSessionInDb(this.getSessionInfo());
            await addSystemLog(
              'WHATSAPP_LOGGED_OUT',
              'A conta foi desvinculada do WhatsApp pelo usuário.',
              'warn'
            );
          } else if (isRestartRequired) {
            // Código 515 emitido pelo WhatsApp logo após o escaneamento do QR Code
            this.status = 'pairing';
            this.pairingInProgress = true;
            this.qrCodeDataUrl = null;
            this.rawQr = null;
            console.log('[WhatsAppService] [PAIRING] WhatsApp solicitou reinício (515/RestartRequired após pareamento). Reconectando com novas credenciais...');
            await updateWhatsAppSessionInDb(this.getSessionInfo());
            this.cleanOldSocket();
            setTimeout(() => {
              this.internalConnect(true).catch((err) => {
                console.error('[WhatsAppService] Erro ao reconectar pós-pareamento:', err);
              });
            }, 1000);
          } else {
            // Desconexão temporária por rede / keepalive
            const { hasSavedAuth } = await useSupabaseAuthState(supabase);
            const hasAuth = await hasSavedAuth();

            if (hasAuth) {
              this.status = 'reconnecting';
              this.lastError = 'Reconectando ao WhatsApp...';
              await updateWhatsAppSessionInDb(this.getSessionInfo());
              this.scheduleReconnect();
            } else {
              console.log('[WhatsAppService] Conexão não-autenticada encerrada (QR Code expirado ou timeout). Resetando estado.');
              this.status = 'disconnected';
              this.qrCodeDataUrl = null;
              this.rawQr = null;
              this.pairingInProgress = false;
              this.reconnectInProgress = false;
              this.reconnectAttempts = 0;
              this.lastError = 'QR Code expirou. Clique em Conectar para gerar um novo QR Code.';
              await updateWhatsAppSessionInDb(this.getSessionInfo());
            }
          }
        }
      });

      return this.getSessionInfo();
    } catch (err: any) {
      this.isConnecting = false;
      this.status = 'error';
      this.lastError = err?.message || 'Falha ao iniciar cliente WhatsApp';
      console.error('[WhatsAppService] Erro ao conectar:', err);
      await updateWhatsAppSessionInDb(this.getSessionInfo());
      await addSystemLog('WHATSAPP_CONNECTION_ERROR', `Erro de conexão: ${this.lastError}`, 'error');
      return this.getSessionInfo();
    }
  }

  private scheduleReconnect() {
    // Se estiver no AI Studio, cancelamos a reconexão automática em segundo plano para não "roubar" a sessão do seu Render.
    const isAIStudioPreview = !!process.env.APPLET_ID || !!process.env.K_SERVICE;
    if (isAIStudioPreview) {
      console.log('[WhatsAppService] [RECONNECT_CANCELLED_IN_DEV] Reconexão automática em background cancelada no ambiente de testes para evitar derrubar o seu Render.');
      this.status = 'disconnected';
      this.reconnectInProgress = false;
      this.isConnecting = false;
      updateWhatsAppSessionInDb(this.getSessionInfo()).catch(() => {});
      return;
    }

    if (this.reconnectInProgress) {
      console.log('[WhatsAppService] [RECONNECT_IGNORED] Reconexão já agendada ou em andamento.');
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.reconnectAttempts++;
    this.reconnectInProgress = true;

    // Backoff inteligente progressivo: 2s, 5s, 10s, 20s, 30s... (máximo 60s)
    const backoffDelays = [2000, 5000, 10000, 20000, 30000, 60000];
    const delay = backoffDelays[Math.min(this.reconnectAttempts - 1, backoffDelays.length - 1)];

    console.log(`[WhatsAppService] [RECONNECT_SCHEDULED] Tentativa #${this.reconnectAttempts} agendada para daqui a ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectInProgress = false;
      console.log(`[WhatsAppService] [RECONNECT_STARTED] Executando tentativa de reconexão #${this.reconnectAttempts}...`);
      this.internalConnect(true).catch((err) => {
        console.error('[WhatsAppService] Erro na rotina de reconexão:', err);
      });
    }, delay);
  }

  public async ensureConnected(timeoutMs = 12000): Promise<boolean> {
    if (this.sock && this.status === 'connected') {
      return true;
    }

    console.log('[WhatsAppService] Conexão inativa detectada ao realizar operação. Tentando reconectar automaticamente...');
    
    // Iniciar conexão se não estiver conectando
    if (this.status !== 'connecting' && this.status !== 'pairing') {
      this.connect().catch(err => {
        console.error('[WhatsAppService] Falha ao tentar conectar sob demanda:', err);
      });
    }

    // Aguardar até que mude para connected
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.sock && this.status === 'connected') {
        console.log('[WhatsAppService] Reconexão automática sob demanda concluída com sucesso!');
        return true;
      }
      if (this.status === 'qr_ready' || this.status === 'error' || (this.status === 'disconnected' && !this.isConnecting)) {
        console.log(`[WhatsAppService] Abortando espera de conexão automática, status atual: ${this.status}`);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return Boolean(this.sock && this.status === 'connected');
  }

  public async disconnect(): Promise<void> {
    this.isManualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.reconnectInProgress = false;
    this.isConnecting = false;
    this.pairingInProgress = false;

    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners('connection.update');
        this.sock.ev.removeAllListeners('creds.update');
        await this.sock.logout().catch(() => {});
        this.sock.end(undefined);
      } catch (e) {
        // Ignore errors during socket close
      }
      this.sock = null;
    }

    await this.clearAuthFiles();
    this.status = 'disconnected';
    this.phoneNumber = null;
    this.qrCodeDataUrl = null;
    this.rawQr = null;
    this.lastError = null;
    this.lastConnected = null;

    await updateWhatsAppSessionInDb(this.getSessionInfo());
    await addSystemLog('WHATSAPP_DISCONNECTED', 'WhatsApp desconectado com sucesso e credenciais limpas.', 'info');
    this.isManualDisconnect = false;
  }

  public async switchNumber(): Promise<WhatsAppSessionInfo> {
    await addSystemLog('SWITCH_NUMBER_INITIATED', 'Iniciando troca de número do WhatsApp.', 'info');
    await this.disconnect();
    this.reconnectAttempts = 0;
    return await this.connect();
  }

  private async clearAuthFiles() {
    try {
      memCache.clear();
      const supabase = getAdminSupabase();
      if (supabase) {
        const { data } = await supabase.from('whatsapp_auth').select('id');
        if (data && data.length > 0) {
          const ids = data.map((r: any) => r.id);
          for (let i = 0; i < ids.length; i += 50) {
            const chunk = ids.slice(i, i + 50);
            await supabase.from('whatsapp_auth').delete().in('id', chunk);
          }
        }
        console.log('[WhatsAppService] Credenciais de autenticação removidas do banco de dados.');
      }
    } catch (e) {
      console.error('[WhatsAppService] Erro ao limpar auth no banco:', e);
    }
  }

  public async getGroups(): Promise<WhatsAppGroup[]> {
    const supabase = getAdminSupabase();

    // 1. Buscar grupos ao vivo se conectado via WhatsApp
    if (this.sock && this.status === 'connected') {
      try {
        const groupsData = await this.sock.groupFetchAllParticipating();
        const groupsList: WhatsAppGroup[] = Object.values(groupsData).map((g: any) => ({
          id: g.id,
          name: g.subject || 'Grupo sem nome',
          participantsCount: g.participants?.length || 0,
          desc: g.desc ? g.desc.toString() : undefined,
        }));

        groupsList.sort((a, b) => a.name.localeCompare(b.name));

        // Salvar em cache no Supabase para acesso contínuo mesmo desconectado
        if (supabase && groupsList.length > 0) {
          supabase
            .from('whatsapp_auth')
            .upsert({
              id: 'cached_whatsapp_groups',
              data: groupsList,
              updated_at: new Date().toISOString(),
            })
            .then(() => {})
            .catch(() => {});
        }

        return groupsList;
      } catch (err: any) {
        console.warn('[WhatsAppService] Falha ao buscar grupos ao vivo:', err?.message || err);
      }
    }

    // 2. Se não estiver conectado ou falhar, recuperar do cache no Supabase
    if (supabase) {
      try {
        const { data } = await supabase
          .from('whatsapp_auth')
          .select('data')
          .eq('id', 'cached_whatsapp_groups')
          .maybeSingle();

        if (data && data.data && Array.isArray(data.data) && data.data.length > 0) {
          console.log(`[WhatsAppService] Retornando ${data.data.length} grupos a partir do cache do Supabase.`);
          return data.data;
        }
      } catch (e) {}
    }

    return [];
  }

  public async generateFormattedMessage(
    customTemplate?: string,
    billingType?: 'general' | 'detailed',
    clientPlayers?: any[],
    targetMonthKey?: string
  ): Promise<string> {
    const config = await getWhatsAppConfig();
    const template = customTemplate || config.messageTemplate;
    const type = billingType || config.billingType;

    const now = new Date();
    const monthNames = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
    ];
    const dataStr = `${monthNames[now.getMonth()]}/${now.getFullYear()}`;
    const weekNumber = this.getCurrentWeekNumber(now);
    const semanaStr = `Semana ${weekNumber}`;

    const currentMonthKey = targetMonthKey || `${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getFullYear()}`;

    // Buscar dados do banco ou usar do cliente se fornecido
    const players = clientPlayers && clientPlayers.length > 0 ? clientPlayers : await getPlayersFromDb();

    let paidCount = 0;
    let pendingCount = 0;
    let totalCollected = 0;
    let totalPending = 0;
    const paidNames: string[] = [];
    const pendingNames: string[] = [];

    players.forEach((p: any) => {
      // Excluir goleiros da cobrança se configurado ou se goleiro
      if (p.position === 'GOL') return;
      if (p.status === 'injured') return; // Afastados não entram na pendência

      let isPaid = false;

      // Verificar histórico de pagamentos (tanto formato do cliente quanto do DB)
      if (p.paymentHistory && typeof p.paymentHistory === 'object') {
        isPaid = !!p.paymentHistory[currentMonthKey];
      } else if (p.payment_date) {
        try {
          const parsed = typeof p.payment_date === 'string' ? JSON.parse(p.payment_date) : p.payment_date;
          if (typeof parsed === 'object' && parsed !== null) {
            isPaid = !!parsed[currentMonthKey];
          } else {
            isPaid = String(p.payment_date).includes(currentMonthKey);
          }
        } catch (e) {
          isPaid = String(p.payment_date).includes(currentMonthKey);
        }
      } else if (p.is_paid !== undefined) {
        isPaid = !!p.is_paid;
      } else if (p.isPaid !== undefined) {
        isPaid = !!p.isPaid;
      }

      const val = Number(p.value) || config.defaultFee || 40;
      const playerName = (p.name || 'Atleta').trim();

      if (isPaid) {
        paidCount++;
        totalCollected += val;
        paidNames.push(playerName);
      } else {
        pendingCount++;
        totalPending += val;
        pendingNames.push(playerName);
      }
    });

    let pixTipoFormatted = 'Chave';
    if (config.pixType === 'cpf') pixTipoFormatted = 'CPF';
    else if (config.pixType === 'cnpj') pixTipoFormatted = 'CNPJ';
    else if (config.pixType === 'phone') pixTipoFormatted = 'Telefone';
    else if (config.pixType === 'email') pixTipoFormatted = 'E-mail';
    else if (config.pixType === 'random') pixTipoFormatted = 'Aleatória';

    // Formatação em lista (bullets)
    const listaPagosBullets = paidNames.length > 0
      ? paidNames.map((n) => `• ✅ ${n}`).join('\n')
      : '• _Nenhum pagamento registrado ainda_';

    const listaPendentesBullets = pendingNames.length > 0
      ? pendingNames.map((n) => `• ⏳ ${n}`).join('\n')
      : '• _Todos os atletas estão com a mensalidade em dia! 👏_';

    // Formatação em linha
    const listaPagosLinha = paidNames.length > 0 ? paidNames.join(', ') : 'Nenhum';
    const listaPendentesLinha = pendingNames.length > 0 ? pendingNames.join(', ') : 'Nenhum';

    let pendingListLegacy = '';
    if (type === 'detailed' && pendingNames.length > 0) {
      pendingListLegacy = `\n📋 *Atletas Pendentes:*\n${listaPendentesBullets}`;
    }

    const replacements: Record<string, string> = {
      '{valor}': (config.defaultFee || 40).toFixed(2).replace('.', ','),
      '{pix}': config.pixKey || '[NÃO CONFIGURADO]',
      '{pix_tipo}': pixTipoFormatted,
      '{nome_grupo}': config.groupName || 'Pesadão F.C.',
      '{data}': dataStr,
      '{semana}': semanaStr,
      '{total_pendentes}': pendingCount.toString(),
      '{total_pago}': paidCount.toString(),
      '{total_confirmados}': paidCount.toString(),
      '{total_arrecadado}': `R$ ${totalCollected.toFixed(2).replace('.', ',')}`,
      '{total_pendente}': `R$ ${totalPending.toFixed(2).replace('.', ',')}`,
      '{lista_pagos}': listaPagosBullets,
      '{lista_confirmados}': listaPagosBullets,
      '{lista_pendentes}': listaPendentesBullets,
      '{lista_pagos_linha}': listaPagosLinha,
      '{lista_confirmados_linha}': listaPagosLinha,
      '{lista_pendentes_linha}': listaPendentesLinha,
    };

    let result = template;
    for (const [key, val] of Object.entries(replacements)) {
      result = result.split(key).join(val);
    }

    return result;
  }

  public getCurrentReferenceWeek(): string {
    const { year, month, day } = this.getBrazilTimeInfo();
    // Criar uma data determinística baseada no fuso horário de Brasília
    const brazilDate = new Date(year, month - 1, day);
    const week = this.getCurrentWeekNumber(brazilDate);
    return `${year}-W${week.toString().padStart(2, '0')}`;
  }

  private getCurrentWeekNumber(d: Date): number {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  public async sendTestMessage(customTemplate?: string, clientPlayers?: any[], targetMonthKey?: string, idempotencyKey?: string): Promise<{ success: boolean; status?: string; message: string }> {
    const config = await getWhatsAppConfig();
    if (!config.groupId) {
      throw new Error('Nenhum grupo do WhatsApp foi selecionado nas configurações.');
    }

    const baseMessage = await this.generateFormattedMessage(customTemplate, undefined, clientPlayers, targetMonthKey);
    const testMessageText = `🤖 *TESTE DE AUTOMAÇÃO - APP PESADÃO*\n_Esta é uma mensagem de teste enviada pelo painel administrativo._\n\n${baseMessage}`;
    const refWeek = this.getCurrentReferenceWeek();
    const executionKey = idempotencyKey || `test_billing_${config.groupId}_${refWeek}_${Date.now()}`;

    const queueRes = await enqueueMessage({
      tipo: 'test',
      destino: config.groupId,
      mensagem: testMessageText,
      executionKey: executionKey,
    });

    // Iniciar processamento da fila em segundo plano imediatamente
    setImmediate(() => {
      this.processPendingQueue().catch((err) => {
        console.error('[WhatsAppService] Erro ao processar fila em background após teste:', err);
      });
    });

    return {
      success: true,
      status: queueRes.status,
      message: queueRes.message,
    };
  }

  public async formatMatchReport(matchData: any, customTemplate?: string): Promise<string> {
    const config = await getWhatsAppConfig();
    const template = customTemplate || config.matchMessageTemplate || `⚽ *RELATÓRIO PÓS-JOGO - {nome_time}* ⚽

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

    const players = await getPlayersFromDb();

    const opponent = matchData.opponent || 'Adversário';
    const homeScore = Number(matchData.homeScore ?? matchData.home_score ?? 0);
    const awayScore = Number(matchData.awayScore ?? matchData.away_score ?? 0);
    const placar = `${homeScore} x ${awayScore}`;
    const resultado = homeScore > awayScore ? 'VITÓRIA 🏆' : homeScore < awayScore ? 'DERROTA ❌' : 'EMPATE 🤝';

    // Data & Horário formatados
    let dataFormatted = matchData.date || '';
    if (dataFormatted.includes('-')) {
      const parts = dataFormatted.split('-');
      if (parts.length === 3) {
        dataFormatted = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
    }
    const horario = matchData.time || '08:00';
    const local = matchData.location || 'Campo do Pesadão';

    // Artilheiros
    let artilheirosText = '';
    const lineup = typeof matchData.lineup === 'string' ? JSON.parse(matchData.lineup || '{}') : (matchData.lineup || {});

    const goalScorers: { name: string; goals: number }[] = [];

    // Se tiver matchPlayerStats direto ou lineup
    if (matchData.matchPlayerStats) {
      for (const [pid, stat] of Object.entries<any>(matchData.matchPlayerStats)) {
        if (stat && stat.goals > 0) {
          const player = players.find((p: any) => p.id.toString() === pid.toString());
          const name = player ? player.name.split(' ')[0] : `Atleta #${pid}`;
          goalScorers.push({ name, goals: stat.goals });
        }
      }
    } else {
      for (const [pid, pdata] of Object.entries<any>(lineup)) {
        const g = Number(pdata?.goals || 0);
        if (g > 0) {
          const player = players.find((p: any) => p.id.toString() === pid.toString());
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
    for (const [pid, pdata] of Object.entries<any>(lineup)) {
      if (pdata?.starterPos !== undefined) {
        const player = players.find((p: any) => p.id.toString() === pid.toString());
        if (player) {
          startersList.push(player.name.split(' ')[0]);
        }
      }
    }
    const titularesText = startersList.length > 0 ? startersList.join(', ') : 'Escalação do quadro titular';

    // Observações
    const observacoes = matchData.comments || 'Partida com grande entrega e espírito de equipe!';

    const replacements: Record<string, string> = {
      '{adversario}': opponent,
      '{placar}': placar,
      '{gols_pesadao}': homeScore.toString(),
      '{gols_adversario}': awayScore.toString(),
      '{resultado}': resultado,
      '{data}': dataFormatted,
      '{horario}': horario,
      '{local}': local,
      '{artilheiros}': artilheirosText,
      '{titulares}': titularesText,
      '{observacoes}': observacoes,
      '{nome_time}': 'Pesadão F.C.',
      '{total_gols}': (homeScore + awayScore).toString(),
    };

    let result = template;
    for (const [key, val] of Object.entries(replacements)) {
      result = result.split(key).join(val);
    }
    return result;
  }

  public async sendMatchReport(matchData: any, customTemplate?: string, targetGroupId?: string, idempotencyKey?: string): Promise<{ success: boolean; status?: string; message: string }> {
    const config = await getWhatsAppConfig();
    const destGroupId = targetGroupId || config.matchGroupId || config.groupId;

    if (!destGroupId) {
      throw new Error('Nenhum grupo de WhatsApp configurado para envio do pós-jogo.');
    }

    const messageText = await this.formatMatchReport(matchData, customTemplate);
    const matchIdentifier = matchData?.id || matchData?.date || Date.now();
    const executionKey = idempotencyKey || `match_report_${matchIdentifier}_${matchData?.homeScore ?? 0}x${matchData?.awayScore ?? 0}`;

    const queueRes = await enqueueMessage({
      tipo: 'match_report',
      destino: destGroupId,
      mensagem: messageText,
      executionKey: executionKey,
    });

    // Disparar processamento da fila em segundo plano imediatamente
    setImmediate(() => {
      this.processPendingQueue().catch((err) => {
        console.error('[WhatsAppService] Erro ao processar fila em background após relatório de jogo:', err);
      });
    });

    return {
      success: true,
      status: queueRes.status,
      message: queueRes.message,
    };
  }

  public async sendMatchTestMessage(idempotencyKey?: string): Promise<{ success: boolean; status?: string; message: string }> {
    const config = await getWhatsAppConfig();
    const destGroupId = config.matchGroupId || config.groupId;
    if (!destGroupId) {
      throw new Error('Nenhum grupo selecionado para envio do pós-jogo nas configurações.');
    }

    const dummyMatch = {
      opponent: 'Real Madruga F.C.',
      homeScore: 4,
      awayScore: 2,
      date: new Date().toISOString().split('T')[0],
      time: '08:00',
      location: 'Arena Pesadão - Campo 1',
      comments: 'Grande atuação com pressão ofensiva e vitória convincente!',
      lineup: {
        '1': { goals: 2, starterPos: 5 },
        '2': { goals: 1, starterPos: 4 },
        '3': { goals: 1, starterPos: 3 },
      },
    };

    const formatted = await this.formatMatchReport(dummyMatch);
    const testText = `🤖 *TESTE DE RELATÓRIO PÓS-JOGO*\n_Esta é uma mensagem de demonstração do pós-jogo._\n\n${formatted}`;
    const executionKey = idempotencyKey || `match_test_${destGroupId}_${Date.now()}`;

    const queueRes = await enqueueMessage({
      tipo: 'match_test',
      destino: destGroupId,
      mensagem: testText,
      executionKey: executionKey,
    });

    setImmediate(() => {
      this.processPendingQueue().catch((err) => {
        console.error('[WhatsAppService] Erro ao processar fila em background após teste de jogo:', err);
      });
    });

    return {
      success: true,
      status: queueRes.status,
      message: queueRes.message,
    };
  }

  public async triggerManualSend(customTemplate?: string, clientPlayers?: any[], targetMonthKey?: string, scheduleId?: string, idempotencyKey?: string): Promise<{ success: boolean; status?: string; message: string }> {
    return await this.executeWeeklyBilling('manual', customTemplate, clientPlayers, targetMonthKey, scheduleId, undefined, idempotencyKey);
  }

  public async executeWeeklyBilling(
    triggerType: 'auto' | 'manual' = 'auto',
    customTemplate?: string,
    clientPlayers?: any[],
    targetMonthKey?: string,
    scheduleId?: string,
    scheduleTitle?: string,
    idempotencyKey?: string,
    isScheduleEnabled = true
  ): Promise<{ success: boolean; status?: string; message: string }> {
    const config = await getWhatsAppConfig();

    if (triggerType === 'auto' && !isScheduleEnabled) {
      return { success: false, message: 'Este disparo específico está desativado.' };
    }

    if (!config.groupId) {
      const errMsg = 'Nenhum grupo de WhatsApp configurado para envio.';
      await addSystemLog('EXECUTION_SKIPPED', errMsg, 'warn');
      return { success: false, message: errMsg };
    }

    const baseWeek = this.getCurrentReferenceWeek();
    const refWeek = scheduleId ? `${baseWeek}_slot${scheduleId}` : baseWeek;
    const executionKey = idempotencyKey || (
      triggerType === 'auto'
        ? `billing_weekly_${config.groupId}_${refWeek}`
        : `billing_manual_${config.groupId}_${refWeek}_${Date.now()}`
    );

    // PROTEÇÃO CONTRA DUPLICIDADE:
    // Se for execução automática, verificar se já foi enviada nesta semana para este slot específico
    if (triggerType === 'auto') {
      const alreadySent = await hasMessageBeenSentThisWeek(config.groupId, refWeek);
      if (alreadySent) {
        const msg = `Envio ignorado: Cobrança (${scheduleTitle || `Disparo ${scheduleId || 1}`}) já foi enviada nesta semana (${baseWeek}) para o grupo ${config.groupName || config.groupId}.`;
        await addSystemLog('SCHEDULED_SKIPPED_DUPLICATE', msg, 'info', { refWeek, groupId: config.groupId });
        return { success: true, status: 'sent', message: msg };
      }
    }

    const finalMessage = await this.generateFormattedMessage(customTemplate, undefined, clientPlayers, targetMonthKey);

    const queueRes = await enqueueMessage({
      tipo: 'billing',
      destino: config.groupId,
      mensagem: finalMessage,
      executionKey: executionKey,
    });

    // Disparar processamento da fila imediatamente
    setImmediate(() => {
      this.processPendingQueue().catch((err) => {
        console.error('[WhatsAppService] Erro ao processar fila em background após cobrança:', err);
      });
    });

    return {
      success: true,
      status: queueRes.status,
      message: queueRes.message,
    };
  }

  // Helper para obter dados de data/hora no fuso horário de Brasília (100% determinístico e à prova de falhas)
  private getBrazilTimeInfo(date = new Date()) {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      hour12: false,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    const parts = dtf.formatToParts(date);
    const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';

    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const weekdayStr = getPart('weekday');
    const brazilDay = weekdayMap[weekdayStr] ?? date.getDay();
    const hour = parseInt(getPart('hour'), 10) || 0;
    const minute = parseInt(getPart('minute'), 10) || 0;
    const second = parseInt(getPart('second'), 10) || 0;
    const year = parseInt(getPart('year'), 10) || date.getFullYear();
    const month = parseInt(getPart('month'), 10) || date.getMonth() + 1;
    const day = parseInt(getPart('day'), 10) || date.getDate();

    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const currentMins = hour * 60 + minute;
    const dateStr = `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;

    return { brazilDay, hour, minute, second, currentMins, timeStr, dateStr, year, month, day };
  }

  // Enfileira disparos automáticos programados da semana atual que já passaram do horário
  public async enqueueDueSchedules(forceAll = false): Promise<number> {
    const config = await getWhatsAppConfig();
    if (!config.groupId) {
      console.log('[WhatsAppService] Nenhum grupo de WhatsApp configurado para os agendamentos.');
      return 0;
    }

    const { brazilDay, currentMins } = this.getBrazilTimeInfo();

    const schedules = (config.schedules && config.schedules.length > 0)
      ? config.schedules
      : [
          {
            id: '1',
            title: '1º Disparo (Lembrete Inicial)',
            enabled: true,
            dayOfWeek: config.dayOfWeek ?? 1,
            sendTime: config.sendTime ?? '09:00',
            messageTemplate: config.messageTemplate,
          },
        ];

    let enqueuedCount = 0;
    const baseWeek = this.getCurrentReferenceWeek();

    for (const sched of schedules) {
      if (!sched.enabled && !forceAll) continue;

      const [targetHour, targetMinute] = (sched.sendTime || '09:00').split(':').map(Number);
      const targetMins = (targetHour || 0) * 60 + (targetMinute || 0);

      // O disparo é devido se forceAll for true OU (hoje é o dia do disparo e o horário já chegou)
      const isDue = forceAll || (brazilDay === sched.dayOfWeek && currentMins >= targetMins);

      if (isDue) {
        const refWeek = `${baseWeek}_slot${sched.id}`;
        const alreadySent = !forceAll && await hasMessageBeenSentThisWeek(config.groupId, refWeek);

        if (!alreadySent) {
          const executionKey = forceAll
            ? `billing_force_${config.groupId}_${refWeek}_${Date.now()}`
            : `billing_weekly_${config.groupId}_${refWeek}`;

          const formattedMessage = await this.generateFormattedMessage(sched.messageTemplate);

          const res = await enqueueMessage({
            tipo: 'billing',
            destino: config.groupId,
            mensagem: formattedMessage,
            executionKey: executionKey,
          });

          if (res.success) {
            enqueuedCount++;
          }
        }
      }
    }

    return enqueuedCount;
  }

  // Processa as mensagens pendentes da fila de forma segura e não concorrente
  public async processPendingQueue(): Promise<{ success: boolean; processed: number; failures: number }> {
    if (this.isProcessingQueue) {
      console.log('[WhatsAppService] Processamento de fila já em andamento, aguardando término...');
      return { success: true, processed: 0, failures: 0 };
    }

    this.isProcessingQueue = true;

    try {
      const pendingMessages = await getPendingQueueMessages();
      if (pendingMessages.length === 0) {
        return { success: true, processed: 0, failures: 0 };
      }

      const config = await getWhatsAppConfig();
      const provider = config.provider || 'baileys';

      console.log(`[WhatsAppService] Processando ${pendingMessages.length} mensagens na fila de envio.`);
      let processed = 0;
      let failures = 0;

      for (const item of pendingMessages) {
        // Tentar travar a mensagem atomicamente
        const locked = await lockQueueMessage(item.id);
        if (!locked) {
          console.log(`[WhatsAppService] Mensagem id ${item.id} já bloqueada por outro processo. Ignorando.`);
          continue;
        }

        try {
          if (!this.sock || this.status !== 'connected') {
            console.log('[WhatsAppService] WhatsApp desconectado. Tentando restabelecer conexão...');
            const connected = await this.ensureConnected(15000);
            if (!connected) {
              console.error('[WhatsAppService] Falha ao restabelecer conexão do WhatsApp para envio da fila.');
              await updateQueueMessageStatus(item.id, 'failed', {
                error: 'WhatsApp desconectado no momento do envio.',
                attempts: (item.attempts || 0) + 1,
              });
              failures++;
              continue;
            }
          }

          const targetJid = normalizeJid(item.destino);
          await this.sock.sendMessage(targetJid, { text: item.mensagem });

          // Atualizar status na fila para sent
          await updateQueueMessageStatus(item.id, 'sent', {
            attempts: (item.attempts || 0) + 1,
          });

          // Registrar no log de mensagens
          await logWhatsAppMessage({
            groupId: item.destino,
            groupName: item.destino.includes('@g.us') ? (config.matchGroupId === item.destino ? config.matchGroupName : config.groupName) || 'Grupo WhatsApp' : 'Contato WhatsApp',
            type: item.tipo === 'match_report' ? 'match_report' : item.tipo === 'test' ? 'test' : item.tipo === 'match_test' ? 'match_test' : 'auto',
            status: 'sent',
            referenceWeek: item.execution_key || this.getCurrentReferenceWeek(),
            message: item.mensagem,
          });

          processed++;
        } catch (err: any) {
          console.error(`[WhatsAppService] Falha ao enviar mensagem da fila id ${item.id}:`, err?.message || err);

          const currentAttempts = (item.attempts || 0) + 1;
          const nextStatus = currentAttempts >= (item.max_attempts || 3) ? 'failed' : 'pending';

          await updateQueueMessageStatus(item.id, nextStatus, {
            error: err.message || `Erro no envio via ${provider}`,
            attempts: currentAttempts,
          });
          failures++;
        }
      }

      return { success: true, processed, failures };
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private initCron() {
    // Se estiver rodando no ambiente de desenvolvimento do AI Studio, nós NÃO iniciamos o cron automático de 1 minuto.
    // Isso é essencial para que a nossa instância de testes aqui não processe a fila de mensagens ou envie agendamentos
    // duplicados ao mesmo tempo que o seu servidor de produção oficial do Render está ligado e monitorando o banco.
    const isAIStudioPreview = !!process.env.APPLET_ID || !!process.env.K_SERVICE;
    if (isAIStudioPreview) {
      console.log('[WhatsAppService] [AI_STUDIO_PREVIEW_DETECTED] Cron de checagem automática e envio em segundo plano desativado no ambiente de testes para evitar disparos duplicados ou conflitos com o Render.');
      return;
    }

    // Roda a cada minuto para checar se deve disparar cobrança e processar fila
    this.cronJob = cron.schedule('* * * * *', async () => {
      try {
        await this.checkCronTrigger();
        await this.processPendingQueue();
      } catch (err) {
        console.error('[WhatsAppService] Erro no cron scheduler:', err);
      }
    });

    console.log('[WhatsAppService] Agendador e processador da fila semanal inicializado.');
  }

  // Checa e dispara agendamentos semanais ativos de forma resiliente
  public async checkCronTrigger(forceAll = false): Promise<{ triggered: number; details: string[] }> {
    const config = await getWhatsAppConfig();
    if (!config.groupId) {
      return { triggered: 0, details: ['Nenhum grupo de WhatsApp configurado para os envios.'] };
    }

    const { brazilDay, timeStr, currentMins, hour, minute } = this.getBrazilTimeInfo();

    const schedules = (config.schedules && config.schedules.length > 0)
      ? config.schedules
      : [
          {
            id: '1',
            title: '1º Disparo (Lembrete Inicial)',
            enabled: true,
            dayOfWeek: config.dayOfWeek ?? 1,
            sendTime: config.sendTime ?? '09:00',
            messageTemplate: config.messageTemplate,
          },
        ];

    const baseWeek = this.getCurrentReferenceWeek();
    let triggered = 0;
    const details: string[] = [];

    for (const sched of schedules) {
      if (!sched.enabled && !forceAll) {
        details.push(`Slot #${sched.id} (${sched.title}): Desabilitado`);
        continue;
      }

      const [targetHour, targetMinute] = (sched.sendTime || '09:00').split(':').map(Number);
      const targetMins = (targetHour || 0) * 60 + (targetMinute || 0);

      // O disparo é devido se forceAll for true OU (hoje é o dia da semana configurado e o horário atual já atingiu ou passou o horário marcado)
      const isDueToday = forceAll || (brazilDay === sched.dayOfWeek && currentMins >= targetMins);

      if (isDueToday) {
        const refWeek = `${baseWeek}_slot${sched.id}`;
        const alreadySent = !forceAll && await hasMessageBeenSentThisWeek(config.groupId, refWeek);

        if (!alreadySent) {
          console.log(`[WhatsAppService] [CRON_TRIGGER_DUE] Executando disparo programado (${sched.title || `Slot ${sched.id}`} - ${timeStr}) para grupo ${config.groupId}`);
          await this.executeWeeklyBilling(
            'auto',
            sched.messageTemplate,
            undefined,
            undefined,
            sched.id,
            sched.title,
            forceAll ? `billing_force_${config.groupId}_${refWeek}_${Date.now()}` : undefined,
            true
          );
          triggered++;
          details.push(`Slot #${sched.id} (${sched.title}): Disparado com sucesso às ${timeStr}`);
        } else {
          // Logar apenas no minuto exato para auditar sem entupir o banco de dados
          const isExactlyNow = hour === targetHour && minute === targetMinute;
          if (isExactlyNow) {
            const skipMsg = `O disparo automático programado das ${sched.sendTime} (Slot #${sched.id} - ${sched.title}) foi ignorado nesta semana (${baseWeek}) para o grupo "${config.groupName || config.groupId}" porque o envio já foi realizado anteriormente (Chave de envio: ${refWeek}).`;
            await addSystemLog('SCHEDULED_SKIPPED_DUPLICATE', skipMsg, 'info', { refWeek, groupId: config.groupId });
          }
          details.push(`Slot #${sched.id} (${sched.title}): Já enviado esta semana (${refWeek})`);
        }
      } else {
        const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
        details.push(`Slot #${sched.id} (${sched.title}): Programado para ${dayNames[sched.dayOfWeek]} às ${sched.sendTime} (Hoje é ${dayNames[brazilDay]} às ${timeStr})`);
      }
    }

    return { triggered, details };
  }
}

export const whatsappService = new WhatsAppService();
