import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { whatsappService } from './server/whatsappService';
import {
  getWhatsAppConfig,
  saveWhatsAppConfig,
  getWhatsAppMessageHistory,
  getSystemLogs,
  addSystemLog,
} from './server/supabaseAdmin';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // --- API ROUTES ---

  // Health check e keep-alive do Render
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'APP Pesadão WhatsApp Automation API',
      timestamp: new Date().toISOString(),
      session: whatsappService.getSessionInfo().status,
    });
  });

  // Webhook Tick para Cron-Job.org / UptimeRobot / Render Keep-Alive (GET e POST)
  const handleCronTick = async (req: express.Request, res: express.Response) => {
    try {
      const isForce = req.query.force === 'true' || req.body?.force === true;
      console.log(`[WebhookCron] Recebido sinal de cron/keep-alive (force: ${isForce})...`);
      
      // 1. Verificar e enfileirar agendamentos semanais devidos
      const enqueuedCount = await whatsappService.enqueueDueSchedules(isForce);

      // 2. Verificar e disparar agendamentos semanais ativos devidos
      const scheduleResult = await whatsappService.checkCronTrigger(isForce);
      
      // 3. Processar mensagens pendentes na fila (envio real via Baileys)
      const queueResult = await whatsappService.processPendingQueue();

      const session = whatsappService.getSessionInfo();
      const brazilTime = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const brazilDate = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

      res.json({
        success: true,
        message: 'Ciclo de automação e verificação executado com sucesso.',
        brazilDateTime: `${brazilDate} ${brazilTime}`,
        sessionStatus: session.status,
        phoneNumber: session.phoneNumber,
        enqueuedSchedules: enqueuedCount,
        triggeredSchedules: scheduleResult.triggered,
        scheduleDetails: scheduleResult.details,
        queueProcessed: queueResult.processed,
        queueFailures: queueResult.failures,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[WebhookCron] Erro ao executar ciclo:', err);
      res.status(500).json({ error: err.message || 'Erro ao processar ciclo de automação.' });
    }
  };

  app.get('/api/whatsapp/cron-tick', handleCronTick);
  app.post('/api/whatsapp/cron-tick', handleCronTick);
  app.get('/api/whatsapp/force-cron', (req, res) => {
    req.query.force = 'true';
    return handleCronTick(req, res);
  });
  app.post('/api/whatsapp/force-cron', (req, res) => {
    req.query.force = 'true';
    return handleCronTick(req, res);
  });
  app.get('/api/cron', handleCronTick);
  app.post('/api/cron', handleCronTick);

  // Endpoint flexível para cron-job.org / Render
  app.all('/api/automation/run', async (req, res) => {
    return handleCronTick(req, res);
  });

  // Keepalive route for external ping services (UptimeRobot)
  app.get('/api/keepalive', (req, res) => {
    res.status(200).send('Alive');
  });

  // Obter status da conexão do WhatsApp
  app.get('/api/whatsapp/status', async (req, res) => {
    try {
      const session = await whatsappService.getEffectiveSessionInfo();
      res.json(session);
    } catch (err: any) {
      res.json(whatsappService.getSessionInfo());
    }
  });

  // Conectar / Gerar novo QR Code
  app.post('/api/whatsapp/connect', async (req, res) => {
    try {
      const force = Boolean(req.body?.force || req.query?.force === 'true');
      const session = await whatsappService.connect(force);
      res.json(session);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Desconectar sessão atual
  app.post('/api/whatsapp/disconnect', async (req, res) => {
    try {
      await whatsappService.disconnect();
      res.json({ success: true, message: 'WhatsApp desconectado com sucesso.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Trocar número (limpa sessão antiga e gera novo QR code)
  app.post('/api/whatsapp/switch-number', async (req, res) => {
    try {
      const session = await whatsappService.switchNumber();
      res.json(session);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Listar grupos do WhatsApp conectado
  app.get('/api/whatsapp/groups', async (req, res) => {
    try {
      const groups = await whatsappService.getGroups();
      res.json({ groups });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Obter configuração de cobrança
  app.get('/api/whatsapp/config', async (req, res) => {
    try {
      const config = await getWhatsAppConfig();
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Salvar configuração de cobrança
  app.post('/api/whatsapp/config', async (req, res) => {
    try {
      const saved = await saveWhatsAppConfig(req.body);
      res.json(saved);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Enviar mensagem de teste
  app.post('/api/whatsapp/send-test', async (req, res) => {
    try {
      const { customTemplate, players, monthKey, idempotencyKey } = req.body || {};
      const result = await whatsappService.sendTestMessage(customTemplate, players, monthKey, idempotencyKey);
      res.status(200).json(result);
    } catch (err: any) {
      console.error('[API] Erro ao enfileirar teste de WhatsApp:', err);
      res.status(400).json({ error: err.message || 'Não foi possível preparar o envio. Tente novamente.' });
    }
  });

  // Disparo manual imediato
  app.post('/api/whatsapp/send-now', async (req, res) => {
    try {
      const { customTemplate, players, monthKey, scheduleId, idempotencyKey } = req.body || {};
      const result = await whatsappService.triggerManualSend(customTemplate, players, monthKey, scheduleId, idempotencyKey);
      res.status(200).json(result);
    } catch (err: any) {
      console.error('[API] Erro ao enfileirar disparo manual de WhatsApp:', err);
      res.status(400).json({ error: err.message || 'Não foi possível preparar o envio. Tente novamente.' });
    }
  });

  // Pré-visualizar mensagem com variáveis substituídas (Cobrança)
  app.post('/api/whatsapp/preview', async (req, res) => {
    try {
      const { template, billingType, players, monthKey } = req.body || {};
      const previewText = await whatsappService.generateFormattedMessage(template, billingType, players, monthKey);
      res.json({ preview: previewText, referenceWeek: whatsappService.getCurrentReferenceWeek() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Pré-visualizar relatório pós-jogo com variáveis substituídas
  app.post('/api/whatsapp/match-preview', async (req, res) => {
    try {
      const { matchData, template } = req.body;
      const previewText = await whatsappService.formatMatchReport(matchData || {}, template);
      res.json({ preview: previewText });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Enviar relatório pós-jogo para o grupo configurado
  app.post('/api/whatsapp/send-match', async (req, res) => {
    try {
      const { matchData, template, targetGroupId, idempotencyKey } = req.body || {};
      const result = await whatsappService.sendMatchReport(matchData, template, targetGroupId, idempotencyKey);
      res.status(200).json(result);
    } catch (err: any) {
      console.error('[API] Erro ao enfileirar relatório pós-jogo:', err);
      res.status(400).json({ error: err.message || 'Não foi possível preparar o envio. Tente novamente.' });
    }
  });

  // Enviar teste de relatório pós-jogo
  app.post('/api/whatsapp/send-match-test', async (req, res) => {
    try {
      const { idempotencyKey } = req.body || {};
      const result = await whatsappService.sendMatchTestMessage(idempotencyKey);
      res.status(200).json(result);
    } catch (err: any) {
      console.error('[API] Erro ao enfileirar teste de pós-jogo:', err);
      res.status(400).json({ error: err.message || 'Não foi possível preparar o envio. Tente novamente.' });
    }
  });

  // Obter histórico de mensagens enviadas
  app.get('/api/whatsapp/history', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const history = await getWhatsAppMessageHistory(limit);
      res.json({ history });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Obter logs de sistema e diagnóstico
  app.get('/api/whatsapp/logs', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await getSystemLogs(limit);
      res.json({ logs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- VITE MIDDLEWARE (DEV) & STATIC (PROD) ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] APP Pesadão rodando em http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Server] Falha fatal ao iniciar:', err);
});
