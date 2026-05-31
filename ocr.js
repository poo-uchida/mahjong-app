// --- OCR ---

function compressImage(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1280;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else       { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        resolve({ dataUrl, base64: dataUrl.split(',')[1], width: w, height: h });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

let ocrResults = null;

async function handleOcrFile(file) {
  clearError();
  const btn = document.getElementById('btnOcr');
  btn.disabled = true;
  btn.textContent = '読み取り中...';
  try {
    const { dataUrl, base64, width, height } = await compressImage(file);
    showOcrPreview(dataUrl);
    const res = await gasRequest({ action: 'ocr', image: base64, imageWidth: width, imageHeight: height });
    if (res.ok && res.results && res.results.length > 0) {
      showOcrBoxes(res.results);
    } else {
      closeOcrDialog();
    }
  } catch {
    closeOcrDialog();
  } finally {
    btn.disabled = false;
    btn.textContent = '画像から入力';
  }
}

let ocrResizeHandler = null;

function showOcrPreview(imageDataUrl) {
  document.getElementById('ocrDropdowns').innerHTML = '';
  document.getElementById('btnOcrOk').disabled = true;
  document.getElementById('ocrOverlay').style.display = 'flex';
  document.getElementById('ocrPreviewImg').src = imageDataUrl;
}

function showOcrBoxes(results) {
  ocrResults = results;
  const img = document.getElementById('ocrPreviewImg');
  const reposition = () => {
    positionOcrDropdowns(results);
    if (ocrResizeHandler) window.removeEventListener('resize', ocrResizeHandler);
    ocrResizeHandler = () => positionOcrDropdowns(results);
    window.addEventListener('resize', ocrResizeHandler);
  };
  if (img.complete) reposition();
  else img.onload = reposition;
}

function positionOcrDropdowns(results) {
  const img = document.getElementById('ocrPreviewImg');
  const ddContainer = document.getElementById('ocrDropdowns');
  const { width: imgW, height: imgH } = img.getBoundingClientRect();
  const lastAssignment = state.lastAssignment || results.map((_, i) => i);

  ddContainer.innerHTML = '';

  results.forEach((r, i) => {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `position:absolute;left:${r.box.x * imgW}px;top:${r.box.y * imgH}px;transform:translate(-50%,-50%);pointer-events:auto;text-align:center;`;

    const label = document.createElement('div');
    label.style.cssText = 'font-size:11px;color:#fff;text-shadow:0 0 3px #000;white-space:nowrap;margin-bottom:2px;';
    label.textContent = r.score != null ? r.score.toLocaleString() : '?';

    const sel = document.createElement('select');
    sel.id = `ocrSel${i}`;
    sel.style.cssText = 'font-size:13px;padding:2px 4px;border-radius:4px;border:2px solid #fff;background:#000;color:#fff;max-width:90px;';
    state.players.forEach((name, pi) => {
      const opt = document.createElement('option');
      opt.value = pi;
      opt.textContent = name || `P${pi + 1}`;
      if (lastAssignment[i] === pi) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', validateOcrOk);

    wrapper.appendChild(label);
    wrapper.appendChild(sel);
    ddContainer.appendChild(wrapper);
  });

  validateOcrOk();
}

function validateOcrOk() {
  if (!ocrResults) return;
  const selected = ocrResults.map((_, i) => parseInt(document.getElementById(`ocrSel${i}`).value));
  const counts = {};
  selected.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  document.getElementById('btnOcrOk').disabled = new Set(selected).size !== selected.length;
}

function closeOcrDialog() {
  document.getElementById('ocrOverlay').style.display = 'none';
  if (ocrResizeHandler) {
    window.removeEventListener('resize', ocrResizeHandler);
    ocrResizeHandler = null;
  }
  ocrResults = null;
}

function applyOcrResults() {
  if (!ocrResults) return;
  const assignment = ocrResults.map((_, i) => parseInt(document.getElementById(`ocrSel${i}`).value));
  state.lastAssignment = assignment;
  saveState();

  const validScores = ocrResults.map(r => r.score ?? -Infinity);
  const topResultIdx = validScores.indexOf(Math.max(...validScores));

  assignment.forEach((playerIdx, resultIdx) => {
    const input = document.getElementById(`score${playerIdx}`);
    if (!input) return;
    const isTop = resultIdx === topResultIdx;
    input.value = (isTop || ocrResults[resultIdx].score === null) ? '' : ocrResults[resultIdx].score;
  });

  closeOcrDialog();
  calcDone = false;
  handleFocusOut();
}
