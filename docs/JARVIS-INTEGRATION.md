# Integração JARVIS no HighGAS

A aba **JARVIS** do HighGAS foi criada como uma integração web independente inspirada nas funções documentadas em:

- https://github.com/Twsman1/JARVIS/tree/master

## Por que não copiar o código Python diretamente

O projeto de referência é um aplicativo desktop Python (Tkinter + Vosk + Whisper + pyttsx3 + Ollama/OpenJarvis) e não pode executar dentro de uma aplicação Vite hospedada na Vercel.

Além disso, o próprio README do projeto informa que o repositório não possui licença explícita. Por isso, nenhum código-fonte dele foi copiado para o HighGAS.

## O que a aba web faz

- reconhecimento de voz em português quando o navegador oferece SpeechRecognition;
- síntese de voz pt-BR pelo navegador;
- navegação por voz entre Início, Países, Proteção e Diagnóstico;
- consulta do IP observado e da localização reportada;
- atualização do IP;
- consulta da saída HighGAS selecionada;
- campo de comando manual quando voz não estiver disponível.

## Modo offline completo

Para Vosk, Whisper local, wake-word e LLM local via Ollama/OpenJarvis, use o projeto original como aplicativo separado no computador. A aba HighGAS mantém um link direto para ele.
