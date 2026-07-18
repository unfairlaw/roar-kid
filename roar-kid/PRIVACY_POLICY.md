# Roar, kid! Privacy Policy

Last updated: July 18, 2026

Roar, kid! is an open-source browser extension that applies audiogram-driven
audio processing to playback on supported streaming sites (YouTube, Netflix,
Prime Video). This policy describes what data the
extension handles and where it goes. The short version: Roar, kid! has no
server, collects nothing, and transmits data only to an AI provider you
choose, only when you explicitly use the photo-import feature, using your
own API key.

## Data the extension stores

Hearing threshold values (sixteen numbers in dB HL) and playback preferences
(enabled state, master volume) are stored in your browser via
`chrome.storage.sync`, which Chrome may sync across your own signed-in
browsers. Your API key is stored only if you press "Save key", and then via
`chrome.storage.local` only, which never leaves the device; a key pasted
just for one import is used for that request and never stored, and a saved
key can be deleted at any time with "Remove key". Roar, kid!
operates no backend and receives none of this data; the developers cannot
see it.

## Data the extension transmits

Nothing is transmitted during normal listening. Audio processing happens
entirely inside your browser.

On devices that support Chrome's built-in AI, the photo import can run
entirely on-device: the image is processed locally by the browser's own
model and is transmitted nowhere, and no API key is involved.

If instead you use the photo import with an AI provider, the photo you
select is sent directly from your browser to the provider you choose
(OpenAI, Anthropic, Google, or xAI), authenticated with the API
key you supplied, for the sole purpose of extracting hearing thresholds.
The image is not sent anywhere else and is not retained by the extension.
Handling of the image by the provider is governed by that provider's own
privacy policy and API data-usage terms, so we recommend cropping out any
patient-identifying information (name, date of birth, record numbers)
before uploading — the interface reminds you of this, and the extraction
prompt additionally instructs the model to ignore any identifying
information that remains.

## Health information

Hearing thresholds are health information. Roar, kid! treats them accordingly:
they exist only in your browser's extension storage, are never transmitted
by the extension, and can be deleted at any time by clearing the extension's
storage or uninstalling it. Roar, kid! is not a medical device, provides no
diagnosis, and is not a substitute for professional audiological care.

## Data retention and deletion

Uninstalling the extension removes all locally stored data. Threshold
values synced through your Chrome profile can be cleared from any of your
browsers via the extension popup or by uninstalling.

## Children

Roar, kid! may be configured by a parent or guardian for a child's listening.
The extension itself collects no personal information from any user, child
or adult.

## Changes and contact

Changes to this policy will be published in the project repository
alongside the source code. Questions and issues can be raised through the
repository's issue tracker.
