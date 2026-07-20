# Chrome Web Store Submission Kit

Everything to paste into the developer dashboard at
https://chrome.google.com/webstore/devconsole (one-time $5 registration).

## Store listing

Name: Roar, kid! — Personal audio EQ for YouTube, Netflix & Prime Video

(The item title updates automatically from the manifest name on package
upload; the summary and description below are dashboard fields — paste them.)

Summary (132 chars max, 126 used — keep identical to the manifest
description):
Personal audio comfort EQ: shapes streaming sound to your audiogram, per ear, with an always-on limiter. Not a medical device.

Description (paragraphs are single lines on purpose — the store field keeps
newlines literally, so paste as-is):
Roar, kid! shapes the sound of YouTube, Netflix, and Prime Video to your personal hearing profile. Instead of a generic equalizer or volume booster, it reads your audiogram — the chart from a hearing test — and applies per-ear, per-frequency compression: quiet sounds get more boost, loud sounds get less, with an always-on output limiter. It is a listening-comfort and accessibility tool, not a medical device.

Who it helps:
• Mild to moderate hearing loss in one or both ears
• Speech that sounds muffled or unclear in videos, series, and films
• High-frequency hearing loss, where turning the volume up doesn't make words clearer

How it works:
• Plot your hearing thresholds on an interactive audiogram drawn to clinical conventions (red O for the right ear, blue X for the left)
• Or import them from a photo of your hearing test report — fully on-device with Chrome's built-in AI where supported (no key, the photo never leaves your computer; best for reports with a printed threshold table), or with your own AI provider API key. Every imported value is shown for review before it is applied, and every point stays editable
• 8 frequency bands (250 Hz–8 kHz), the standard range of diagnostic audiometry
• Independent left/right processing, so each ear gets the boost it needs
• Choose a listening target: Comfort (gentle default), Adult, or Child — the Child target stays locked until an audiologist's guidance is confirmed, and lowers the output ceiling while active
• Optional loudness calibration (options page) anchors the level readout in the popup; until you calibrate, levels are shown as relative only

Private by design: open source, no server, no analytics, no data collection. Your hearing data never leaves your browser.

Roar, kid! is a listening supplement for accessibility — it is not a medical device, provides no diagnosis, and is not a replacement for hearing aids or professional audiological care, especially for children.

Free and open source: github.com/unfairlaw/roar-kid — if it helps someone hear better, you can support development at buymeacoffee.com/guilherme.burzynski

Category: Accessibility
Languages: English (default listing) + Portuguese (Brazil) — pt-BR
localized listing below. In the dashboard, add the second language under
Store listing → "Add language" and paste the pt-BR block there.

## Store listing — Português (Brasil)

Nome: Roar, kid! — EQ de áudio pessoal para YouTube, Netflix e Prime Video

(O título do item segue o nome do manifest; o nome localizado é definido no
bloco de idioma do painel junto com o resumo e a descrição abaixo.)

Resumo (máx. 132 caracteres, 130 usados):
EQ de conforto sonoro: molda o áudio do streaming ao seu audiograma, por orelha, limitador sempre ativo. Não é dispositivo médico.

Descrição (parágrafos em linha única de propósito — o campo da loja
preserva quebras de linha; cole como está):
O Roar, kid! molda o som do YouTube, Netflix e Prime Video ao seu perfil auditivo pessoal. Em vez de um equalizador genérico ou amplificador de volume, ele lê o seu audiograma — o gráfico do exame de audição — e aplica compressão por orelha e por frequência: sons baixos recebem mais reforço, sons altos recebem menos, com um limitador de saída sempre ativo. É uma ferramenta de conforto de escuta e acessibilidade, não um dispositivo médico.

Para quem ajuda:
• Perda auditiva leve a moderada em um ou nos dois ouvidos
• Fala abafada ou pouco clara em vídeos, séries e filmes
• Perda auditiva nas frequências agudas, quando aumentar o volume não deixa as palavras mais claras

Como funciona:
• Marque seus limiares auditivos em um audiograma interativo desenhado nas convenções clínicas (O vermelho para a orelha direita, X azul para a esquerda)
• Ou importe-os de uma foto do seu exame de audiometria — totalmente no dispositivo com a IA integrada do Chrome, quando disponível (sem chave, a foto nunca sai do seu computador; ideal para laudos com tabela impressa de limiares), ou usando sua própria chave de API de um provedor de IA. Cada valor importado é exibido para revisão antes de ser aplicado, e todos os pontos continuam editáveis
• 8 bandas de frequência (250 Hz–8 kHz), a faixa padrão da audiometria diagnóstica
• Processamento independente dos lados esquerdo e direito, para que cada ouvido receba o reforço de que precisa
• Escolha um alvo de escuta: Conforto (padrão, suave), Adulto ou Criança — o alvo Criança permanece bloqueado até a confirmação de orientação fonoaudiológica, e reduz o teto de saída enquanto ativo
• Calibração de volume opcional (página de opções) ancora o indicador de nível do popup; sem calibração, os níveis aparecem apenas como relativos

Privacidade por padrão: código aberto, sem servidor, sem análise de uso, sem coleta de dados. Seus dados auditivos nunca saem do navegador.

O Roar, kid! é um complemento de escuta voltado à acessibilidade — não é um dispositivo médico, não fornece diagnóstico e não substitui aparelhos auditivos nem o acompanhamento fonoaudiológico profissional, especialmente no caso de crianças.

Gratuito e de código aberto: github.com/unfairlaw/roar-kid — se ele ajudar alguém a ouvir melhor, você pode apoiar o desenvolvimento em buymeacoffee.com/guilherme.burzynski

## Single purpose description

Roar, kid! has one purpose: adjusting the audio playback of supported streaming sites (YouTube, Netflix, Prime Video) according to the user's hearing thresholds. All functionality (the audiogram editor, the photo import, the key storage) exists solely to configure that audio processing.

## Permission justifications

storage — Persists the user's hearing thresholds and playback preferences (sync) and their own API keys (local, device-only).

Host permissions youtube.com, netflix.com, primevideo.com, and the amazon.com video paths (/gp/video/, /Amazon-Video/) — Required to inject the content script that processes the audio of each service's video element. The extension runs only on these streaming sites, and on amazon.com only on its video player paths.

Host permissions api.openai.com, api.anthropic.com, generativelanguage.googleapis.com, api.x.ai — Used only by the optional audiogram photo-import feature, which sends the user-selected image directly to the single provider the user chooses, authenticated with the user's own key. No request is made outside this user-initiated action.

## Data usage disclosures (Privacy tab)

Health information: YES — hearing thresholds, stored locally in extension storage; transmitted nowhere by the extension. Photo import either runs fully on-device via Chrome's built-in AI (image transmitted nowhere) or sends the user-selected image to a user-chosen AI provider under the user's own key.
Authentication information: YES — user-supplied API keys, stored in chrome.storage.local only and only if the user presses "Save key"; a key pasted for a single import is used for that request and never stored, and saved keys are deletable in-UI ("Remove key").
Certify: data is not sold, not used for unrelated purposes, not used for creditworthiness. All true — the extension has no server and no analytics.

Privacy policy URL: the repo is public, so paste
https://github.com/unfairlaw/roar-kid/blob/main/roar-kid/PRIVACY_POLICY.md

## Remote code

Declare "No, I am not using remote code." All logic ships in the package;
API calls exchange data (JSON), not executable code. This matters: MV3
review rejects remotely hosted code.

## Assets

Screenshots: five 1280×800 PNGs in `store-screenshots/`, ALL current for
**0.5.0** (2026-07-20): 03 YouTube hero with the popup open (manual
retake, avatar cropped out), 01 popup with target selector + WDRC toggle,
02 options keys + photo import, 04 options loudness-anchor section, 05
options calibration/response-shape section with the mic-correction
import. All plotted curves are throwaway data, no third-party brand
imagery or personal traces in frame. Dashboard order: 03, 01, 02, 04,
05 — all five slots used.
Optional small promo tile 440×280 — not made.

## Submission steps (first-time — done 2026-07-19, kept for reference)

1. `zip` the extension folder contents (this kit produces
   roar-kid-store.zip with only runtime files — no Python, no docs).
2. Dashboard → New item → upload zip.
3. Paste listing text, justifications, and disclosures from this file.
4. Add screenshots and the privacy policy URL.
5. Submit. Review for extensions with host permissions and health data
   typically takes several days; respond to any reviewer email promptly.

## Updating a published release (0.5.0 over the live 0.3.0, 2026-07-20)

v0.3.0 was approved and published on 2026-07-20. To ship an update:

1. Rebuild `roar-kid-store.zip` per `PACKAGING.md` (folder synced from
   `roar-kid/`, manifest at the archive root, no `__pycache__`). The
   manifest version must be strictly greater than the live one, and its
   description must stay ≤132 characters or the upload is rejected.
2. Dashboard → the existing item → Package → **Upload new package** →
   `roar-kid-store.zip`.
3. The item title follows the manifest name automatically ("Audiogram EQ"
   → "Personal audio EQ" in 0.5.0). The summary, description, and
   screenshots are dashboard fields — paste the refreshed EN and pt-BR
   text from this file so the listing matches the new framing.
4. 0.5.0 adds NO new permissions (`storage` and the host list are
   unchanged; `web_accessible_resources` for the worklets is not a
   permission), so no new justifications are needed and existing users get
   no re-approval prompt. The Privacy-tab disclosures still hold as
   written.
5. Submit. Updates to an approved item with unchanged permissions
   typically review faster than the initial submission; existing installs
   auto-update once published.

If a reviewer asks about 0.5.0: it is strictly more conservative than the
approved 0.3.0 — the Child target is locked behind an audiologist-guidance
attestation and lowers the output ceiling to −7 dBFS while active, the
limiter clamps every ceiling request to ≤−1 dBFS (it can be lowered, never
raised), level/dose readouts are suppressed until the user calibrates, and
"Not a medical device" now appears in the manifest description itself.

## Test instructions (dashboard "Testing instructions" field)

The field is capped at 500 characters — paste this 498-char version
(updated for 0.5.0: preempts "Child button greyed out" and "no level
numbers shown" being filed as bugs — both are by design):

No login needed. 1) Play youtube.com/watch?v=aqz-KE-bpKQ (openly licensed film). 2) Click the icon, plot points (40-50 dB HL at 2k-8k Hz is clearly audible); audio changes as you plot. Toggle "on" to A/B. Also runs on Netflix/Prime. New in 0.5.0: target selector (Child locked unless attested in options) + loudness anchor; level/dose show only after anchoring. Photo import: user's OWN key (none ships), or on-device Chrome AI where supported. Test image: icons-preview/test_audiogram.png in repo.

Fuller reference version (for reviewer email replies, too long for the field):

No account, login, or credentials are required for the core functionality.

1. Install the extension. Open https://www.youtube.com/watch?v=aqz-KE-bpKQ (Big Buck Bunny, an openly licensed film — no YouTube account needed) and start playback.
2. Click the extension icon. In the popup, click/drag on the audiogram chart to plot hearing thresholds — for an audible effect, place points around 40–50 dB HL at 2k–8k Hz. Use the "O right" / "X left" buttons to switch ears.
3. The audio changes immediately as points are plotted (per-ear, frequency-dependent boost with output limiting). Toggle the "on" checkbox to A/B the processed vs. original sound; the "vol" slider adjusts overall level.
4. The same processing runs on netflix.com and primevideo.com if you have a subscription; YouTube alone demonstrates all functionality.

Optional feature — photo import (options page): extracts thresholds from a photo of a hearing-test report, always shown for review before being applied. It has two paths: (a) with the user's own API key for OpenAI, Anthropic, Google, or xAI — no key ships with the extension, users bring their own, so testing this path requires any valid key for one of those providers; (b) on hardware that supports Chrome's built-in AI, an "Extract with Chrome's built-in AI" button appears and runs fully on-device with no key — this button is availability-gated by Chrome itself and will not appear on unsupported machines. A synthetic test report image is available in the public repository: https://github.com/unfairlaw/roar-kid/blob/main/icons-preview/test_audiogram.png

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
