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

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'APP Pesadão WhatsApp Automation API',
      timestamp: new Date().toISOString(),
    });
  });

  // Endpoint seguro para o cron-job.org chamar
  app.post('/api/automation/run', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const secret = process.env.AUTOMATION_SECRET || 'pesadao-secret-token-123';
      
      if (!authHeader || authHeader !== `Bearer ${secret}`) {
        res.status(401).json({ error: 'Não autorizado. Token secreto incorreto ou ausente.' });
        return;
      }

      console.log('[Automation] Executando rotina de automação disparada pelo Cron...');
      
      // 1. Enfileirar cobranças pendentes da semana atual (se houver)
      const enqueued = await whatsappService.enqueueDueSchedules();
      
      // 2. Processar mensagens da fila (enviar pendentes/falhas)
      const queueResult = await whatsappService.processPendingQueue();

      res.json({
        success: true,
        enqueued,
        processed: queueResult.processed,
        failures: queueResult.failures,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      console.error('[Automation] Erro na rota de automação:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Keepalive route for external ping services (UptimeRobot)
  app.get('/api/keepalive', (req, res) => {
    res.status(200).send('Alive');
  });

  // Obter status da conexão do WhatsApp
  app.get('/api/whatsapp/status', (req, res) => {
    const session = whatsappService.getSessionInfo();
    res.json(session);
  });

  // Conectar / Gerar novo QR Code
  app.post('/api/whatsapp/connect', async (req, res) => {
    try {
      const session = await whatsappService.connect();
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
