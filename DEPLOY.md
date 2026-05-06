# 🐑 Quiz Bíblico Multiplayer — Guia de Deploy

## Estrutura dos arquivos
```
quiz-biblico/
├── server.js          ← Servidor Node.js + WebSocket
├── package.json       ← Dependências
├── data.json          ← Criado automaticamente (perguntas + ranking)
└── public/
    └── index.html     ← Todo o frontend do jogo
```

---

## 🚀 Deploy no RENDER (Recomendado — Grátis)

### Passo 1 — Criar conta
1. Acesse https://render.com e crie uma conta gratuita
2. Clique em **"New +"** → **"Web Service"**

### Passo 2 — Subir para GitHub
1. Acesse https://github.com e crie uma conta (se não tiver)
2. Clique em **"New repository"** → Nome: `quiz-biblico`
3. Marque **"Public"** → Clique **"Create repository"**
4. Na próxima tela, clique em **"uploading an existing file"**
5. Faça upload dos 3 arquivos: `server.js`, `package.json` e a pasta `public/` com `index.html`

### Passo 3 — Conectar no Render
1. No Render, escolha **"Connect a repository"**
2. Autorize o GitHub e selecione `quiz-biblico`
3. Configure:
   - **Name**: quiz-biblico (ou qualquer nome)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
4. Clique **"Create Web Service"**

### Passo 4 — Aguardar deploy
- O Render vai instalar e iniciar automaticamente (~2 min)
- Você receberá uma URL como: `https://quiz-biblico-xxxx.onrender.com`
- **Esta é a URL do seu jogo!** Compartilhe com todos.

> ⚠️ No plano grátis, o serviço "dorme" após 15 min sem uso.
> A primeira requisição pode demorar ~30s para acordar.
> Para evitar isso, use o plano Starter ($7/mês) ou use Railway.

---

## 🚂 Deploy no RAILWAY (Alternativa)

### Passo 1
1. Acesse https://railway.app e faça login com GitHub
2. Clique **"New Project"** → **"Deploy from GitHub repo"**
3. Selecione o repositório `quiz-biblico`

### Passo 2 — Configurar
1. Railway detecta automaticamente que é Node.js
2. Clique em **"Settings"** → **"Start Command"**: `node server.js`
3. Clique em **"Deploy"**

### Passo 3 — Domínio
1. Em **"Settings"** → **"Domains"** → **"Generate Domain"**
2. Você receberá uma URL como: `quiz-biblico-production.up.railway.app`

> Railway oferece $5 de crédito grátis por mês, suficiente para uso moderado.

---

## 🔐 Acessando o Painel Admin

1. Abra o jogo no navegador
2. Clique em **"⚙️ Admin"**
3. Senha padrão: **`admin123`**
4. **IMPORTANTE**: Mude a senha no painel Admin → Configurações!

### O que você pode fazer no Admin:
- ✅ Adicionar/remover perguntas
- ✅ Editar configurações (senha, nome do jogo, máx. jogadores)
- ✅ Ver ranking completo
- ✅ Limpar ranking
- ✅ Ver estatísticas em tempo real (jogos ativos, jogadores online)

---

## 🎮 Como Jogar

### Anfitrião (Host):
1. Abra o jogo → **"Criar Jogo"**
2. Configure dificuldade, nº de perguntas e categoria
3. Um **PIN de 4 dígitos** será gerado
4. Compartilhe o PIN com os jogadores
5. Aguarde todos entrarem → Clique **"Iniciar Jogo"**
6. Durante o jogo, você vê as respostas em tempo real
7. Após cada revelação, clique **"Próxima Pergunta"**

### Jogador:
1. Abra o mesmo link do jogo
2. Clique **"Ingressar num Jogo"**
3. Digite o PIN e seu nome
4. Aguarde o anfitrião iniciar
5. Responda as perguntas antes do tempo acabar!

---

## 📊 Sistema de Pontuação
- ✅ Resposta correta: **100 pts base**
- ⚡ Bônus velocidade: até **+50 pts** (mais rápido = mais pontos)
- 🔥 Sequência de acertos: multiplicador **x2, x3, x4**
- ❌ Resposta errada: perde **1 vida** (3 vidas total)
- 💀 Sem vidas: **eliminado** do jogo

---

## 🔧 Dicas de Manutenção

### Backup das perguntas:
- O arquivo `data.json` contém todas as perguntas e o ranking
- Baixe este arquivo periodicamente como backup
- No Render, use o painel do Dashboard para ver logs

### Adicionar muitas perguntas de uma vez:
- No painel Admin, adicione uma por uma pela interface
- Ou edite `server.js` na função `getDefaultQuestions()` antes do deploy

---

## ❓ Suporte
Se algo não funcionar:
1. Verifique os logs no Render/Railway
2. Certifique-se que o `package.json` está na pasta raiz
3. Verifique se a porta está correta (o código usa `process.env.PORT`)
