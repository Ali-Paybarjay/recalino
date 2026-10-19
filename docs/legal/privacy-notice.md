# Recalino Privacy Notice

Version 0.3 · Draft · 19 October 2026

> **Draft for development only.** This text is not final and has not had a legal review. Parts marked ⟨…⟩ are not finished.

## 1. Who we are

Recalino is run by {{operator_name}} ("we", "us"). We decide how your personal data is used in Recalino. In data protection law, this makes us the "controller".

Contact: {{operator_email}}

## 2. The short version

- Your classes, notes and cards are private to your account.
- Your recordings stay on your device. We send a temporary copy of the audio to our server only to make a transcript. Then we delete it automatically.
- We use AI services to make transcripts, read photos and documents, write notes and cards, and make computer voices.
- Our database and private file storage are configured in London, UK. Sign-in and AI services can process data outside the UK.
- We don't sell your data. We don't show ads.
- You can download your notes and cards. You can delete your data at any time.

## 3. Data we collect

### Your account

- Your email address and your Google account ID. Google sends these when you sign in. Supabase, our sign-in service, also stores Google account details including your name, the address of your profile picture, and identity verification details. Recalino does not use your Google name or picture to make learning materials or to display your learning profile.
- That you said you are 18 or older, and when.
- Which versions of our texts you accepted, and when: these Terms of Use, this Privacy Notice, the recording consent and the sources notice.

### Your learning profile

- Your first language and your explanation language.
- Your time zone.
- If you choose: your English level and your learning goal.

### Your classes

- Class audio that you send for processing, from a recording or an audio file.
- Photos, PDFs and other files that you add.
- Transcripts, notes and cards that Recalino makes, and your changes to them.
- Your review history: which cards you reviewed, when, and your answers.
- Your allowance, and how much of it you used.

Photos can contain hidden details, for example the place where the photo was taken. We keep your original photos privately, as you sent them. Recalino uses the capture time for class context and does not display the place. When a photo is selected for AI processing, the original image bytes can include these hidden details. When you download notes or cards, we remove these hidden details from the included photos.

### Passwords for PDF files

If a PDF has a password and you type it, we use the password only to open the file. We never save it, and we never send it to AI services.

### Security and technical records

- Times, request numbers, error codes and security events, for example too many sign-in attempts.
- We use your IP address to stop attacks. In our own records, we don't save it as it is. We save only a coded version (a "hash"), for a short time.
- The companies that run our servers and sign-in (section 6) may keep IP addresses in their own security logs. ⟨Before the pilot: check how long they keep them.⟩
- Our records never contain your class content, audio, passwords or keys.

### Usage records

- Simple records of what happens in the app, for example "a review was finished". We use them to see if Recalino helps learners, and to fix problems. They don't contain your class content.

### Messages and reports

- If you email us or use "Report a problem", we use what you send to answer you and to fix the problem.

We don't ask for your date of birth. We don't collect payment details, because the pilot is free.

## 4. Other people in your classes

Your recordings can include your teacher's and classmates' voices. Your files can include names.

- We use this data only to make your notes and cards.
- We delete class audio from our server soon after the transcript is made (see section 8).
- Recalino does not reliably identify who is speaking. A transcript may have speaker labels supplied by the service, or no labels. Voices and names are not made anonymous.
- Downloaded notes do not include the class audio or the full transcript. Names can still appear in selected class material or notes; check them before sharing a download.

If you are a teacher or a classmate and you have a question about a recording, please contact us.

## 5. Why we use your data, and our legal reasons

UK data protection law (UK GDPR) says that we need a legal reason for each use of personal data.

| What we do | Our legal reason |
|---|---|
| Create your account and run Recalino for you: store your materials, make transcripts, notes and cards, and plan your reviews | We need it to give you the service you asked for (contract) |
| Use your teacher's and classmates' voices and names in your class materials, to make your notes and cards | Legitimate interests: helping you study your own class. We keep this small: we delete the audio from our server soon after the transcript is made. |
| Keep Recalino and your account safe | Legitimate interests: protecting you, other users and Recalino |
| Use usage records to improve Recalino | Legitimate interests: making the pilot work well |
| Keep records that the law asks us to keep | Legal obligation |

⟨Before the pilot: confirm each legal reason, and record the checks for "legitimate interests".⟩

## 6. Companies that help us

Other companies help us run Recalino. The table describes the current services and possible AI processing routes. Google also uses data under its own privacy notice. The final account terms, retention settings and international transfer arrangements still need to be confirmed before the pilot processes real class materials.

| Company | What it does for us | Where your data is |
|---|---|---|
| Vercel | Runs the app and stores your files privately | App functions and private file storage are configured in London, UK; other service operations may be outside the UK |
| Supabase | Runs our database and sign-in; stores the Google account details described in section 3 | The project database is in London, UK; this does not limit all sign-in or service operations to London |
| Google | Lets you sign in with your Google account | Google services can process data outside the UK; Google's own privacy notice applies |
| OpenRouter | Routes AI requests: selected text and instructions, image bytes, audio chunks for transcripts, and text for computer voices | Uses the public OpenRouter service and may route processing outside the UK |
| Amazon Web Services (Bedrock) and Google Cloud (Vertex AI) | Possible processors of selected text and images for notes and cards with the current default model | Possible routes include the USA, Europe and routes labelled global; processing is not restricted to the UK |
| DeepInfra and Groq | Possible processors of audio chunks for transcripts with the current default model | Includes a USA route; other route labels do not establish an exact processing location |
| DeepInfra and Together | Possible processors of text for computer voices with the current default model | Includes a USA route; other route labels do not establish an exact processing location |

The AI companies that actually process a request depend on the chosen model and available routes. A model's name does not by itself identify the company running it. We need to review these routes whenever models or service settings change.

Recalino requests routes with zero data retention and denies data collection by the routed AI providers. It also disables OpenRouter response caching. These request settings are not a guarantee that every company keeps no data or never uses data for training. OpenRouter account settings for content logging and use are separate. OpenRouter keeps request metadata, such as token counts and response times, and service terms have exceptions. ⟨Before processing real class materials: confirm the account settings, applicable terms, provider retention and training rules, and publish the completed information here.⟩ See [OpenRouter's data collection information](https://openrouter.ai/docs/guides/privacy/data-collection) and [zero data retention information](https://openrouter.ai/docs/guides/features/zdr).

We do not send the password for a PDF, a private file link or a storage key to the AI service. We do not ask it to copy a person's voice.

## 7. Where your data is

- Our project database, app functions and private file storage are configured in London, UK. This does not require Google, OpenRouter or their processing services to keep all data in London.
- Possible AI routes include the USA and other locations outside the UK. Some services have global routes without a confirmed processing country. ⟨Before the pilot: complete the assessment of transfers outside the UK and record the protections that apply to the actual service accounts.⟩
- Your recordings are saved on your device, in your browser's storage.

## 8. How long we keep data

| Data | How long we keep it |
|---|---|
| Copy of class audio on our server | The current temporary upload expires 24 hours after the upload begins, whether processing succeeds or fails. Completing a transcript can shorten this period. A cleanup job runs at least once an hour, removes expired copies and retries failures; a service failure can delay physical removal. A retry after expiry needs a new copy from your device. |
| Recordings on your device | Until you delete them. Recalino doesn't delete them automatically. |
| Photos, PDFs and other files | Until you delete them or your account |
| Transcripts, notes, cards and review history | Until you delete them or your account |
| Account and learning profile | Until you delete your account |
| Completed background-job records | Scheduled for cleanup after 30 days |
| Security, audit and usage records | ⟨Before the pilot: set the retention periods for these separate records and confirm the service companies' periods⟩ |
| Encrypted app database backups | 30-day retention policy. The three newest complete backups are kept even when they are older than 30 days. A backup may contain data that you deleted after it was made |

When a deletion request is accepted, Recalino hides the affected data and queues server cleanup. If cleanup fails, it retries. ⟨Before the pilot: confirm the operational time limit and any records that must be retained.⟩ The app's backup cleanup removes backups after 30 days, except the three newest complete backups, which it keeps until newer complete backups replace them. A minimal encrypted deletion record is kept while a retained backup could otherwise restore the deleted data. The service companies' own backup and log retention still needs to be confirmed.

When the pilot ends, we will tell you before we delete accounts.

## 9. Who can see your data

- Other learners cannot see your classes, notes and cards through Recalino.
- The pilot operator doesn't read your content. If you ask us for help and you agree, we may look only at what we need, for a short time. We keep a record that we did. ⟨Before the pilot: confirm the support access rules.⟩
- The companies in section 6, only to do their work for us.
- Authorities, only if the law requires it.

## 10. Cookies and storage on your device

- We use only the cookies that we need to keep you signed in and to keep your account safe. We don't use cookies for advertising or tracking.
- Recalino saves recordings and some app data in your browser's storage on your device. Recording doesn't work without it.

## 11. Your rights

You have rights over your personal data. You can ask us to:

- give you a copy of your data,
- correct wrong data,
- delete your data,
- stop or limit some uses of your data,
- give you your data in a form that you can move to another service.

You can do many of these things yourself in Recalino: download your notes and cards, delete classes and files, or delete your account. After the server confirms your account deletion request, Recalino tries to remove this account's saved recordings and photos from the browser where you made the request. It shows whether this succeeded and offers a retry if it failed. If confirmation is interrupted, use the deletion screen to finish the same request. Copies on other browsers or devices, and files you already downloaded, need to be removed separately; opening Recalino on another device does not guarantee that its saved copies are deleted.

For anything else, email {{operator_email}}. We will answer within one month.

If you are not happy with how we use your data, you can complain to the Information Commissioner's Office (ICO): ico.org.uk. Please tell us first, so we can try to help.

## 12. Age

Recalino is only for people aged 18 or older. If we learn that a user is under 18, we will close the account and delete the data.

## 13. Automatic decisions

Recalino uses automatic rules, for example to plan your reviews and to count your allowance. These rules don't make decisions about you with legal or similar serious effects.

## 14. How we protect your data

- Your files are private. They can be opened only with links that work for a short time.
- Recalino checks every request, so each person can see only their own data.
- Data is encrypted when it travels between your device and Recalino.
- Our records never contain your class content, audio, passwords or keys.

## 15. Changes to this notice

If we change this notice, Recalino shows you the new version.

## 16. Contact

{{operator_name}} · {{operator_email}}
