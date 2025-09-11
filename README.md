Projeto: StatusInvest Tools (API + Extensão MV3)

Resumo

- API (Vercel, Node 18 + Postgres): endpoints que expõem dados do ranking e preços, com CORS para `https://statusinvest.com.br` e extensões Chrome.
- Extensão Chrome (MV3): adiciona colunas úteis na tabela de ações, mostra indicadores, e cria painéis de planejamento/rebalanceamento diretamente na página de patrimônio.

Estrutura

```
api/
  statusinvest-latest.js         # exemplo de leitura direta
  fm-ranks.js                    # { code, final_rank } de ranking_magic_checklist
  fm-last-updated.js             # last_updated do ranking
  i10-scores.js                  # { code, i10_score[, i10_rank] }
  checklist.js                   # MERGE ranking_magic_checklist + statusinvest_latest (PRECO)
extension/
  bg.js                          # service worker: chama a API e responde ao content
  content.js                     # script que roda na página e injeta UI
  manifest.json                  # MV3 (permissões e matches)
package.json
README.md
```

Banco (esperado)

- `ranking_magic_checklist`: colunas mínimas: `ticker`, `final_rank`. O projeto usa também `i10_score`, `earning_yield`, `roic_pct`, `liquidity`, `market_cap` se existirem.
- `statusinvest_latest`: colunas mínimas: `ticker`, `data` (JSON ou JSONB). O preço é lido de `data->>'PRECO'` no formato pt-BR e convertido para número.

Endpoints (Vercel)

- `GET /api/fm-ranks` → `{ ok, count, data: [{ code, final_rank }] }`
- `GET /api/fm-last-updated` → `{ ok, last_updated, generated_at, column }`
- `GET /api/i10-scores` → `{ ok, count, data: [{ code, i10_score, i10_rank? }] }`
- `GET /api/checklist` → MERGE entre as tabelas (apenas tickers do ranking, ordenado por `final_rank` ASC). Campos principais: `ticker`, `code`, `final_rank`, `price` (de `statusinvest_latest.data->>'PRECO'`).
- `GET /api/statusinvest-latest` → exemplo simples de leitura (opcional no fluxo principal).

Observações de CORS

- Todos os endpoints adicionam cabeçalhos para permitir chamadas da extensão (origem `chrome-extension://…`) e do site `https://statusinvest.com.br`.

Variáveis de ambiente (Vercel)

- `DATABASE_URL` (Postgres). Em produção (não localhost), SSL é habilitado automaticamente com `rejectUnauthorized: false`.

Extensão (MV3)

Principais recursos injetados em `https://statusinvest.com.br/carteira/patrimonio`:

- Colunas na tabela de ações:
  - `FM` (posição no ranking): pintado de verde para `rank ≤ 20`, vermelho para `rank > 20`, cheio vermelho quando sem dado.
  - `I10` (score): preenchido a partir de `/api/i10-scores` (ou tabela de suporte).
  - `Qtd p/ 10%`: mostra quantas ações comprar para a posição atingir 10% do patrimônio total (somente quando `FM` ∈ [1..20]). Base de cálculo = `preço × quantidade` (não usa `% na carteira`). O patrimônio é lido do cabeçalho (span `.sensitive-field.fw-600`) e, se falhar, da soma de `preço × quantidade`.

- Indicadores e painéis:
  - “Atualizado: …” próximo ao cabeçalho “AÇÕES” (ou “POSIÇÃO NA CARTEIRA”), usando `/api/fm-last-updated`.
  - Painel “Quando foi o último rebalanceamento?” (após “POSIÇÃO EM CAIXA”):
    - Campo data “Último rebalance” (default = hoje);
    - Botão Adicionar: salva em `chrome.storage.sync` (`rebalance_dates`);
    - Lista com: Data (dd:mm:aaaa), Próximo rebalance (data + N meses com correção de fim de mês), Status (Atrasado / Hoje! / Faltam X dias), edição inline e exclusão;
    - Seletor de intervalo (3/6/9/12 meses) persistido em `rebalance_interval_months`;
    - Banner âmbar quando faltam ≤ 10 dias.
  - Painel “Plano de Rebalanceamento (Equal-Weight)” (acima da tabela):
    - Seletor Top N (10/15/20) e input “Total para rebalancear (R$)” (pré‑preenchido com o patrimônio detectado, editável);
    - Busca Top N via background em `/api/checklist` (merge banco), usando preço da API; se faltar, usa preço da página;
    - Para cada um dos Top N, mostra: Rank, Ticker, Preço, Qtd atual, Valor atual, Alvo por ativo (= total/N), Falta (R$), Qtd p/ comprar (= floor(delta/preço), sem fracionado), Custo estimado;
    - Botão “Ocultar/Mostrar”, estado persistido em `ew_plan_collapsed`.

Armazenamento (chrome.storage.sync)

- `API_BASE_URL` (opcional): substitui a URL padrão da API.
- `rebalance_dates`: array de `{ id, dateISO, createdAtISO }`.
- `rebalance_interval_months`: 3/6/9/12.
- `ew_plan_collapsed`: boolean (estado de colapso do painel Equal‑Weight).

Como instalar a extensão

1) Faça o deploy da API no Vercel (ver seção abaixo).
2) Abra o Chrome → `chrome://extensions` → habilite “Modo do desenvolvedor”.
3) Clique em “Carregar sem compactação” e selecione a pasta `extension`.
4) Edite `extension/manifest.json` e garanta que `host_permissions` inclui o domínio do seu Vercel (ex.: `https://seu-projeto.vercel.app/*`).
5) Opcional: defina `API_BASE_URL` em `chrome.storage.sync` (ou deixe o default configurado em `bg.js`).
6) Acesse `https://statusinvest.com.br/carteira/patrimonio` e veja as colunas/painéis.

Como publicar a API no Vercel

1) Requisitos: conta Vercel + banco Postgres acessível (Supabase, Neon, Render, Railway, etc.).
2) Importar repo: `https://vercel.com/new` → “Import Git Repository” → selecione este projeto.
3) Projeto “Other” (não precisa build). Configure a env `DATABASE_URL` para Preview/Production.
4) Deploy. Teste os endpoints:
   - `/api/checklist`
   - `/api/fm-ranks`
   - `/api/fm-last-updated`
   - `/api/i10-scores`

Notas de parsing (pt-BR)

- Preços em `statusinvest_latest` são lidos de `data->>'PRECO'` (ex.: "14,23"). A API converte para `numeric` com `REPLACE` e `CAST`.
- No front, o parsing de números também trata pt‑BR (remove pontos de milhares, troca vírgula por ponto).

Solução de problemas

- 404 na API: confira se o arquivo está no repo e se o “Root Directory” do projeto Vercel aponta para a pasta que contém `api/`.
- CORS bloqueado: confirme o domínio na origem (site/extension) e teste o endpoint diretamente no navegador.
- “FM” sempre “-”: verifique `/api/fm-ranks` e se `ticker/final_rank` existem na tabela.
- Preço ausente: confirme se `statusinvest_latest.data->>'PRECO'` está preenchido; caso não, a extensão tenta usar o preço exibido na página.

Proteção de deploy (Vercel) — removendo exigência de login

- Se, ao abrir `https://<seu-projeto>.vercel.app/api/...`, o Vercel pedir login, o projeto está com proteção de Preview/Production ativada.
- Para deixar público (sem login):
  - Vercel → Project → Settings → Protection:
    - Desative “Password Protection” e “Preview Deployments Protection” (ou marque como “Public”).
  - Vercel → Project → Settings → Git:
    - Garanta que “Preview Deployments” estejam públicos (não restritos a membros do time).
  - Faça um deploy de Produção (`vercel --prod`) e use o domínio de produção (ex.: `https://seu-projeto.vercel.app`) na extensão.
- Observação: a API deste repo não exige autenticação. Se o navegador pede login, isso está sendo imposto pelo Vercel (camada de proteção do domínio), não pelo código da API.

Licença

- Este projeto está marcado como `UNLICENSED` (uso privado). Ajuste conforme sua necessidade.

Passo a passo: API na Vercel

1) Pré‑requisitos
- Conta no Vercel e um Postgres acessível pela internet.
- Copie sua `DATABASE_URL` (ex.: Supabase/Neon/Render/Railway).

2) Importar o projeto no Vercel (Dashboard)
- Acesse `https://vercel.com/new` e escolha “Import Git Repository”.
- Selecione o repositório que contém esta estrutura (com a pasta `api/`).
- Framework Preset: “Other”. Nenhum build é necessário para a API.

3) Variáveis de ambiente
- Vercel → Project Settings → Environment Variables → Add New:
  - Name: `DATABASE_URL`
  - Value: sua string de conexão
  - Environments: marque “Production” e “Preview”

4) Deploy
- Clique em “Deploy”. Ao finalizar, o projeto terá um domínio, p.ex. `https://seu-projeto.vercel.app`.
- Teste: abra `https://seu-projeto.vercel.app/api/statusinvest-latest?limit=10`.
  - Deve retornar JSON com `{ ok, count, data }`.
  - Se aparecer erro de banco, confira `DATABASE_URL`, IP allowlist (se houver) e SSL.

5) Logs e debugging
- Vercel → Project → Deployments → View Functions Logs para ver `console.error`.

6) (Opcional) Deploy via CLI
- Instale: `npm i -g vercel`
- Rode: `vercel` (login e criação do projeto)
- Adicione env: `vercel env add DATABASE_URL` (siga o prompt)
- Deploy prod: `vercel --prod`

Passo a passo: Extensão no Chrome

1) Ajustar o domínio da API
- O `manifest.json` agora permite `https://*.vercel.app/*`, facilitando usar qualquer domínio Vercel.
- Em `extension/bg.js`, ajuste `DEFAULT_API_BASE` para o domínio público de produção do seu projeto (ex.: `https://seu-projeto.vercel.app`).
- Se usar domínio próprio (custom domain), adicione-o em `host_permissions`.

2) Carregar a extensão
- Abra o Chrome e acesse `chrome://extensions`.
- Ative “Modo do desenvolvedor”.
- Clique em “Carregar sem compactação” e selecione a pasta `extension` deste projeto.

3) Testar
- Acesse `https://statusinvest.com.br/carteira/patrimonio`.
- Um painel “StatusInvest Latest (da sua API)” deve aparecer no topo da página.
- Se não aparecer:
  - Recarregue a página e confirme que a extensão está ativa.
  - Abra DevTools (F12) → aba Console da página para ver erros do `content.js`.
  - Em `chrome://extensions`, clique em “Service worker” da extensão para abrir o console do `bg.js` e ver erros de rede.

4) CORS
- A API já libera CORS para `https://statusinvest.com.br` e para origens `chrome-extension://...` (service worker e content).
- Se mudar domínios ou precisar liberar outro site, ajuste a lista em `api/statusinvest-latest.js`.
#   e x t e n c a o _ s t a t u s i n v e s t 
 
 