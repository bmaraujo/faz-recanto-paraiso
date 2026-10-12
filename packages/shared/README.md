# @recanto/shared — Tipos e domínio compartilhados

Código usado tanto pelo `backend/` quanto pelo `site/`.

## O que fica aqui

| Conteúdo | Por quê |
|---|---|
| **Tipos** de todas as entidades | Uma definição, duas pontas |
| **Schemas zod** | A mesma validação no servidor e no formulário |
| `calcularCotacao` e `validarConfigPrecos` | O simulador do site usa a **mesma função** do servidor |
| Formatação de moeda, data e telefone (pt-BR) | Consistência entre tela e e-mail |
| Lista fechada de comodidades | Ícones e tradução consistentes |
| Aritmética de datas sobre `YYYY-MM-DD` | A fonte mais comum de bug do projeto |

## O que NÃO fica aqui

Nada que faça I/O: sem AWS SDK, sem `fetch`, sem acesso a arquivo. Este pacote é
**puro** e roda igual no Node e no navegador.

## Aviso importante

O simulador do navegador usar a mesma função do servidor é conveniente, **mas não
dispensa o recálculo no servidor**:

- O **cliente** executa com a configuração que veio publicada no HTML.
- O **servidor** executa com a configuração que ele lê do banco.

Mesma lógica, fontes de dados independentes. O cliente é um atalho de UX; o servidor é
a autoridade. Divergência entre os dois é **bug**, e em `dev` o cliente loga um aviso
no console quando os valores diferem.
