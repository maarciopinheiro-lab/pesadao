# 🤖 GUIA DE AUTOMAÇÃO DO WHATSAPP — APP PESADÃO

Este documento contém todas as orientações para utilizar a automação do WhatsApp do **APP Pesadão** para envio de cobranças semanais de mensalidade no grupo do time.

---

## 🚀 1. Como Conectar o WhatsApp

1. Abra o **APP Pesadão** e clique na aba **WhatsApp** (no topo no computador ou na barra inferior no celular).
2. Clique no botão verde **"Conectar WhatsApp"**.
3. Um **QR Code** será exibido na tela.
4. No seu celular onde está o WhatsApp do time:
   - Abra o WhatsApp.
   - Acesse **Configurações** (ou menu de 3 pontinhos) &rarr; **Aparelhos conectados**.
   - Toque em **"Conectar um aparelho"**.
   - Aponte a câmera para o QR Code na tela do app.
5. Em poucos segundos o status mudará para 🟢 **Conectado** e exibirá o número do aparelho.

---

## ⚙️ 2. Como Configurar a Cobrança Semanal

Na aba **WhatsApp &rarr; Configuração da Cobrança**:

1. **Status da Automação**: Mude a chave para **ATIVADO**.
2. **Grupo de Destino**: Selecione o grupo do WhatsApp do time na lista suspensa (o app busca automaticamente todos os grupos em que o WhatsApp conectado participa).
3. **Dia da Semana**: Escolha o dia que você deseja que a cobrança seja enviada (ex: Toda Segunda-feira).
4. **Horário de Envio**: Defina o horário (ex: `09:00` horário de Brasília).
5. **Modo de Cobrança**:
   - **Opção A (Mensagem Geral)**: Envia o valor e os totais gerais sem listar nomes individuais de quem deve.
   - **Opção B (Com Lista de Nomes)**: Inclui a lista dos primeiros nomes dos atletas que estão pendentes no mês atual.
6. **Dados do PIX**: Informe o tipo de chave (CPF, CNPJ, Celular, E-mail ou Aleatória) e a chave PIX para os atletas realizarem o pagamento.
7. **Template de Mensagem**: Você pode personalizar o texto e usar os botões de variáveis rápidas (`{valor}`, `{pix}`, `{nome_grupo}`, `{data}`, `{semana}`, `{total_pendentes}`, `{total_pago}`, etc.).
8. Clique em **"Salvar Configurações"**.

---

## 🧪 3. Como Testar o Envio

* Clique no botão amarelo **"Enviar Teste"** no painel de configuração.
* O bot enviará uma mensagem de teste imediata para o grupo selecionado com a identificação `🤖 TESTE DE AUTOMAÇÃO`.
* Você também pode conferir a **Prévia ao Vivo** no lado direito da tela, que calcula em tempo real os valores e pendências dos atletas cadastrados no app.

---

## 🛡️ 4. Proteção Contra Duplicidade

O sistema possui proteção automática integrada:
* Mesmo que o servidor reinicie ou o agendador seja acionado novamente, **nenhuma mensagem automática de cobrança será enviada mais de 1 vez na mesma semana** para o mesmo grupo.
* Todos os envios ficam registrados com data, hora, semana de referência e status na aba **Histórico de Envios**.

---

## 🔄 5. Como Trocar de Número de Celular

1. Na aba WhatsApp, clique no botão **"Trocar Número"**.
2. Confirme a ação na janela que se abre.
3. A sessão anterior será encerrada e um novo QR Code será gerado para você escanear com o novo aparelho.
4. **Todas as suas configurações de grupo, horários, PIX e histórico serão 100% preservadas!**

---

## 🗄️ 6. Banco de Dados Supabase (Opcional / Deploy)

Caso queira executar as tabelas no Supabase para persistência remota dedicada, basta copiar o conteúdo do arquivo `supabase_whatsapp_schema.sql` e colar no **SQL Editor** do seu projeto no Supabase:

Tabelas criadas:
* `whatsapp_config`: Armazena os parâmetros de agendamento e PIX.
* `whatsapp_sessions`: Armazena o estado da sessão.
* `whatsapp_messages`: Histórico de todas as cobranças e testes enviados.
* `whatsapp_logs`: Logs de eventos e diagnósticos em tempo real.
