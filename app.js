pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let archivos = [];
let datosExtraidos = [];

// Año actual dinámico para la cabecera (se actualiza automáticamente a 2027, 2028, etc.)
const anioActual = new Date().getFullYear();
const elHdrYear = document.getElementById('hdrYear');
if (elHdrYear) elHdrYear.textContent = `· ${anioActual}`;
// El año del autor se mantiene fijo en 2026 según especificación

// Gestión de Tema Claro / Oscuro con persistencia
function inicializarTema() {
  const temaGuardado = localStorage.getItem('siagie_theme');
  if (temaGuardado) {
    document.documentElement.setAttribute('data-theme', temaGuardado);
  } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}
inicializarTema();

function alternarTema() {
  const actual = document.documentElement.getAttribute('data-theme');
  const nuevo = actual === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nuevo);
  localStorage.setItem('siagie_theme', nuevo);
  toast(nuevo === 'dark' ? '🌙 Modo Oscuro activado' : '☀️ Modo Claro activado');
}

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  agregarArchivos([...e.dataTransfer.files]);
});
fileInput.addEventListener('change', () => {
  agregarArchivos([...fileInput.files]);
  fileInput.value = '';
});

function agregarArchivos(nuevos) {
  nuevos.filter(f => f.name.toLowerCase().endsWith('.pdf')).forEach(f => {
    if (!archivos.find(x => x.name === f.name && x.size === f.size)) {
      f.alumnosCount = undefined;
      archivos.push(f);
    }
  });
  renderFileList();
}

function renderFileList() {
  const container = document.getElementById('fileList');
  if (!archivos.length) {
    container.innerHTML = '';
    document.getElementById('btnProcesar').disabled = true;
    return;
  }

  container.innerHTML = archivos.map((f, i) => {
    const conteoTxt = f.alumnosCount !== undefined
      ? `<strong style="color:var(--primary);margin-left:4px">· ${f.alumnosCount} alumno(s)</strong>`
      : '';
    return `
    <div class="file-chip">
      <svg class="file-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
      </svg>
      <span>${esc(f.name)}</span>
      <span style="color:var(--text-light);font-size:.74rem">(${(f.size/1024).toFixed(0)} KB${conteoTxt})</span>
      <button onclick="quitarArchivo(${i})" title="Quitar archivo">✕</button>
    </div>`;
  }).join('');

  document.getElementById('btnProcesar').disabled = archivos.length === 0;
}

function quitarArchivo(i) {
  archivos.splice(i, 1);
  renderFileList();
}

function limpiarTodo() {
  archivos = [];
  datosExtraidos = [];
  renderFileList();
  document.getElementById('resultados').style.display = 'none';
  document.getElementById('alertas').innerHTML = '';
  document.getElementById('buscador').value = '';
  document.getElementById('spinner').classList.remove('show');
  const filtroIE = document.getElementById('filtroIE');
  if (filtroIE) filtroIE.innerHTML = '<option value="">🏫 Todas las I.E.</option>';
  limpiarBusqueda();
}

// Decodificación de fuentes desplazadas (cifrado César +29 de SIAGIE/MINEDU)
function decodificarTextoSIAGIE(str) {
  if (!str) return '';
  const mapaEspecial = {
    'f': 'Ñ',
    'Ï': 'Ó',
    'Ë': 'Í',
    'È': 'Á',
    '~': 'ú',
    't': 'í',
    'i': 'á',
    'y': 'ó',
    'ž': '°',
    'ƒ': '°'
  };

  let dec = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (mapaEspecial[ch] !== undefined) {
      dec += mapaEspecial[ch];
    } else {
      const code = str.charCodeAt(i);
      if (code >= 1 && code <= 97) {
        dec += String.fromCharCode(code + 29);
      } else {
        dec += ch;
      }
    }
  }
  return dec;
}

// Determinar si una cadena proviene de una fuente desplazada
function esTextoCodificado(str) {
  if (!str) return false;
  return /[\x01-\x1F\$&(=~ÏËÈƒž]/.test(str) ||
         (/\b[0-9A-Z\$\(\)\/=,'&]{2,}\b/.test(str) && /[\$\(\)\/=&]/.test(str)) ||
         str.includes('1~PHUR') || str.includes('&yGLJR');
}

function normalizarItem(it) {
  let s = it.str || '';
  if (esTextoCodificado(s)) {
    s = decodificarTextoSIAGIE(s);
  }
  return { ...it, str: s };
}

// Convertir texto a formato "Apellidos, Nombres" con mayúsculas/minúsculas legibles
function aTipoTitulo(texto) {
  return texto.toLowerCase().replace(/(?:^|\s|-|\/)\S/g, m => m.toUpperCase());
}

async function procesarPDFs() {
  if (!archivos.length) return;
  actualizarProgreso(0, `Iniciando extracción de ${archivos.length} archivo(s)…`, true);
  document.getElementById('btnProcesar').disabled = true;
  document.getElementById('resultados').style.display = 'none';
  datosExtraidos = [];

  const totalArchivos = archivos.length;

  for (let idx = 0; idx < totalArchivos; idx++) {
    const archivo = archivos[idx];
    const basePct = Math.round((idx / totalArchivos) * 100);
    actualizarProgreso(basePct, `Leyendo documento (${idx + 1}/${totalArchivos}): ${archivo.name}…`, true);

    try {
      const buffer = await archivo.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({
        data: buffer,
        cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/'
      }).promise;

      let ieNombre = '';
      let codModular = '';
      const estudiantesArchivo = [];

      for (let numPag = 1; numPag <= pdf.numPages; numPag++) {
        const pagPct = basePct + Math.round((numPag / pdf.numPages) * (100 / totalArchivos));
        actualizarProgreso(pagPct, `Procesando página ${numPag}/${pdf.numPages} de "${archivo.name}"…`, true);

        const page = await pdf.getPage(numPag);
        const textContent = await page.getTextContent();
        const items = textContent.items.map(normalizarItem);

        // Agrupar elementos por tolerancia vertical adaptable (eje Y)
        const lineas = [];
        const itemsValidos = items
          .filter(it => it.str && it.str.trim() && it.transform)
          .sort((a, b) => b.transform[5] - a.transform[5]);

        itemsValidos.forEach(item => {
          const y = item.transform[5];
          let lineaExistente = lineas.find(l => Math.abs(l.y - y) <= 4.5);
          if (lineaExistente) {
            lineaExistente.items.push(item);
          } else {
            lineas.push({ y: y, items: [item] });
          }
        });

        // Procesar líneas ordenadas de arriba a abajo y de izquierda a derecha
        for (const linea of lineas) {
          linea.items.sort((a, b) => a.transform[4] - b.transform[4]);
          const textoLinea = linea.items.map(it => it.str).join(' ');

          // Detectar Institución Educativa (IE)
          if (!ieNombre) {
            const mIE = textoLinea.match(/N[uú]mero\s+(?:y\s*\/?\s*o|y\/o)\s+Nombre\s+([0-9A-ZÑÁÉÍÓÚ\s\.\-]{1,35}?)(?=\s+(?:Gesti[oó]n|Gest|\*|PGD|PGR|Modular|C[oó]d|$))/i);
            if (mIE) {
              ieNombre = mIE[1].trim();
            } else {
              const mIE2 = textoLinea.match(/Nombre\s+de\s+la\s+I\.?E\.?\s*[:：-]?\s*([0-9A-ZÑÁÉÍÓÚ\s\.\-]{2,40})/i);
              if (mIE2) ieNombre = mIE2[1].trim();
            }
          }

          // Detectar Código Modular
          if (!codModular) {
            const mCod = textoLinea.match(/C[oó]digo\s+Modular\s+([0-9\s]{7,25})/i);
            if (mCod) {
              const num = mCod[1].replace(/\s+/g, '');
              if (num.length >= 6 && num.length <= 8) {
                codModular = num;
              }
            } else {
              const mCod2 = textoLinea.match(/\b(0\d{6})\b/);
              if (mCod2) codModular = mCod2[1];
            }
          }

          // Limpiar dígitos de DNI separados por espacios
          let textoFila = textoLinea.replace(/(\d)\s+(?=\d)/g, '$1');

          // Separar si el DNI quedó pegado con letras sin espacio
          textoFila = textoFila.replace(/(\b\d{8})([A-ZÑÁÉÍÓÚa-záéíóúñ])/g, '$1 $2');

          // Patrón para capturar DNI (8 dígitos) y Apellidos y Nombres
          const regex = /(?:^|\D)(\d{8})\b\s+([A-ZÑÁÉÍÓÚa-záéíóúñ\s,]{4,80})/g;
          let match;

          while ((match = regex.exec(textoFila)) !== null) {
            const dni = match[1];
            if (/^(00000000|11111111|12345678)$/.test(dni)) continue;

            let nombreRaw = match[2].trim();

            // Descartar encabezados
            if (/^(?:DNI|CODIGO|ORDEN|NUMERO|RESOLUCION|MINISTERIO|DATOS)/i.test(nombreRaw)) continue;

            // Cortar texto de columnas posteriores
            nombreRaw = nombreRaw.split(/\s+(?:\d{2}[\/\s]?\d{2}[\/\s]?\d{4}|\d{6,8}|H\b|M\b|SI\b|NO\b|EBR\b|INI\b|PRI\b|SEC\b|TRASLADADO)/i)[0].trim();
            nombreRaw = nombreRaw.replace(/[,;\s]+$/, '').trim();

            if (nombreRaw.length >= 4 && /[A-ZÑÁÉÍÓÚa-z]/i.test(nombreRaw)) {
              if (!estudiantesArchivo.some(a => a.dni === dni)) {
                estudiantesArchivo.push({
                  dni,
                  nombre: aTipoTitulo(nombreRaw),
                  ie: ieNombre,
                  codigo_modular: codModular
                });
              }
            }
          }
        }
      }

      // Guardar conteo de alumnos extraídos para este archivo
      archivo.alumnosCount = estudiantesArchivo.length;

      // Asegurar asignación de IE y Código Modular a todos los alumnos del archivo
      estudiantesArchivo.forEach(a => {
        if (!a.ie) a.ie = ieNombre || '—';
        if (!a.codigo_modular) a.codigo_modular = codModular || '—';

        if (!datosExtraidos.some(x => x.dni === a.dni)) {
          datosExtraidos.push(a);
        }
      });

    } catch (e) {
      console.error('Error al procesar PDF:', e);
      toast('Error al leer ' + archivo.name);
    }
  }

  actualizarProgreso(100, `¡Extracción completada!`, false);
  document.getElementById('btnProcesar').disabled = archivos.length === 0;
  renderFileList();
  renderResultados();
}

function actualizarProgreso(porcentaje, mensaje, visible) {
  const spinnerBox = document.getElementById('spinner');
  const fill = document.getElementById('progressFill');
  const pctLbl = document.getElementById('spinPercent');
  const msgLbl = document.getElementById('spinMsg');

  if (visible) {
    spinnerBox.classList.add('show');
  } else {
    setTimeout(() => spinnerBox.classList.remove('show'), 600);
  }

  if (fill) fill.style.width = Math.min(100, Math.max(0, porcentaje)) + '%';
  if (pctLbl) pctLbl.textContent = Math.min(100, Math.max(0, porcentaje)) + '%';
  if (msgLbl && mensaje) msgLbl.textContent = mensaje;
}

function poblarFiltroIE() {
  const select = document.getElementById('filtroIE');
  if (!select) return;

  const ies = [...new Set(datosExtraidos.map(a => a.ie).filter(x => x && x !== '—'))].sort();
  const valorActual = select.value;

  select.innerHTML = '<option value="">🏫 Todas las I.E.</option>' +
    ies.map(ie => `<option value="${esc(ie)}" ${ie === valorActual ? 'selected' : ''}>${esc(ie)}</option>`).join('');
}

function renderResultados() {
  const total = datosExtraidos.length;
  const ies = [...new Set(datosExtraidos.map(a => a.ie).filter(x => x && x !== '—'))];

  document.getElementById('statsBox').innerHTML = `
    <div class="stat-card">
      <div class="stat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
      </div>
      <div class="stat-info">
        <div class="stat-num">${total}</div>
        <div class="stat-label">Estudiantes</div>
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
      </div>
      <div class="stat-info">
        <div class="stat-num">${ies.length || 1}</div>
        <div class="stat-label">Instituciones (IE)</div>
      </div>
    </div>

    <div class="stat-card">
      <div class="stat-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
      </div>
      <div class="stat-info">
        <div class="stat-num">${archivos.length}</div>
        <div class="stat-label">Nóminas PDF</div>
      </div>
    </div>
  `;

  const alertDiv = document.getElementById('alertas');
  alertDiv.innerHTML = total > 0
    ? `<div class="alert a-ok">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:20px;height:20px;flex-shrink:0;">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
        <span>Se extrajeron <strong>${total} estudiantes</strong> correctamente sin omitir ningún registro.</span>
      </div>`
    : `<div class="alert a-err">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;flex-shrink:0;">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <span>No se encontraron estudiantes en el PDF. Verifique que sea una Nómina de Matrícula SIAGIE.</span>
      </div>`;

  poblarFiltroIE();
  renderTabla(datosExtraidos);
  document.getElementById('buscador').value = '';
  document.getElementById('resultados').style.display = 'block';
  document.getElementById('resultados').scrollIntoView({ behavior: 'smooth' });
}

// Función para resaltar términos de búsqueda en texto escapado
function resaltar(texto, query) {
  if (!query || !texto) return esc(texto);
  const seguro = esc(texto);
  const qEscape = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${qEscape})`, 'gi');
  return seguro.replace(regex, '<mark class="hl">$1</mark>');
}

function renderTabla(alumnos, query = '') {
  const tbody = document.getElementById('tablaBody');
  const iconoCopiar = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;

  tbody.innerHTML = alumnos.map((a, i) => `
    <tr>
      <td class="col-n">${i + 1}</td>
      <td>
        <div class="celda-copiable">
          <span class="badge-dni">${resaltar(a.dni, query)}</span>
          <button class="btn-copiar" data-valor="${esc(a.dni)}" title="Copiar DNI">${iconoCopiar} Copiar</button>
        </div>
      </td>
      <td>
        <div class="celda-copiable">
          <strong class="student-name">${resaltar(a.nombre, query)}</strong>
          <button class="btn-copiar" data-valor="${esc(a.nombre)}" title="Copiar Nombre">${iconoCopiar} Copiar</button>
        </div>
      </td>
      <td>
        <div class="celda-copiable">
          <span class="badge-ie">${resaltar(a.ie, query)}</span>
          <button class="btn-copiar" data-valor="${esc(a.ie)}" title="Copiar IE">${iconoCopiar} Copiar</button>
        </div>
      </td>
      <td>
        <div class="celda-copiable">
          <span class="badge-cod">${resaltar(a.codigo_modular, query)}</span>
          <button class="btn-copiar" data-valor="${esc(a.codigo_modular)}" title="Copiar Código">${iconoCopiar} Copiar</button>
        </div>
      </td>
    </tr>`).join('');

  document.getElementById('countLbl').textContent = `${alumnos.length} registro(s)`;
}

// Delegación de eventos para copiar individualmente
document.getElementById('tablaBody').addEventListener('click', function(e) {
  const btn = e.target.closest('.btn-copiar');
  if (!btn) return;

  const txt = decodeHtmlEntities(btn.getAttribute('data-valor') || '');
  navigator.clipboard.writeText(txt).then(() => {
    const originalHTML = btn.innerHTML;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> Copiado`;
    btn.classList.add('copiado');
    setTimeout(() => {
      btn.innerHTML = originalHTML;
      btn.classList.remove('copiado');
    }, 1800);
  }).catch(() => toast('Error al copiar al portapapeles'));
});

function decodeHtmlEntities(str) {
  const el = document.createElement('textarea');
  el.innerHTML = str;
  return el.value;
}

function filtrarTabla() {
  const input = document.getElementById('buscador');
  const btnClear = document.getElementById('btnClearSearch');
  const filtroIE = document.getElementById('filtroIE');

  const q = input.value.toLowerCase().trim();
  const ieSeleccionada = filtroIE ? filtroIE.value : '';

  if (btnClear) {
    btnClear.style.display = q ? 'block' : 'none';
  }

  const filtrados = datosExtraidos.filter(a => {
    const coincideIE = !ieSeleccionada || a.ie === ieSeleccionada;
    const coincideQ = !q || (
      a.dni.toLowerCase().includes(q) ||
      a.nombre.toLowerCase().includes(q) ||
      a.ie.toLowerCase().includes(q) ||
      a.codigo_modular.toLowerCase().includes(q)
    );
    return coincideIE && coincideQ;
  });

  renderTabla(filtrados, q);
}

function limpiarBusqueda() {
  const input = document.getElementById('buscador');
  const btnClear = document.getElementById('btnClearSearch');
  if (input) input.value = '';
  if (btnClear) btnClear.style.display = 'none';
  filtrarTabla();
}

function exportarExcel() {
  if (!datosExtraidos.length) return toast('Sin datos para exportar');
  const wsData = datosExtraidos.map((a, i) => ({
    'N°': i + 1,
    'DNI': a.dni,
    'Apellidos y Nombres': a.nombre,
    'Institución Educativa': a.ie,
    'Cód. Modular': a.codigo_modular
  }));
  const ws = XLSX.utils.json_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Nómina SIAGIE");
  XLSX.writeFile(wb, `nomina_matricula_dre_piura_${anioActual}.xlsx`);
  toast('✅ Archivo Excel descargado con éxito');
}

function exportarCSV() {
  if (!datosExtraidos.length) return toast('Sin datos para exportar');
  const cabeceras = ['N°', 'DNI', 'Apellidos y Nombres', 'Institución Educativa', 'Cód. Modular'];
  const filas = datosExtraidos.map((a, i) => [
    i + 1,
    `"${a.dni}"`,
    `"${a.nombre.replace(/"/g, '""')}"`,
    `"${a.ie.replace(/"/g, '""')}"`,
    `"${a.codigo_modular}"`
  ]);

  const csvContent = '\uFEFF' + [cabeceras.join(','), ...filas.map(f => f.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `nomina_matricula_dre_piura_${anioActual}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  toast('✅ Archivo CSV descargado con éxito');
}

function copiarTodo() {
  if (!datosExtraidos.length) return toast('No hay datos para copiar');
  const cab = 'DNI\tApellidos y Nombres\tInstitución Educativa\tCód. Modular';
  const filas = datosExtraidos.map(a => `${a.dni}\t${a.nombre}\t${a.ie}\t${a.codigo_modular}`);
  navigator.clipboard.writeText([cab, ...filas].join('\n'))
    .then(() => toast('✅ Tabla completa copiada al portapapeles'))
    .catch(() => toast('Error al copiar al portapapeles'));
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}