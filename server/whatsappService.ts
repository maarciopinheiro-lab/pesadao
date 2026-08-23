import { makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  WASocket,
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

  constructor() {
    this.initCron();
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

  public async connect(): Promise<WhatsAppSessionInfo> {
    if (this.isConnecting && this.status === 'connecting') {
      return this.getSessionInfo();
    }

    if (this.sock && this.status === 'connected') {
      return this.getSessionInfo();
    }

    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners('connection.update');
        this.sock.ev.removeAllListeners('creds.update');
        this.sock.end(undefined);
      } catch (e) {}
    }

    this.isConnecting = true;
    this.status = 'connecting';
    this.lastError = null;

    const supabase = getAdminSupabase();
    if (!supabase) {
      this.status = 'error';
      this.lastError = 'Erro: Supabase não está configurado.';
      return this.getSessionInfo();
    }

    try {
      const { state, saveCreds, clearState } = await useSupabaseAuthState(supabase);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] as [number, number, number] }));

      const silentLogger = pino({ level: 'silent' });

      this.sock = makeWASocket({
        version,
        logger: silentLogger,
        printQRInTerminal: false,
        auth: state,
        browser: ['Pesadao FC Bot', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 60_000,
        keepAliveIntervalMs: 25_000,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: false,
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.rawQr = qr;
          try {
            this.qrCodeDataUrl = await QRCode.toDataURL(qr, {
              width: 300,
              margin: 2,
              color: {
                dark: '#000000',
                light: '#ffffff',
              },
            });
            this.status = 'qr_ready';
            await addSystemLog('QR_CODE_GENERATED', 'Novo QR Code gerado para conexão do WhatsApp.', 'info');
          } catch (qrErr) {
            console.error('[WhatsAppService] Erro gerando QR Code:', qrErr);
          }
        }

        if (connection === 'open') {
          this.status = 'connected';
          this.qrCodeDataUrl = null;
          this.rawQr = null;
          this.reconnectAttempts = 0;
          this.lastError = null;
          this.lastConnected = new Date().toISOString();

          // Extrair número conectado
          const userJid = this.sock?.user?.id;
          if (userJid) {
            const rawPhone = userJid.split('@')[0].split(':')[0];
            this.phoneNumber = rawPhone.length > 10 ? `+${rawPhone}` : rawPhone;
          } else {
            this.phoneNumber = 'Conectado';
          }

          this.isConnecting = false;
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
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;

          console.log(`[WhatsAppService] Conexão fechada. Status: ${statusCode}, LoggedOut: ${isLoggedOut}`);

          if (isLoggedOut) {
            this.status = 'disconnected';
            this.phoneNumber = null;
            this.qrCodeDataUrl = null;
            this.lastError = 'Sessão encerrada ou desconectada pelo WhatsApp.';
            await this.clearAuthFiles();
            await addSystemLog('WHATSAPP_LOGGED_OUT', 'A conta foi desconectada do WhatsApp.', 'warn');
          } else {
            this.status = 'connecting';
            this.lastError = 'Conexão interrompida. Tentando reconectar...';
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
      await addSystemLog('WHATSAPP_CONNECTION_ERROR', `Erro de conexão: ${this.lastError}`, 'error');
      return this.getSessionInfo();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectAttempts++;
    const delay = Math.min(3000 * Math.pow(1.5, this.reconnectAttempts), 30000);

    console.log(`[WhatsAppService] Tentativa de reconexão #${this.reconnectAttempts} em ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
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
      if (this.status === 'disconnected' && !this.isConnecting && this.reconnectAttempts === 0) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return this.sock && this.status === 'connected';
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

    await addSystemLog('WHATSAPP_DISCONNECTED', 'WhatsApp desconectado com sucesso e credenciais limpas.', 'info');
  }

  public async switchNumber(): Promise<WhatsAppSessionInfo> {
    await addSystemLog('SWITCH_NUMBER_INITIATED', 'Iniciando troca de número do WhatsApp.', 'info');
    await this.disconnect();
    await this.clearAuthFiles();
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

    try {
      const groupsData = await this.sock.groupFetchAllParticipating();
      const groupsList: WhatsAppGroup[] = Object.values(groupsData).map((g) => ({
        id: g.id,
        name: g.subject || 'Grupo sem nome',
        participantsCount: g.participants?.length || 0,
        desc: g.desc ? g.desc.toString() : undefined,
      }));

      // Ordenar alfabeticamente
      groupsList.sort((a, b) => a.name.localeCompare(b.name));
      return groupsList;
    } catch (err: any) {
      console.error('[WhatsAppService] Erro ao buscar grupos:', err);
      throw new Error(`Falha ao carregar lista de grupos: ${err.message}`);
    }
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

  public async sendTestMessage(customTemplate?: string, clientPlayers?: any[], targetMonthKey?: string): Promise<{ success: boolean; message: string }> {
    const isConnected = await this.ensureConnected();
    if (!isConnected) {
      throw new Error('WhatsApp não está conectado. Por favor, reconecte o bot.');
    }

    const config = await getWhatsAppConfig();
    if (!config.groupId) {
      throw new Error('Nenhum grupo do WhatsApp foi selecionado nas configurações.');
    }

    const baseMessage = await this.generateFormattedMessage(customTemplate, undefined, clientPlayers, targetMonthKey);
    const testMessageText = `🤖 *TESTE DE AUTOMAÇÃO - APP PESADÃO*\n_Esta é uma mensagem de teste enviada pelo painel administrativo._\n\n${baseMessage}`;

    const refWeek = this.getCurrentReferenceWeek();

    try {
      await this.sock.sendMessage(config.groupId, { text: testMessageText });

      await logWhatsAppMessage({
        groupId: config.groupId,
        groupName: config.groupName || 'Grupo de Teste',
        type: 'test',
        status: 'sent',
        referenceWeek: refWeek,
        message: testMessageText,
      });

      await addSystemLog('TEST_MESSAGE_SENT', `Mensagem de teste enviada com sucesso para o grupo ${config.groupName}`, 'info');

      return { success: true, message: 'Mensagem de teste enviada com sucesso para o grupo!' };
    } catch (err: any) {
      console.error('[WhatsAppService] Erro ao enviar mensagem de teste:', err);

      await logWhatsAppMessage({
        groupId: config.groupId,
        groupName: config.groupName || 'Grupo',
        type: 'test',
        status: 'error',
        referenceWeek: refWeek,
        message: testMessageText,
        error: err.message,
      });

      await addSystemLog('TEST_MESSAGE_ERROR', `Falha ao enviar mensagem de teste: ${err.message}`, 'error');
      throw new Error(`Erro no envio: ${err.message}`);
    }
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

  public async sendMatchReport(matchData: any, customTemplate?: string, targetGroupId?: string): Promise<{ success: boolean; message: string }> {
    const isConnected = await this.ensureConnected();
    if (!isConnected) {
      throw new Error('WhatsApp não está conectado. Reconectando automaticamente, tente enviar novamente em instantes.');
    }

    const config = await getWhatsAppConfig();
    const destGroupId = targetGroupId || config.matchGroupId || config.groupId;

    if (!destGroupId) {
      throw new Error('Nenhum grupo de WhatsApp configurado para envio do pós-jogo.');
    }

    const groupName = (destGroupId === config.matchGroupId ? config.matchGroupName : config.groupName) || 'Grupo do Jogo';
    const messageText = await this.formatMatchReport(matchData, customTemplate);
    const refWeek = this.getCurrentReferenceWeek();

    try {
      await this.sock.sendMessage(destGroupId, { text: messageText });

      await logWhatsAppMessage({
        groupId: destGroupId,
        groupName: groupName,
        type: 'match_report',
        status: 'sent',
        referenceWeek: refWeek,
        message: messageText,
      });

      await addSystemLog(
        'MATCH_REPORT_SENT',
        `Relatório do jogo contra ${matchData.opponent || 'Adversário'} enviado para o grupo ${groupName}.`,
        'info',
        { groupId: destGroupId }
      );

      return { success: true, message: `Relatório do jogo enviado com sucesso para o grupo ${groupName}!` };
    } catch (err: any) {
      console.error('[WhatsAppService] Erro ao enviar relatório de jogo:', err);

      await logWhatsAppMessage({
        groupId: destGroupId,
        groupName: groupName,
        type: 'match_report',
        status: 'error',
        referenceWeek: refWeek,
        message: messageText,
        error: err.message,
      });

      await addSystemLog('MATCH_REPORT_ERROR', `Falha ao enviar relatório do jogo: ${err.message}`, 'error');
      throw new Error(`Erro ao enviar relatório: ${err.message}`);
    }
  }

  public async sendMatchTestMessage(): Promise<{ success: boolean; message: string }> {
    const isConnected = await this.ensureConnected();
    if (!isConnected) {
      throw new Error('WhatsApp não está conectado. Por favor, reconecte o bot.');
    }

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

    const refWeek = this.getCurrentReferenceWeek();
    const groupName = (destGroupId === config.matchGroupId ? config.matchGroupName : config.groupName) || 'Grupo do Jogo';

    try {
      await this.sock.sendMessage(destGroupId, { text: testText });

      await logWhatsAppMessage({
        groupId: destGroupId,
        groupName: groupName,
        type: 'match_test',
        status: 'sent',
        referenceWeek: refWeek,
        message: testText,
      });

      await addSystemLog('MATCH_TEST_SENT', `Teste de pós-jogo enviado com sucesso para ${groupName}.`, 'info');

      return { success: true, message: `Teste de pós-jogo enviado com sucesso para o grupo ${groupName}!` };
    } catch (err: any) {
      await logWhatsAppMessage({
        groupId: destGroupId,
        groupName: groupName,
        type: 'match_test',
        status: 'error',
        referenceWeek: refWeek,
        message: testText,
        error: err.message,
      });

      throw new Error(`Erro ao enviar teste: ${err.message}`);
    }
  }

  public async triggerManualSend(customTemplate?: string, clientPlayers?: any[], targetMonthKey?: string, scheduleId?: string): Promise<{ success: boolean; message: string }> {
    return await this.executeWeeklyBilling('manual', customTemplate, clientPlayers, targetMonthKey, scheduleId);
  }

  public async executeWeeklyBilling(
    triggerType: 'auto' | 'manual' = 'auto',
    customTemplate?: string,
    clientPlayers?: any[],
    targetMonthKey?: string,
    scheduleId?: string,
    scheduleTitle?: string
  ): Promise<{ success: boolean; message: string }> {
    const config = await getWhatsAppConfig();

    if (triggerType === 'auto' && !config.isActive) {
      return { success: false, message: 'Automação está desativada.' };
    }

    const isConnected = await this.ensureConnected();
    if (!isConnected) {
      const errMsg = 'WhatsApp não está conectado para o envio de cobrança.';
      await addSystemLog('EXECUTION_SKIPPED', errMsg, 'warn');
      return { success: false, message: errMsg };
    }

    if (!config.groupId) {
      const errMsg = 'Nenhum grupo de WhatsApp configurado para envio.';
      await addSystemLog('EXECUTION_SKIPPED', errMsg, 'warn');
      return { success: false, message: errMsg };
    }

    const baseWeek = this.getCurrentReferenceWeek();
    const refWeek = scheduleId ? `${baseWeek}_slot${scheduleId}` : baseWeek;

    // PROTEÇÃO CONTRA DUPLICIDADE:
    // Se for execução automática, verificar se já foi enviada nesta semana para este slot específico
    if (triggerType === 'auto') {
      const alreadySent = await hasMessageBeenSentThisWeek(config.groupId, refWeek);
      if (alreadySent) {
        const msg = `Envio ignorado: Cobrança (${scheduleTitle || `Disparo ${scheduleId || 1}`}) já foi enviada nesta semana (${baseWeek}) para o grupo ${config.groupName}.`;
        await addSystemLog('SCHEDULED_SKIPPED_DUPLICATE', msg, 'info', { refWeek, groupId: config.groupId });
        return { success: true, message: msg };
      }
    }

    try {
      const finalMessage = await this.generateFormattedMessage(customTemplate, undefined, clientPlayers, targetMonthKey);
      await this.sock.sendMessage(config.groupId, { text: finalMessage });

      await logWhatsAppMessage({
        groupId: config.groupId,
        groupName: config.groupName,
        type: triggerType,
        status: 'sent',
        referenceWeek: refWeek,
        message: finalMessage,
      });

      const dispName = scheduleTitle ? `${scheduleTitle}` : (scheduleId ? `Disparo ${scheduleId}` : 'Cobrança semanal');
      await addSystemLog(
        triggerType === 'auto' ? 'SCHEDULED_SENT' : 'MANUAL_SENT',
        `${dispName} enviado com sucesso para o grupo ${config.groupName} (Ref: ${baseWeek}).`,
        'info',
        { refWeek, groupId: config.groupId }
      );

      return { success: true, message: `${dispName} enviado com sucesso para o grupo ${config.groupName}!` };
    } catch (err: any) {
      console.error('[WhatsAppService] Erro ao executar envio de cobrança:', err);

      await logWhatsAppMessage({
        groupId: config.groupId,
        groupName: config.groupName,
        type: triggerType,
        status: 'error',
        referenceWeek: refWeek,
        message: customTemplate || config.messageTemplate,
        error: err.message,
      });

      await addSystemLog('EXECUTION_ERROR', `Erro ao enviar cobrança: ${err.message}`, 'error', { error: err.message });
      throw new Error(`Falha no envio: ${err.message}`);
    }
  }

  private initCron() {
    // Roda a cada minuto para checar se deve disparar cobrança
    this.cronJob = cron.schedule('* * * * *', async () => {
      try {
        await this.checkCronTrigger();
      } catch (err) {
        console.error('[WhatsAppService] Erro no cron scheduler:', err);
      }
    });

    console.log('[WhatsAppService] Agendador semanal com suporte a múltiplos disparos inicializado.');
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
