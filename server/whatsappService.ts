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

  constructor() {
    this.initCron();
    // Auto-resume único no boot se existirem credenciais salvas no Supabase
    setTimeout(() => {
      this.tryAutoResumeConnection();
    }, 1500);
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
    if (this.sock && this.status === 'connected') {
      console.log('[WhatsAppService] [CONNECT_IGNORED_ALREADY_RUNNING] WhatsApp já está conectado.');
      await updateWhatsAppSessionInDb(this.getSessionInfo());
      return this.getSessionInfo();
    }

    // 2. Se já existe conexão ativa, QR Code válido, pareamento ou reconexão em andamento, protege contra chamadas duplicadas
    if (!force && (this.isConnecting || this.status === 'connecting' || (this.status === 'qr_ready' && this.qrCodeDataUrl) || this.status === 'pairing' || this.status === 'reconnecting')) {
      console.log(`[WhatsAppService] [CONNECT_IGNORED_ALREADY_RUNNING] Operação ignorada. Conexão já em andamento com status: ${this.status}`);
      return this.getSessionInfo();
    }

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
        browser: Browsers.ubuntu('Chrome'),
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 60_000,
        keepAliveIntervalMs: 25_000,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: false,
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
        }

        if (connection === 'close') {
          this.isConnecting = false;
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
            this.lastError = 'Sessão desconectada pelo WhatsApp.';
            console.log('[WhatsAppService] [LOGGED_OUT] Sessão finalizada. Limpando credenciais do Supabase...');
            await this.clearAuthFiles();
            await updateWhatsAppSessionInDb(this.getSessionInfo());
            await addSystemLog('WHATSAPP_LOGGED_OUT', 'A conta foi desconectada do WhatsApp.', 'warn');
          } else if (isRestartRequired) {
            // Código 515 emitido pelo WhatsApp logo após o escaneamento do QR Code
            this.status = 'pairing';
            this.pairingInProgress = true;
            this.qrCodeDataUrl = null; // Remove QR Code antigo da tela pois já foi escaneado
            this.rawQr = null;
            console.log('[WhatsAppService] [PAIRING] WhatsApp solicitou reinício (515/RestartRequired após pareamento). Reconectando com novas credenciais...');
            await updateWhatsAppSessionInDb(this.getSessionInfo());
            this.cleanOldSocket();
            setTimeout(() => {
              this.internalConnect(true).catch((err) => {
                console.error('[WhatsAppService] Erro ao reconectar pós-pareamento:', err);
              });
            }, 1500);
          } else {
            // Falha temporária de rede ou reset de conexão
            this.status = 'reconnecting';
            this.lastError = 'Conexão temporariamente interrompida. Reconectando...';
            await updateWhatsAppSessionInDb(this.getSessionInfo());
            this.scheduleReconnect();
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
    if (this.reconnectInProgress) {
      console.log('[WhatsAppService] [RECONNECT_IGNORED] Reconexão já agendada ou em andamento.');
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.reconnectInProgress = true;
    this.reconnectAttempts++;

    // Backoff progressivo: 2s, 5s, 10s, 20s
    const backoffDelays = [2000, 5000, 10000, 20000];
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
    if (this.status !== 'connecting') {
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.isConnecting = false;

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

    await updateWhatsAppSessionInDb(this.getSessionInfo());
    await addSystemLog('WHATSAPP_DISCONNECTED', 'WhatsApp desconectado com sucesso e credenciais limpas.', 'info');
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
        await supabase.from('whatsapp_auth').delete().neq('id', 'placeholder_for_delete_all');
        console.log('[WhatsAppService] Credenciais de autenticação removidas do banco de dados.');
      }
    } catch (e) {
      console.error('[WhatsAppService] Erro ao limpar auth no banco:', e);
    }
  }

  public async getGroups(): Promise<WhatsAppGroup[]> {
    const isConnected = await this.ensureConnected();
    if (!isConnected) {
      throw new Error('WhatsApp não está conectado no momento. Por favor, verifique a conexão e o QR Code.');
    }

    let attempts = 0;
    while (attempts < 3) {
      try {
        attempts++;
        const groupsData = await this.sock.groupFetchAllParticipating();
        const groupsList: WhatsAppGroup[] = Object.values(groupsData).map((g: any) => ({
          id: g.id,
          name: g.subject || 'Grupo sem nome',
          participantsCount: g.participants?.length || 0,
          desc: g.desc ? g.desc.toString() : undefined,
        }));

        // Ordenar alfabeticamente
        groupsList.sort((a, b) => a.name.localeCompare(b.name));
        return groupsList;
      } catch (err: any) {
        console.warn(`[WhatsAppService] Tentativa ${attempts} de buscar grupos falhou:`, err?.message || err);
        if (attempts >= 3) {
          throw new Error(`Falha ao carregar lista de grupos: ${err?.message || err}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
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
    const now = new Date();
    const year = now.getFullYear();
    const week = this.getCurrentWeekNumber(now);
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
    idempotencyKey?: string
  ): Promise<{ success: boolean; status?: string; message: string }> {
    const config = await getWhatsAppConfig();

    if (triggerType === 'auto' && !config.isActive) {
      return { success: false, message: 'Automação está desativada.' };
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
        const msg = `Envio ignorado: Cobrança (${scheduleTitle || `Disparo ${scheduleId || 1}`}) já foi enviada nesta semana (${baseWeek}) para o grupo ${config.groupName}.`;
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

  // Enfileira disparos automáticos programados da semana atual que já passaram do horário
  public async enqueueDueSchedules(): Promise<number> {
    const config = await getWhatsAppConfig();
    if (!config.isActive || !config.groupId) {
      console.log('[WhatsAppService] Automação inativa ou sem grupo configurado.');
      return 0;
    }

    const nowInBrazil = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const currentDayOfWeek = nowInBrazil.getDay(); // 0 (Domingo) a 6 (Sábado)
    
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
      if (!sched.enabled) continue;

      // Calcular a data correspondente a este dia da semana na semana atual
      const targetDate = new Date(nowInBrazil);
      const diff = sched.dayOfWeek - currentDayOfWeek;
      targetDate.setDate(nowInBrazil.getDate() + diff);

      const [targetHour, targetMinute] = (sched.sendTime || '09:00').split(':').map(Number);
      targetDate.setHours(targetHour, targetMinute, 0, 0);

      // Se o horário agendado para esta semana já passou (ou é agora)
      if (targetDate <= nowInBrazil) {
        const refWeek = `${baseWeek}_slot${sched.id}`;
        const executionKey = `billing_weekly_${config.groupId}_${refWeek}`;

        // Gerar a mensagem formatada para este slot
        const formattedMessage = await this.generateFormattedMessage(sched.messageTemplate);

        const res = await enqueueMessage({
          tipo: 'billing',
          destino: config.groupId,
          mensagem: formattedMessage,
          scheduledAt: targetDate.toISOString(),
          executionKey: executionKey
        });

        if (res.success) {
          enqueuedCount++;
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

      console.log(`[WhatsAppService] Processando ${pendingMessages.length} mensagens na fila.`);
      let processed = 0;
      let failures = 0;

      for (const item of pendingMessages) {
        // Tentar travar a mensagem atomicamente
        const locked = await lockQueueMessage(item.id);
        if (!locked) {
          console.log(`[WhatsAppService] Mensagem id ${item.id} já bloqueada por outro processo. Ignorando.`);
          continue;
        }

        // Garantir conexão com o WhatsApp
        if (!this.sock || this.status !== 'connected') {
          console.log('[WhatsAppService] WhatsApp desconectado. Tentando conectar para processamento da fila...');
          const connected = await this.ensureConnected(15000);
          if (!connected) {
            console.error('[WhatsAppService] Falha ao garantir conexão com o WhatsApp para envio da fila.');
            await updateQueueMessageStatus(item.id, 'failed', {
              error: 'WhatsApp desconectado no momento do envio.',
              attempts: (item.attempts || 0) + 1
            });
            failures++;
            continue;
          }
        }

        try {
          // Enviar a mensagem
          await this.sock.sendMessage(item.destino, { text: item.mensagem });

          // Atualizar status na fila para sent
          await updateQueueMessageStatus(item.id, 'sent', {
            attempts: (item.attempts || 0) + 1
          });

          // Registrar no log de mensagens
          await logWhatsAppMessage({
            groupId: item.destino,
            groupName: 'Grupo WhatsApp',
            type: item.tipo === 'match_report' ? 'match_report' : item.tipo === 'test' ? 'test' : item.tipo === 'match_test' ? 'match_test' : 'auto',
            status: 'sent',
            referenceWeek: item.execution_key || this.getCurrentReferenceWeek(),
            message: item.mensagem
          });

          processed++;
        } catch (err: any) {
          console.error(`[WhatsAppService] Falha ao enviar mensagem da fila id ${item.id}:`, err);
          const currentAttempts = (item.attempts || 0) + 1;
          const nextStatus = currentAttempts >= (item.max_attempts || 3) ? 'failed' : 'pending';

          await updateQueueMessageStatus(item.id, nextStatus, {
            error: err.message || 'Erro no envio via Baileys',
            attempts: currentAttempts
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

  private async checkCronTrigger() {
    const config = await getWhatsAppConfig();
    if (!config.isActive || !config.groupId) return;

    // Obter data/hora atual no fuso horário de Brasília
    const now = new Date();
    const brazilTimeStr = now.toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    // Dia da semana em SP (0 = Domingo, 1 = Segunda, ..., 6 = Sábado)
    const brazilDay = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay();
    const [currentHour, currentMinute] = brazilTimeStr.split(':').map(Number);

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

    for (const sched of schedules) {
      if (!sched.enabled) continue;

      const [targetHour, targetMinute] = (sched.sendTime || '09:00').split(':').map(Number);

      if (brazilDay === sched.dayOfWeek && currentHour === targetHour && currentMinute === targetMinute) {
        console.log(`[WhatsAppService] Disparo programado correspondente (${sched.title || `Slot ${sched.id}`} - ${brazilTimeStr})! Executando envio...`);
        await this.executeWeeklyBilling('auto', sched.messageTemplate, undefined, undefined, sched.id, sched.title);
      }
    }
  }
}

export const whatsappService = new WhatsAppService();
