/* HyllySanelu – first field-test version. All inspection data stays on this device. */
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const STORAGE_KEY = 'hyllysanelu-state-v1';
const DB_NAME = 'hyllysanelu-media-v1';
const DB_STORE = 'media';

const PARTS = ['Diagonaali','Etupystypylväs','Takapystypylväs','Etuvaakapalkki','Takavaakapalkki','Alavaakatuki','Ylävaakatuki','Vaakatuki','Vaakapalkin varmistin','Törmäyssuoja','Törmäyssuojan kiinnitys','Aluslevyn kiinnitys','Täytealuslevy','Keskiside','Ristiside'];
const DAMAGE_TYPES = ['Painauma','Repeämä','Ruoste','Viilto','Halkeama','Saumavaurio','Kiertymä','Irronnut','Taipuma','Puute','Murtuma','Pois paikaltaan','Hitsisauma vaurioitunut','Muu'];
const CLASSES = ['Vihreä','Oranssi','Punainen','Muu'];
const ACTIONS = ['Seuraa','Vaihda/korjaa 4 viikon kuluessa','Aseta käyttökieltoon','Lisää','Kiristä','Tarkista','Vaihda','Korjaa','Asenna','Laita paikalleen','Kiinnitä','Poista'];
const CLASS_ACTION = { Vihreä:'Seuraa', Oranssi:'Vaihda/korjaa 4 viikon kuluessa', Punainen:'Aseta käyttökieltoon', Muu:'Tarkista' };
const LEVEL_PARTS = new Set(['Diagonaali','Etuvaakapalkki','Takavaakapalkki']);

let state = loadState();
let draft = blankDraft();
let stream = null;
let recorder = null;
let chunks = [];
let videoBlob = null;
let activeStep = 0;
let recognition = null;

const BASE_STEPS = [
  { key:'location', label:'VARASTOPAIKKA', title:'Näytä varastopaikan tunnus', prompt:'Suuntaa kamera QR- tai viivakoodiin. Voit myös kirjoittaa varastopaikan käsin.' },
  { key:'video', label:'VAURIOKUVA', title:'Kuvaa vaurioitunut kohta', prompt:'Aloita videoleike. Kuvaa vaurio riittävän läheltä ja ota raporttikuva.' },
  { key:'part', label:'VAURIOITUNUT OSA', title:'Sano vaurioitunut osa', prompt:'Voit sanoa osan nimen tai valita sen näytöltä.' },
  { key:'level', label:'TASO / JÄRJESTYSNUMERO', title:'Sano taso tai järjestysnumero', prompt:'Tämä tieto tarvitaan diagonaalille sekä etu- ja takavaakapalkille.' },
  { key:'damageType', label:'VAURIOTYYPPI', title:'Sano vauriotyyppi', prompt:'Voit sanoa esimerkiksi painauma, kiertymä, taipuma tai muu.' },
  { key:'classification', label:'VAURIOLUOKITUS', title:'Sano vaurioluokka', prompt:'Sano vihreä, oranssi, punainen tai muu.' },
  { key:'action', label:'TOIMENPIDE', title:'Hyväksy tai korjaa toimenpide', prompt:'Sovellus ehdottaa toimenpidettä vaurioluokan perusteella.' },
  { key:'notes', label:'LISÄTIEDOT', title:'Haluatko lisätä huomion?', prompt:'Voit sanella vapaamuotoisen lisähuomion tai jättää kohdan tyhjäksi.' }
];

function blankDraft() { return { location:'', part:'', level:'', damageType:'', classification:'', action:'', notes:'', snapshot:'', videoMediaId:'', videoDuration:'' }; }
function defaultState() { return { inspection:{site:'', inspector:'', date:new Date().toISOString().slice(0,10), notes:''}, observations:[] }; }
function loadState() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultState(); } catch { return defaultState(); } }
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); flashSave(); }
function flashSave() { const el = $('#saveState'); el.textContent = 'Tallennettu paikallisesti'; el.classList.add('saved'); setTimeout(() => el.classList.remove('saved'), 900); }
function uid() { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function normalize(value='') { return value.toLocaleLowerCase('fi').replace(/[–—-]/g,' ').replace(/[^a-zåäö0-9/ ]/gi,' ').replace(/\s+/g,' ').trim(); }

function showView(id) { $$('.view').forEach(view => view.classList.toggle('active', view.id === id)); window.scrollTo({top:0, behavior:'smooth'}); }
function visibleSteps() { return BASE_STEPS.filter(step => step.key !== 'level' || LEVEL_PARTS.has(draft.part)); }
function currentStep() { return visibleSteps()[activeStep]; }
function currentStepIndex() { return visibleSteps().findIndex(step => step.key === currentStep()?.key); }

function renderHome() {
  const data = state.inspection;
  $$('[data-inspection-title]').forEach(el => el.textContent = data.site || 'Ei nimettyä tarkastusta');
  $('#inspectionMeta').innerHTML = [
    ['Tarkastaja', data.inspector || 'Ei määritetty'], ['Päivä', data.date || 'Ei määritetty'], ['Lisätiedot', data.notes || '–']
  ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
  $('#observationCount').textContent = state.observations.length;
  const list = $('#observationList');
  if (!state.observations.length) { list.className = 'observation-list empty-state'; list.textContent = 'Ei havaintoja vielä.'; return; }
  list.className = 'observation-list';
  list.innerHTML = state.observations.map((observation, index) => `
    <article class="observation-row">
      <span class="status-dot ${classSlug(observation.classification)}" aria-label="${escapeHtml(observation.classification)}"></span>
      <div><h3>${escapeHtml(observation.location)} · ${escapeHtml(observation.part)}</h3><p>${escapeHtml(observation.damageType || 'Vauriotyyppi ei määritetty')} · ${escapeHtml(observation.action)}</p></div>
      <button class="delete-observation" data-delete="${index}">Poista</button>
    </article>`).join('');
}

function openInspection() {
  const form = $('#inspectionForm');
  Object.entries(state.inspection).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value || ''; });
  showView('inspectionView');
}

function startObservation() {
  draft = blankDraft(); videoBlob = null; chunks = []; activeStep = 0;
  showView('guidedView'); renderGuided();
}

function renderGuided() {
  const steps = visibleSteps();
  if (activeStep >= steps.length) { openReview(); return; }
  const step = currentStep();
  $('#stepCounter').textContent = `${activeStep + 1} / ${steps.length}`;
  $('#progressBar').style.width = `${((activeStep + 1) / steps.length) * 100}%`;
  $('#stepLabel').textContent = `VAIHE ${activeStep + 1} · ${step.label}`;
  $('#guidedTitle').textContent = step.title;
  $('#promptText').textContent = step.prompt;
  $('#previousStep').disabled = activeStep === 0;
  $('#nextStep').textContent = activeStep === steps.length - 1 ? 'Tarkista havainto →' : 'Seuraava →';
  renderAnswer(step);
  renderCamera(step);
  speak(step.title + '. ' + step.prompt);
}

function renderCamera(step) {
  const cameraNeeded = step.key === 'location' || step.key === 'video';
  $('.camera-card').style.display = cameraNeeded ? 'block' : 'none';
  if (!cameraNeeded && recorder?.state === 'recording') stopRecording();
  $('#scanLocation').disabled = !stream || step.key !== 'location';
  $('#recordVideo').disabled = !stream || step.key !== 'video';
  $('#takeSnapshot').disabled = !stream || step.key !== 'video';
  if (draft.snapshot && step.key === 'video') $('#cameraStatus').textContent = 'Raporttikuva on tallennettu.';
}

function renderAnswer(step) {
  const area = $('#answerArea');
  const htmlInput = (name, placeholder, value, type='text') => `<label class="answer-input">${placeholder}<input id="answerInput" type="${type}" value="${escapeAttr(value)}" placeholder="${placeholder}" /></label>`;
  let content = '';
  if (step.key === 'location') content = `${htmlInput('location','Varastopaikka',draft.location)}<p class="muted small">QR-/viivakoodin luku täyttää kentän automaattisesti, jos laite tukee sitä.</p>`;
  if (step.key === 'video') content = `<h3>Videoleike ja raporttikuva</h3><p class="muted">Videolle tallentuu tarkastajan oma arvio. Raporttiin liitetään valitsemasi pysäytyskuva.</p>${draft.snapshot ? `<img class="snapshot" src="${draft.snapshot}" alt="Raporttikuva vauriosta" />` : '<p class="muted">Raporttikuvaa ei ole vielä otettu.</p>'}`;
  if (step.key === 'part') content = optionGrid(PARTS, draft.part);
  if (step.key === 'level') content = htmlInput('level','Taso tai järjestysnumero',draft.level);
  if (step.key === 'damageType') content = `${optionGrid(DAMAGE_TYPES, draft.damageType)}<button id="skipDamageType" class="button text-button" type="button">Jätä vauriotyyppi määrittämättä</button>`;
  if (step.key === 'classification') content = optionGrid(CLASSES, draft.classification);
  if (step.key === 'action') { const suggestion = CLASS_ACTION[draft.classification] || 'Tarkista'; content = `<p class="muted">Ehdotus luokituksen perusteella: <strong>${escapeHtml(suggestion)}</strong></p>${optionGrid(ACTIONS, draft.action || suggestion)}`; if (!draft.action) draft.action = suggestion; }
  if (step.key === 'notes') content = `<label class="answer-input">Lisähuomio<textarea id="answerInput" rows="5" placeholder="Voit kirjoittaa tai sanella lisähuomion.">${escapeHtml(draft.notes)}</textarea></label><button id="skipNotes" class="button text-button" type="button">Ei lisähuomioita</button>`;
  area.innerHTML = `<h3>${step.label}</h3>${content}${voiceControls(step)}`;
  bindAnswerEvents(step);
}

function optionGrid(options, selected) { return `<div class="option-grid">${options.map(option => `<button type="button" class="option-button ${option === selected ? 'selected' : ''}" data-option="${escapeAttr(option)}">${escapeHtml(option)}</button>`).join('')}</div>`; }
function voiceControls(step) { return `<div class="voice-row"><button type="button" id="listenAnswer" class="button secondary">🎙️ Vastaa puhumalla</button><span id="voiceStatus" class="voice-status">Puheentunnistus käyttää laitteen tukea. Voit aina valita myös näytöltä.</span></div>`; }

function bindAnswerEvents(step) {
  $$('.option-button').forEach(button => button.addEventListener('click', () => { setDraftValue(step.key, button.dataset.option); renderGuided(); }));
  const answer = $('#answerInput'); if (answer) answer.addEventListener('input', event => setDraftValue(step.key, event.target.value));
  $('#skipDamageType')?.addEventListener('click', () => { draft.damageType = ''; nextStep(); });
  $('#skipNotes')?.addEventListener('click', () => { draft.notes = ''; nextStep(); });
  $('#listenAnswer')?.addEventListener('click', () => listenForAnswer(step));
}

function setDraftValue(key, value) {
  draft[key] = value;
  if (key === 'classification') draft.action = CLASS_ACTION[value] || 'Tarkista';
  if (key === 'part' && !LEVEL_PARTS.has(value)) draft.level = '';
}

function validateStep(step) {
  if (step.key === 'location' && !draft.location.trim()) return 'Anna varastopaikka tai lue tunnus kameralla.';
  if (step.key === 'part' && !draft.part) return 'Valitse tai sano vaurioitunut osa.';
  if (step.key === 'level' && !draft.level.trim()) return 'Anna taso tai järjestysnumero.';
  if (step.key === 'classification' && !draft.classification) return 'Valitse tai sano vaurioluokka.';
  if (step.key === 'action' && !draft.action) return 'Valitse toimenpide.';
  return '';
}
function nextStep() { const error = validateStep(currentStep()); if (error) return alert(error); activeStep += 1; renderGuided(); }
function previousStep() { activeStep = Math.max(0, activeStep - 1); renderGuided(); }

async function openCamera() {
  try {
    stopCamera();
    stream = await navigator.mediaDevices.getUserMedia({ video:{facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080}}, audio:true });
    const preview = $('#cameraPreview'); preview.srcObject = stream; await preview.play(); preview.classList.add('visible'); $('#cameraPlaceholder').style.display = 'none';
    $('#cameraStatus').textContent = 'Kamera on valmis.'; renderCamera(currentStep());
  } catch (error) { alert('Kameraa tai mikrofonia ei voitu avata. Tarkista laitteen käyttöoikeudet.'); console.error(error); }
}
function stopCamera() { if (stream) { stream.getTracks().forEach(track => track.stop()); stream = null; } $('#cameraPreview').srcObject = null; $('#cameraPreview').classList.remove('visible'); $('#cameraPlaceholder').style.display = 'grid'; }

function toggleRecording() { if (recorder?.state === 'recording') stopRecording(); else startRecording(); }
function startRecording() {
  if (!stream || !window.MediaRecorder) return alert('Videotallennus ei ole tuettu tällä laitteella tai selaimella.');
  chunks = []; const types = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
  const mimeType = types.find(type => MediaRecorder.isTypeSupported(type));
  recorder = new MediaRecorder(stream, mimeType ? {mimeType} : undefined);
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.onstop = () => { videoBlob = new Blob(chunks, {type:recorder.mimeType || 'video/webm'}); draft.videoDuration = 'Tallennettu'; $('#recordVideo').textContent = '● Aloita videoleike'; $('#cameraStatus').textContent = 'Videoleike tallennettu paikallisesti havaintoon.'; };
  recorder.start(); $('#recordVideo').textContent = '■ Lopeta videoleike'; $('#cameraStatus').textContent = 'Videoleike tallentuu. Sanele havainto sovelluksen ohjeiden mukaisesti.';
}
function stopRecording() { if (recorder?.state === 'recording') recorder.stop(); }

function snapshot() {
  const video = $('#cameraPreview'); if (!stream || !video.videoWidth) return;
  const canvas = $('#snapshotCanvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0); draft.snapshot = canvas.toDataURL('image/jpeg', .82); $('#cameraStatus').textContent = 'Raporttikuva tallennettu.'; renderAnswer(currentStep());
}

async function scanLocation() {
  if (!('BarcodeDetector' in window)) return alert('Tämän laitteen selain ei tue QR-/viivakoodin lukua videosta. Kirjoita tai sanele varastopaikka.');
  try {
    const detector = new BarcodeDetector({formats:['qr_code','code_128','code_39','ean_13','data_matrix']});
    const codes = await detector.detect($('#cameraPreview'));
    if (!codes.length) return alert('Tunnusta ei löytynyt. Pidä tunnus vakaasti kameran edessä ja yritä uudelleen.');
    draft.location = codes[0].rawValue; $('#cameraStatus').textContent = `Tunnistettu varastopaikka: ${draft.location}`; renderAnswer(currentStep()); speak(`Tunnistin varastopaikan ${draft.location}. Onko oikein?`);
  } catch (error) { console.error(error); alert('Tunnuksen luku ei onnistunut. Kirjoita tai sanele varastopaikka.'); }
}

function speak(text) { if (!('speechSynthesis' in window)) return; window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'fi-FI'; utterance.rate = .95; window.speechSynthesis.speak(utterance); }
function listenForAnswer(step) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return alert('Puheentunnistusta ei ole saatavilla tässä selaimessa. Valitse vastaus näytöltä tai kirjoita se.');
  recognition?.abort(); recognition = new Recognition(); recognition.lang = 'fi-FI'; recognition.interimResults = false; recognition.maxAlternatives = 1;
  const status = $('#voiceStatus'); status.textContent = 'Kuuntelen…';
  recognition.onresult = event => { const spoken = event.results[0][0].transcript; const value = interpretSpeech(step.key, spoken); if (value === null) { status.textContent = `Kuulin: “${spoken}”. En tunnistanut vastausta — valitse tai kirjoita se.`; return; } setDraftValue(step.key, value); status.textContent = `Kuulin: “${spoken}”.`; renderGuided(); };
  recognition.onerror = () => { status.textContent = 'Puheentunnistus ei onnistunut. Valitse vastaus näytöltä.'; };
  recognition.start();
}
function interpretSpeech(key, spoken) {
  if (key === 'location' || key === 'level' || key === 'notes') return spoken;
  const n = normalize(spoken);
  const options = key === 'part' ? PARTS : key === 'damageType' ? DAMAGE_TYPES : key === 'classification' ? CLASSES : ACTIONS;
  const aliases = { 'etu palkki':'Etuvaakapalkki', 'takapalkki':'Takavaakapalkki', 'etu pylväs':'Etupystypylväs', 'takapylväs':'Takapystypylväs', 'oranssi':'Oranssi', 'punainen':'Punainen', 'vihreä':'Vihreä', 'kayttokielto':'Aseta käyttökieltoon', 'käyttökieltoon':'Aseta käyttökieltoon' };
  if (aliases[n] && options.includes(aliases[n])) return aliases[n];
  return options.find(option => n === normalize(option) || n.includes(normalize(option)) || normalize(option).includes(n)) || null;
}

async function openReview() {
  if (recorder?.state === 'recording') { stopRecording(); await new Promise(resolve => setTimeout(resolve, 300)); }
  const missing = ['location','part','classification'].filter(key => !draft[key]?.trim());
  if (missing.length) { alert('Täydennä ennen tallennusta: ' + missing.map(labelFor).join(', ') + '.'); activeStep = 0; renderGuided(); return; }
  const rows = [ ['Varastopaikka', draft.location], ['Vaurioitunut osa', draft.part], ...(draft.level ? [['Taso / järjestysnumero', draft.level]] : []), ['Vauriotyyppi', draft.damageType || 'Ei määritetty'], ['Vaurioluokka', draft.classification], ['Toimenpide', draft.action], ['Lisätiedot', draft.notes || '–'], ['Videoleike', videoBlob ? 'Tallennettu paikallisesti' : 'Ei videoleikettä'] ];
  $('#reviewContent').innerHTML = `<table class="review-table">${rows.map(([key,value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</table>${draft.snapshot ? `<img class="snapshot" src="${draft.snapshot}" alt="Raporttikuva vauriosta" />` : '<p class="muted">Raporttikuvaa ei liitetty.</p>'}`;
  showView('reviewView');
}

async function saveObservation() {
  const observation = { id:uid(), createdAt:new Date().toISOString(), ...draft };
  if (videoBlob) { observation.videoMediaId = observation.id; await putMedia(observation.videoMediaId, videoBlob); }
  state.observations.unshift(observation); saveState(); stopCamera(); renderHome(); showView('homeView');
}

function deleteObservation(index) { if (!confirm('Poistetaanko havainto laitteelta?')) return; const [removed] = state.observations.splice(index,1); if (removed?.videoMediaId) deleteMedia(removed.videoMediaId); saveState(); renderHome(); }
function startNewInspection() { if (!confirm('Aloitetaanko uusi tarkastus? Nykyiset havainnot poistetaan tältä laitteelta.')) return; state.observations.forEach(item => item.videoMediaId && deleteMedia(item.videoMediaId)); state = defaultState(); saveState(); renderHome(); }

function exportCsv() {
  if (!state.observations.length) return alert('Lisää vähintään yksi havainto ennen vientiä.');
  const headers = ['Kohde','Tarkastaja','Päivä','Varastopaikka','Vaurioitunut osa','Taso/järjestysnumero','Vauriotyyppi','Luokitus','Toimenpide','Lisätiedot','Tallennettu'];
  const rows = state.observations.map(item => [state.inspection.site,state.inspection.inspector,state.inspection.date,item.location,item.part,item.level,item.damageType,item.classification,item.action,item.notes,new Date(item.createdAt).toLocaleString('fi-FI')]);
  const csv = '\ufeff' + [headers,...rows].map(row => row.map(csvCell).join(';')).join('\n'); download(new Blob([csv],{type:'text/csv;charset=utf-8'}), `hyllysanelu_${fileDate()}.csv`);
}
function reportHtml() { const meta = state.inspection; return `<!doctype html><html lang="fi"><meta charset="utf-8"><title>HyllySanelu – tarkastusraportti</title><style>body{font-family:Arial,sans-serif;color:#17342c;max-width:900px;margin:32px auto;padding:0 24px}h1{color:#0c3b2e}table{border-collapse:collapse;width:100%;margin:18px 0}th,td{padding:8px;border:1px solid #cbd7cf;text-align:left;vertical-align:top}th{background:#edf4ef}img{max-width:260px;border-radius:6px;margin-top:8px}.tag{font-weight:bold}</style><h1>HyllySanelu – tarkastusraportti</h1><p><strong>Kohde:</strong> ${escapeHtml(meta.site || '–')}<br><strong>Tarkastaja:</strong> ${escapeHtml(meta.inspector || '–')}<br><strong>Päivä:</strong> ${escapeHtml(meta.date || '–')}<br><strong>Lisätiedot:</strong> ${escapeHtml(meta.notes || '–')}</p>${state.observations.map((o,i)=>`<section><h2>${i+1}. ${escapeHtml(o.location)} · ${escapeHtml(o.part)}</h2><table><tr><th>Vauriotyyppi</th><td>${escapeHtml(o.damageType || 'Ei määritetty')}</td></tr><tr><th>Luokitus</th><td class="tag">${escapeHtml(o.classification)}</td></tr><tr><th>Toimenpide</th><td>${escapeHtml(o.action)}</td></tr>${o.level?`<tr><th>Taso / järjestysnumero</th><td>${escapeHtml(o.level)}</td></tr>`:''}<tr><th>Lisätiedot</th><td>${escapeHtml(o.notes || '–')}</td></tr></table>${o.snapshot?`<img src="${o.snapshot}" alt="Vauriokuva">`:''}</section>`).join('')}</html>`; }
function printReport() { if (!state.observations.length) return alert('Lisää vähintään yksi havainto ennen raporttia.'); const popup = window.open('', '_blank'); if (!popup) return alert('Selaimesi esti raportti-ikkunan. Salli ponnahdusikkunat ja yritä uudelleen.'); popup.document.write(reportHtml()); popup.document.close(); popup.focus(); setTimeout(() => popup.print(), 300); }
async function shareReport() { if (!state.observations.length) return alert('Lisää vähintään yksi havainto ennen jakamista.'); const text = state.observations.map((o,i) => `${i+1}. ${o.location}: ${o.part}, ${o.classification}, ${o.action}`).join('\n'); if (navigator.share) { try { await navigator.share({title:'HyllySanelu – tarkastusyhteenveto', text}); } catch {} } else { await navigator.clipboard?.writeText(text); alert('Yhteenveto kopioitiin leikepöydälle.'); } }

function db() { return new Promise((resolve,reject) => { const request = indexedDB.open(DB_NAME,1); request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function putMedia(id, blob) { const database = await db(); return new Promise((resolve,reject) => { const tx=database.transaction(DB_STORE,'readwrite'); tx.objectStore(DB_STORE).put(blob,id); tx.oncomplete=resolve; tx.onerror=reject; }); }
async function deleteMedia(id) { const database = await db(); return new Promise((resolve,reject) => { const tx=database.transaction(DB_STORE,'readwrite'); tx.objectStore(DB_STORE).delete(id); tx.oncomplete=resolve; tx.onerror=reject; }); }
function csvCell(value) { const text = String(value || ''); return /[;"\n]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text; }
function fileDate() { return new Date().toISOString().slice(0,10); }
function classSlug(value='') { return ({Vihreä:'green',Oranssi:'orange',Punainen:'red'})[value] || 'other'; }
function labelFor(key) { return ({location:'varastopaikka',part:'vaurioitunut osa',classification:'vaurioluokitus'})[key] || key; }
function escapeHtml(value='') { return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function escapeAttr(value='') { return escapeHtml(value); }

$('#startObservation').addEventListener('click', startObservation);
$('#editInspection').addEventListener('click', openInspection);
$('#inspectionForm').addEventListener('submit', event => { event.preventDefault(); state.inspection = Object.fromEntries(new FormData(event.currentTarget)); saveState(); renderHome(); showView('homeView'); });
$$('[data-go]').forEach(button => button.addEventListener('click', () => showView(button.dataset.go)));
$('#openCamera').addEventListener('click', openCamera);
$('#scanLocation').addEventListener('click', scanLocation);
$('#recordVideo').addEventListener('click', toggleRecording);
$('#takeSnapshot').addEventListener('click', snapshot);
$('#nextStep').addEventListener('click', nextStep);
$('#previousStep').addEventListener('click', previousStep);
$('#repeatPrompt').addEventListener('click', () => speak(`${currentStep().title}. ${currentStep().prompt}`));
$('#cancelGuided').addEventListener('click', () => { if (confirm('Keskeytetäänkö tallentamaton havainto?')) { stopRecording(); stopCamera(); showView('homeView'); } });
$('#saveObservation').addEventListener('click', saveObservation);
$('#discardObservation').addEventListener('click', () => { if (confirm('Hylätäänkö tallentamaton havainto?')) { stopCamera(); showView('homeView'); } });
$('#newInspection').addEventListener('click', startNewInspection);
$('#exportCsv').addEventListener('click', exportCsv);
$('#printReport').addEventListener('click', printReport);
$('#shareReport').addEventListener('click', shareReport);
$('#observationList').addEventListener('click', event => { const index = event.target.dataset.delete; if (index !== undefined) deleteObservation(Number(index)); });
window.addEventListener('beforeunload', stopCamera);
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js'));
renderHome();
