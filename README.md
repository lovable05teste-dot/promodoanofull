# Sales Page Clone

clone esta pagina de vendas

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://atividadesinfantilpro.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/3dbedfd1-52b0-48de-ac98-9fd2d062a3d9).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Deploy na Vercel

O build usa Vite com TanStack Start e Nitro no preset `vercel`. O servidor é
necessário para gerar e consultar o Pix sem expor o token da FortPay no navegador.

1. Importe este repositório na Vercel, usando a raiz do projeto.
2. Use o framework **TanStack Start**, Node.js **22.x** ou **24.x** e o comando
   de build `npm run build`. A instalação está definida como `npm ci --include=dev`.
3. Deixe o diretório de saída no padrão do framework: Nitro gera automaticamente
   `.vercel/output`. Não configure `dist` como saída de um site estático.
4. Configure `FORTPAY_API_TOKEN` em Settings > Environment Variables para o Pix.
   Opcionalmente configure `FORTPAY_BASE_URL` se usar um endpoint diferente.
   Nunca use o prefixo `VITE_` no token, pois esse prefixo expõe valores ao navegador.
5. Faça o deploy. As rotas de produto e checkout são atendidas pelo servidor.

Para conferir o mesmo build localmente:

```sh
npm ci --include=dev
npm run build
```

O `package-lock.json` fixa as dependências para a instalação reproduzível na Vercel.
