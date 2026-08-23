FROM node:20-alpine

# Criar diretório do app
WORKDIR /app

# Copiar arquivos de dependências
COPY package.json ./

# Instalar dependências
RUN npm install

# Copiar o restante do código
COPY . .

# Fazer o build do projeto
RUN npm run build

# O Back4app expõe a porta fornecida no painel (por padrão 3000)
EXPOSE 3000

# Variável para sinalizar produção
ENV NODE_ENV=production

# Iniciar o servidor de produção
CMD ["npm", "start"]
