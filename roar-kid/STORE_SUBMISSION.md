# Chrome Web Store Submission Kit

Everything to paste into the developer dashboard at
https://chrome.google.com/webstore/devconsole (one-time $5 registration).

## Store listing

Name: Roar, kid! — Audiogram EQ for YouTube, Netflix & Prime Video

Summary (132 chars max, 125 used):
Hear YouTube, Netflix & Prime Video clearly with mild hearing loss:
audiogram equalizer, per-ear boost. Not a medical device.

Description:
Roar, kid! makes YouTube, Netflix, and Prime Video easier to hear for
people who are hard of hearing or have mild hearing loss. Instead of a
generic equalizer or volume booster, it reads your clinical audiogram —
the hearing test chart your audiologist gives you — and applies per-ear,
per-frequency compression modeled on how real hearing aids amplify sound:
quiet sounds boosted more, loud sounds boosted less, with an always-on
output limiter to protect your ears.

Who it helps:
• Mild to moderate hearing loss in one or both ears
• Speech that sounds muffled or unclear in videos, series, and films
• High-frequency hearing loss, where turning the volume up doesn't make
  words clearer

How it works:
• Plot your hearing thresholds on an interactive audiogram drawn to
  clinical conventions (red O for the right ear, blue X for the left)
• Or import them from a photo of your hearing test report using your own
  AI provider API key — every imported value is shown for review before it
  is applied, and every point stays editable
• 8 frequency bands (250 Hz–8 kHz), the standard range of diagnostic
  audiometry
• Independent left/right processing, so each ear gets the boost it needs

Private by design: open source, no server, no analytics, no data
collection. Your hearing data never leaves your browser.

Roar, kid! is a listening supplement for accessibility — it is not a
medical device, provides no diagnosis, and is not a replacement for
hearing aids or professional audiological care, especially for children.

Category: Accessibility
Languages: English (default listing) + Portuguese (Brazil) — pt-BR
localized listing below. In the dashboard, add the second language under
Store listing → "Add language" and paste the pt-BR block there.

## Store listing — Português (Brasil)

Nome: Roar, kid! — EQ por audiograma para YouTube, Netflix e Prime Video

Resumo (máx. 132 caracteres, 129 usados):
Ouça YouTube, Netflix e Prime Video com clareza: equalizador baseado no
audiograma, reforço por orelha. Não é dispositivo médico.

Descrição:
O Roar, kid! torna YouTube, Netflix e Prime Video mais fáceis de ouvir
para quem tem perda auditiva leve ou baixa audição. Em vez de um
equalizador genérico ou amplificador de volume, ele lê o seu audiograma
clínico — o exame de audiometria que o fonoaudiólogo entrega — e aplica
compressão por orelha e por faixa de frequência, modelada na forma como
aparelhos auditivos reais amplificam o som: sons baixos recebem mais
reforço, sons altos recebem menos, com um limitador de saída sempre ativo
para proteger seus ouvidos.

Para quem ajuda:
• Perda auditiva leve a moderada em um ou nos dois ouvidos
• Fala abafada ou pouco clara em vídeos, séries e filmes
• Perda auditiva nas frequências agudas, quando aumentar o volume não
  deixa as palavras mais claras

Como funciona:
• Marque seus limiares auditivos em um audiograma interativo desenhado
  nas convenções clínicas (O vermelho para a orelha direita, X azul para
  a esquerda)
• Ou importe-os de uma foto do seu exame de audiometria usando sua
  própria chave de API de um provedor de IA — cada valor importado é
  exibido para revisão antes de ser aplicado, e todos os pontos continuam
  editáveis
• 8 bandas de frequência (250 Hz–8 kHz), a faixa padrão da audiometria
  diagnóstica
• Processamento independente dos lados esquerdo e direito, para que cada
  ouvido receba o reforço de que precisa

Privacidade por padrão: código aberto, sem servidor, sem análise de uso,
sem coleta de dados. Seus dados auditivos nunca saem do navegador.

O Roar, kid! é um complemento de escuta voltado à acessibilidade — não é
um dispositivo médico, não fornece diagnóstico e não substitui aparelhos
auditivos nem o acompanhamento fonoaudiológico profissional,
especialmente no caso de crianças.

## Single purpose description

Roar, kid! has one purpose: adjusting the audio playback of supported
streaming sites (YouTube, Netflix, Prime Video) according to the user's
hearing thresholds. All functionality (the audiogram editor, the photo
import, the key storage) exists solely to configure that audio processing.

## Permission justifications

storage — Persists the user's hearing thresholds and playback preferences
(sync) and their own API keys (local, device-only).

Host permissions youtube.com, netflix.com, primevideo.com, and the
amazon.com video paths (/gp/video/, /Amazon-Video/) — Required to inject
the content script that processes the audio of each service's video
element. The extension runs only on these streaming sites, and on
amazon.com only on its video player paths.

Host permissions api.openai.com, api.anthropic.com,
generativelanguage.googleapis.com, api.x.ai — Used only by the optional
audiogram photo-import feature, which sends the user-selected image
directly to the single provider the user chooses, authenticated with the
user's own key. No request is made outside this user-initiated action.

## Data usage disclosures (Privacy tab)

Health information: YES — hearing thresholds, stored locally in extension
storage; transmitted nowhere by the extension. Photo import sends a
user-selected image to a user-chosen AI provider under the user's own key.
Authentication information: YES — user-supplied API keys, stored in
chrome.storage.local only and only if the user presses "Save keys"; a key
pasted for a single import is used for that request and never stored.
Certify: data is not sold, not used for unrelated purposes, not used for
creditworthiness. All true — the extension has no server and no analytics.

Privacy policy URL: host PRIVACY_POLICY.md publicly (GitHub Pages or the
repo's raw URL) and paste that link.

## Remote code

Declare "No, I am not using remote code." All logic ships in the package;
API calls exchange data (JSON), not executable code. This matters: MV3
review rejects remotely hosted code.

## Assets still needed before submission

Screenshots: at least one, 1280×800 or 640×400 PNG. Recommended set: the
popup audiogram with plotted thresholds, the options page, and YouTube
playing with the popup open. Take these on a machine with the extension
loaded; do not stage fake data — plot a plausible mild-loss audiogram.
Optional small promo tile 440×280.

## Submission steps

1. `zip` the extension folder contents (this kit produces
   roar-kid-store.zip with only runtime files — no Python, no docs).
2. Dashboard → New item → upload zip.
3. Paste listing text, justifications, and disclosures from this file.
4. Add screenshots and the privacy policy URL.
5. Submit. Review for extensions with host permissions and health data
   typically takes several days; respond to any reviewer email promptly.

## Review-risk notes

Name: "Roar, kid!" is an original name. As of July 2026 no Chrome Web
Store extension or USPTO-indexed trademark with this name was found, and
roarkid.com was unregistered. The lion icon is original art drawn for this
project (generator scripts in the repo's icons-preview/). Nothing in the
listing references any game, film, or brand — keep it that way.

The words "hearing" and "medical" attract scrutiny: the listing and UI
consistently state it is not a medical device, which is the correct posture.
The `anthropic-dangerous-direct-browser-access` header is an official
Anthropic opt-in, not a bypass, but if a reviewer questions it, point to
Anthropic's CORS documentation.

Decision (2026-07-18): v1 ships complete — the multi-service build
(YouTube + Netflix + Prime Video, Web Audio taps verified on real
accounts), photo import included, with all four AI host permissions. Do not preemptively strip the import. If a
reviewer pushes back on those permissions, respond with the justifications
above; only if the submission is formally rejected over them would a
reduced build (import via the Python CLI only) be considered, as a
resubmission — not as the first attempt.
